package store

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/guneettoppo/stateshift/internal/model"
)

// Mem is an in-process Store used for single-machine rehearsal, unit tests and
// the offline demo. It implements exactly the same atomicity contract as the
// Postgres/Yugabyte implementation, so bugs found here are real bugs.
type Mem struct {
	mu      sync.Mutex
	jobs    map[string]*model.Job
	cps     map[string][]*model.Checkpoint
	migs    []*model.Migration
	nextMig int64
}

func NewMem() *Mem {
	return &Mem{
		jobs: map[string]*model.Job{},
		cps:  map[string][]*model.Checkpoint{},
	}
}

func cloneJob(j *model.Job) *model.Job {
	c := *j
	c.State = append([]byte(nil), j.State...)
	return &c
}

func (m *Mem) CreateJob(_ context.Context, j *model.Job) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.jobs[j.ID]; ok {
		return ErrConflict
	}
	m.jobs[j.ID] = cloneJob(j)
	return nil
}

func (m *Mem) GetJob(_ context.Context, id string) (*model.Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return nil, ErrNotFound
	}
	return cloneJob(j), nil
}

func (m *Mem) ListJobs(_ context.Context) ([]*model.Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*model.Job, 0, len(m.jobs))
	for _, j := range m.jobs {
		out = append(out, cloneJob(j))
	}
	sort.Slice(out, func(a, b int) bool { return out[a].CreatedAt.Before(out[b].CreatedAt) })
	return out, nil
}

func (m *Mem) SetStatusCAS(_ context.Context, id, from, to string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return false, ErrNotFound
	}
	if j.Status != from {
		return false, nil
	}
	j.Status = to
	j.UpdatedAt = time.Now().UTC()
	return true, nil
}

func (m *Mem) CommitStep(_ context.Context, jobID string, epoch, fromSeq, toSeq int, state []byte, stateHash string, ops []model.Op) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[jobID]
	if !ok {
		return ErrNotFound
	}
	// A draining job is still authoritative: draining only means "stop starting
	// new work". Authority ends when the epoch moves.
	if j.Epoch != epoch || (j.Status != model.StatusRunning && j.Status != model.StatusDraining) {
		return ErrStaleEpoch
	}
	if j.Seq != fromSeq {
		return ErrConflict
	}
	j.Seq = toSeq
	j.State = append([]byte(nil), state...)
	j.StateHash = stateHash
	j.Ops += len(ops)
	j.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *Mem) TransferEpoch(_ context.Context, id string, fromEpoch int, owner, status string) (int, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return 0, false, ErrNotFound
	}
	if j.Epoch != fromEpoch {
		return 0, false, nil
	}
	j.Epoch++
	j.Owner = owner
	j.Status = status
	j.UpdatedAt = time.Now().UTC()
	return j.Epoch, true, nil
}

func (m *Mem) MarkDone(_ context.Context, id string, epoch int, checksum string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return ErrNotFound
	}
	if j.Epoch != epoch {
		return ErrStaleEpoch
	}
	j.Status = model.StatusDone
	j.Checksum = checksum
	j.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *Mem) MarkFailed(_ context.Context, id, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return ErrNotFound
	}
	j.Status = model.StatusFailed
	j.Checksum = reason
	j.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *Mem) MarkPause(_ context.Context, id string, pauseMs int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if j, ok := m.jobs[id]; ok {
		j.PauseMs = pauseMs
	}
	return nil
}

func (m *Mem) AddBytes(_ context.Context, id string, n int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if j, ok := m.jobs[id]; ok {
		j.BytesTotal += n
	}
	return nil
}

func (m *Mem) OpsCount(_ context.Context, id string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return 0, ErrNotFound
	}
	return j.Ops, nil
}

func (m *Mem) PutCheckpoint(_ context.Context, cp *model.Checkpoint) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := *cp
	m.cps[cp.JobID] = append(m.cps[cp.JobID], &c)
	return nil
}

func (m *Mem) LatestCheckpoint(_ context.Context, jobID string) (*model.Checkpoint, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := m.cps[jobID]
	if len(list) == 0 {
		return nil, ErrNotFound
	}
	c := *list[len(list)-1]
	return &c, nil
}

func (m *Mem) PutMigration(_ context.Context, mig *model.Migration) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextMig++
	mig.ID = m.nextMig
	c := *mig
	m.migs = append(m.migs, &c)
	return c.ID, nil
}

func (m *Mem) ListMigrations(_ context.Context, limit int) ([]*model.Migration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if limit <= 0 || limit > len(m.migs) {
		limit = len(m.migs)
	}
	out := make([]*model.Migration, 0, limit)
	for i := len(m.migs) - 1; i >= 0 && len(out) < limit; i-- {
		c := *m.migs[i]
		out = append(out, &c)
	}
	return out, nil
}

func (m *Mem) Close() error { return nil }
