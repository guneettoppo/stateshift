package store

import (
	"context"
	"testing"

	"github.com/guneettoppo/stateshift/internal/model"
)

func newJob(t *testing.T, st Store) *model.Job {
	t.Helper()
	j := &model.Job{
		ID:        "job-test",
		Workload:  "compute",
		Status:    model.StatusRunning,
		Owner:     "A",
		State:     []byte(`{"n":0}`),
		TotalSteps: 10,
	}
	if err := st.CreateJob(context.Background(), j); err != nil {
		t.Fatal(err)
	}
	return j
}

// The fence is the core consistency claim: exactly one winner can move the
// epoch, and the loser can never commit again.
func TestTransferEpochHasOneWinner(t *testing.T) {
	ctx := context.Background()
	st := NewMem()
	newJob(t, st)

	newEpoch, ok, err := st.TransferEpoch(ctx, "job-test", 0, "B", model.StatusRestoring)
	if err != nil || !ok {
		t.Fatalf("first fence should win: ok=%v err=%v", ok, err)
	}
	if newEpoch != 1 {
		t.Fatalf("expected epoch 1, got %d", newEpoch)
	}

	_, ok2, err := st.TransferEpoch(ctx, "job-test", 0, "C", model.StatusRestoring)
	if err != nil {
		t.Fatal(err)
	}
	if ok2 {
		t.Fatal("second fence with the stale epoch must not win")
	}
}

func TestStaleOwnerCannotCommit(t *testing.T) {
	ctx := context.Background()
	st := NewMem()
	newJob(t, st)

	if err := st.CommitStep(ctx, "job-test", 0, 0, 1, []byte(`{"n":1}`), "h1", []model.Op{{ID: "op-1", Result: "r"}}); err != nil {
		t.Fatalf("owns the job, commit should work: %v", err)
	}

	// Hand the job to B.
	if _, ok, err := st.TransferEpoch(ctx, "job-test", 0, "B", model.StatusRestoring); err != nil || !ok {
		t.Fatalf("fence: %v", err)
	}

	// A is now stale.
	err := st.CommitStep(ctx, "job-test", 0, 1, 2, []byte(`{"n":2}`), "h2", []model.Op{{ID: "op-2", Result: "r"}})
	if err != ErrStaleEpoch {
		t.Fatalf("expected ErrStaleEpoch for the fenced-out owner, got %v", err)
	}

	j, err := st.GetJob(ctx, "job-test")
	if err != nil {
		t.Fatal(err)
	}
	if j.Seq != 1 {
		t.Fatalf("fenced-out commit advanced the job: seq=%d", j.Seq)
	}
}

func TestDrainingOwnerCanStillCommit(t *testing.T) {
	ctx := context.Background()
	st := NewMem()
	newJob(t, st)

	if ok, err := st.SetStatusCAS(ctx, "job-test", model.StatusRunning, model.StatusDraining); err != nil || !ok {
		t.Fatalf("drain: %v", err)
	}
	// Draining means "stop starting work", not "lose authority": the final
	// in-flight step must still be able to commit, or a migration would always
	// lose a step.
	if err := st.CommitStep(ctx, "job-test", 0, 0, 1, []byte(`{"n":1}`), "h", []model.Op{{ID: "op-1"}}); err != nil {
		t.Fatalf("draining owner should still commit: %v", err)
	}
}
