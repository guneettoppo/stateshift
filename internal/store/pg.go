package store

import (
	"context"
	_ "embed"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/guneettoppo/stateshift/internal/model"
)

//go:embed schema.sql
var Schema string

// PG is the YugabyteDB (YSQL) / Postgres implementation.
//
// Two things matter here and both are deliberate:
//   - CommitStep applies ops and advances seq inside one transaction, so state
//     and the exactly-once op log can never disagree.
//   - TransferEpoch is a single UPDATE with an epoch predicate. Exactly one
//     caller can win it, which is the whole consistency argument of StateShift.
type PG struct {
	pool *pgxpool.Pool
}

func NewPG(ctx context.Context, dsn string) (*PG, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	// Yugabyte Aeon Sandbox allows 15 connections; stay well under it.
	cfg.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PG{pool: pool}, nil
}

func (p *PG) Migrate(ctx context.Context) error {
	sql := Schema
	// Split on the statement separator we control in schema.sql.
	for _, stmt := range splitStatements(sql) {
		if _, err := p.pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func splitStatements(sql string) []string {
	var out []string
	cur := ""
	for _, line := range strings.Split(sql, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		cur += line + "\n"
		if strings.HasSuffix(trimmed, ";") {
			out = append(out, cur)
			cur = ""
		}
	}
	if strings.TrimSpace(cur) != "" {
		out = append(out, cur)
	}
	return out
}

const jobCols = `id, workload, epoch, seq, total_steps, status, owner, state, state_hash,
	created_at, updated_at, pause_ms, bytes_total, ops, checksum`

func scanJob(row pgx.Row) (*model.Job, error) {
	var j model.Job
	err := row.Scan(&j.ID, &j.Workload, &j.Epoch, &j.Seq, &j.TotalSteps, &j.Status, &j.Owner,
		&j.State, &j.StateHash, &j.CreatedAt, &j.UpdatedAt, &j.PauseMs, &j.BytesTotal, &j.Ops, &j.Checksum)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (p *PG) CreateJob(ctx context.Context, j *model.Job) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO jobs (`+jobCols+`) VALUES
		($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		j.ID, j.Workload, j.Epoch, j.Seq, j.TotalSteps, j.Status, j.Owner,
		j.State, j.StateHash, j.CreatedAt, j.UpdatedAt, j.PauseMs, j.BytesTotal, j.Ops, j.Checksum)
	return err
}

func (p *PG) GetJob(ctx context.Context, id string) (*model.Job, error) {
	return scanJob(p.pool.QueryRow(ctx, `SELECT `+jobCols+` FROM jobs WHERE id = $1`, id))
}

func (p *PG) ListJobs(ctx context.Context) ([]*model.Job, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+jobCols+` FROM jobs ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Job
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (p *PG) SetStatusCAS(ctx context.Context, id, from, to string) (bool, error) {
	tag, err := p.pool.Exec(ctx,
		`UPDATE jobs SET status = $3, updated_at = now() WHERE id = $1 AND status = $2`, id, from, to)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// CommitStep: one transaction, ops first (idempotent via ON CONFLICT), then a
// guarded UPDATE on the job row. Ops are inserted one by one rather than via
// jsonb_to_recordset so the statement stays inside the YSQL feature set.
func (p *PG) CommitStep(ctx context.Context, jobID string, epoch, fromSeq, toSeq int, state []byte, stateHash string, ops []model.Op) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, op := range ops {
		if _, err := tx.Exec(ctx, `INSERT INTO oplog (job_id, seq, epoch, op_id, result)
			VALUES ($1,$2,$3,$4,$5) ON CONFLICT (job_id, seq, op_id) DO NOTHING`,
			jobID, fromSeq, epoch, op.ID, op.Result); err != nil {
			return err
		}
	}

	tag, err := tx.Exec(ctx, `UPDATE jobs
		SET seq = $4, state = $5, state_hash = $6, ops = ops + $7, updated_at = now()
		WHERE id = $1 AND epoch = $2 AND seq = $3 AND status IN ('running','draining')`,
		jobID, epoch, fromSeq, toSeq, state, stateHash, len(ops))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrStaleEpoch
	}
	return tx.Commit(ctx)
}

func (p *PG) TransferEpoch(ctx context.Context, id string, fromEpoch int, owner, status string) (int, bool, error) {
	var newEpoch int
	err := p.pool.QueryRow(ctx, `UPDATE jobs SET epoch = epoch + 1, owner = $3, status = $4, updated_at = now()
		WHERE id = $1 AND epoch = $2 RETURNING epoch`, id, fromEpoch, owner, status).Scan(&newEpoch)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return newEpoch, true, nil
}

func (p *PG) MarkDone(ctx context.Context, id string, epoch int, checksum string) error {
	tag, err := p.pool.Exec(ctx, `UPDATE jobs SET status = 'done', checksum = $3, updated_at = now()
		WHERE id = $1 AND epoch = $2`, id, epoch, checksum)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrStaleEpoch
	}
	return nil
}

func (p *PG) MarkFailed(ctx context.Context, id, reason string) error {
	_, err := p.pool.Exec(ctx, `UPDATE jobs SET status = 'failed', checksum = $2, updated_at = now() WHERE id = $1`, id, reason)
	return err
}

func (p *PG) MarkPause(ctx context.Context, id string, pauseMs int) error {
	_, err := p.pool.Exec(ctx, `UPDATE jobs SET pause_ms = $2 WHERE id = $1`, id, pauseMs)
	return err
}

func (p *PG) AddBytes(ctx context.Context, id string, n int64) error {
	_, err := p.pool.Exec(ctx, `UPDATE jobs SET bytes_total = bytes_total + $2 WHERE id = $1`, id, n)
	return err
}

func (p *PG) OpsCount(ctx context.Context, id string) (int, error) {
	var n int
	if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM oplog WHERE job_id = $1`, id).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

func (p *PG) PutCheckpoint(ctx context.Context, cp *model.Checkpoint) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO checkpoints
		(job_id, seq, epoch, manifest_key, state_hash, size, chunks, chunks_uploaded, chunks_skipped, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		cp.JobID, cp.Seq, cp.Epoch, cp.ManifestKey, cp.StateHash, cp.Size, cp.Chunks, cp.Uploaded, cp.Skipped, cp.CreatedAt)
	return err
}

func (p *PG) LatestCheckpoint(ctx context.Context, jobID string) (*model.Checkpoint, error) {
	var cp model.Checkpoint
	err := p.pool.QueryRow(ctx, `SELECT job_id, seq, epoch, manifest_key, state_hash, size, chunks,
		chunks_uploaded, chunks_skipped, created_at FROM checkpoints
		WHERE job_id = $1 ORDER BY seq DESC LIMIT 1`, jobID).Scan(
		&cp.JobID, &cp.Seq, &cp.Epoch, &cp.ManifestKey, &cp.StateHash, &cp.Size,
		&cp.Chunks, &cp.Uploaded, &cp.Skipped, &cp.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &cp, nil
}

func (p *PG) PutMigration(ctx context.Context, m *model.Migration) (int64, error) {
	var id int64
	err := p.pool.QueryRow(ctx, `INSERT INTO migrations
		(job_id, from_node, to_node, started_at, quiesced_at, restored_at, pause_ms,
		 bytes_transferred, chunks_sent, chunks_skipped, outcome, epoch_from, epoch_to)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
		m.JobID, m.From, m.To, m.StartedAt, m.QuiescedAt, m.RestoredAt, m.PauseMs,
		m.BytesSent, m.ChunksSent, m.Skipped, m.Outcome, m.EpochFrom, m.EpochTo).Scan(&id)
	return id, err
}

func (p *PG) ListMigrations(ctx context.Context, limit int) ([]*model.Migration, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := p.pool.Query(ctx, `SELECT id, job_id, from_node, to_node, started_at, quiesced_at,
		restored_at, pause_ms, bytes_transferred, chunks_sent, chunks_skipped, outcome, epoch_from, epoch_to
		FROM migrations ORDER BY id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*model.Migration
	for rows.Next() {
		var m model.Migration
		if err := rows.Scan(&m.ID, &m.JobID, &m.From, &m.To, &m.StartedAt, &m.QuiescedAt,
			&m.RestoredAt, &m.PauseMs, &m.BytesSent, &m.ChunksSent, &m.Skipped, &m.Outcome,
			&m.EpochFrom, &m.EpochTo); err != nil {
			return nil, err
		}
		out = append(out, &m)
	}
	return out, rows.Err()
}

func (p *PG) Close() error {
	p.pool.Close()
	return nil
}

