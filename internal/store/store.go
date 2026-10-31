package store

import (
	"context"
	"errors"

	"github.com/guneettoppo/stateshift/internal/model"
)

var (
	// ErrNotFound is returned when a job or checkpoint does not exist.
	ErrNotFound = errors.New("store: not found")
	// ErrStaleEpoch means the caller no longer owns the job. This is the
	// single authority check in the system: a node that gets this must stop.
	ErrStaleEpoch = errors.New("store: stale epoch")
	// ErrConflict means a compare-and-swap did not apply.
	ErrConflict = errors.New("store: conflict")
)

// Store is the coordination substrate. Both implementations (mem for
// single-machine rehearsal, pg for YugabyteDB/Postgres) must give the same
// atomicity guarantees; that is what makes the migration safe rather than lucky.
type Store interface {
	CreateJob(ctx context.Context, j *model.Job) error
	GetJob(ctx context.Context, id string) (*model.Job, error)
	ListJobs(ctx context.Context) ([]*model.Job, error)

	// SetStatusCAS moves a job between statuses without changing its epoch.
	SetStatusCAS(ctx context.Context, id, from, to string) (bool, error)

	// CommitStep applies the step's ops and advances the sequence number in one
	// atomic unit, but only if epoch still owns the job. Returns ErrStaleEpoch
	// when it does not.
	CommitStep(ctx context.Context, jobID string, epoch, fromSeq, toSeq int, state []byte, stateHash string, ops []model.Op) error

	// TransferEpoch atomically increments the epoch and hands ownership to
	// owner. This is the fence: only one caller can win.
	TransferEpoch(ctx context.Context, id string, fromEpoch int, owner, status string) (int, bool, error)

	MarkDone(ctx context.Context, id string, epoch int, checksum string) error
	MarkFailed(ctx context.Context, id, reason string) error
	MarkPause(ctx context.Context, id string, pauseMs int) error
	AddBytes(ctx context.Context, id string, n int64) error
	OpsCount(ctx context.Context, id string) (int, error)

	PutCheckpoint(ctx context.Context, cp *model.Checkpoint) error
	LatestCheckpoint(ctx context.Context, jobID string) (*model.Checkpoint, error)

	PutMigration(ctx context.Context, m *model.Migration) (int64, error)
	ListMigrations(ctx context.Context, limit int) ([]*model.Migration, error)

	Close() error
}
