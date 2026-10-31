// Package e2e exercises the whole handover across two real HTTP worker nodes.
package e2e

import (
	"context"
	"encoding/json"
	"math/rand"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/guneettoppo/stateshift/internal/blob"
	"github.com/guneettoppo/stateshift/internal/coordinator"
	"github.com/guneettoppo/stateshift/internal/model"
	"github.com/guneettoppo/stateshift/internal/node"
	"github.com/guneettoppo/stateshift/internal/store"
	"github.com/guneettoppo/stateshift/internal/workload"
)

type fleet struct {
	coord  *coordinator.Coordinator
	store  *store.Mem
	nodeA  *node.Node
	nodeB  *node.Node
	srvA   *httptest.Server
	srvB   *httptest.Server
	coordS *httptest.Server
}

func newFleet(t *testing.T, checkpointEach int) *fleet {
	t.Helper()
	ctx := context.Background()

	st := store.NewMem()
	b, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	reg := workload.NewRegistry(workload.Compute{}, workload.Agent{Client: workload.MockLLM{}})

	nodeA := node.New(node.Config{ID: "A", StepDelay: time.Millisecond, CheckpointEach: checkpointEach}, st, b, reg)
	nodeB := node.New(node.Config{ID: "B", StepDelay: time.Millisecond, CheckpointEach: checkpointEach}, st, b, reg)
	srvA := httptest.NewServer(nodeA.Handler())
	srvB := httptest.NewServer(nodeB.Handler())

	coord := coordinator.New(st, b, reg, map[string]string{"db": "mem", "blob": b.Name(), "llm": "mock"})
	coordS := httptest.NewServer(coord.Handler())
	now := time.Now().UTC()
	coord.SeedNodes(
		&model.NodeInfo{ID: "A", Addr: srvA.URL, LastSeen: now},
		&model.NodeInfo{ID: "B", Addr: srvB.URL, LastSeen: now},
	)

	f := &fleet{coord: coord, store: st, nodeA: nodeA, nodeB: nodeB, srvA: srvA, srvB: srvB, coordS: coordS}
	t.Cleanup(func() {
		srvA.Close()
		srvB.Close()
		coordS.Close()
		_ = ctx
	})
	return f
}

func waitFor(t *testing.T, what string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestMigrateMidFlightKeepsExactlyOnceSemantics(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	f := newFleet(t, 10)
	const steps = 80

	job, err := f.coord.CreateJob(ctx, coordinator.CreateJobRequest{Workload: "compute", Steps: steps})
	if err != nil {
		t.Fatal(err)
	}

	// Let it make real progress, then move it while it is running.
	waitFor(t, "job to pass seq 20", func() bool {
		j, err := f.store.GetJob(ctx, job.ID)
		return err == nil && j.Seq >= 20
	})

	target := "B"
	if job.Owner == "B" {
		target = "A"
	}

	mig, err := f.coord.Migrate(ctx, job.ID, target)
	if err != nil {
		t.Fatalf("migrate: %v (migration=%+v)", err, mig)
	}
	if mig.Outcome != "ok" {
		t.Fatalf("migration outcome %q, want ok", mig.Outcome)
	}
	if mig.EpochFrom != 0 || mig.EpochTo != 1 {
		t.Fatalf("epoch %d->%d, want 0->1", mig.EpochFrom, mig.EpochTo)
	}

	afterMigrate, err := f.store.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterMigrate.Owner != target {
		t.Fatalf("owner after migration is %q, want %q", afterMigrate.Owner, target)
	}
	if afterMigrate.Epoch != 1 {
		t.Fatalf("epoch after migration is %d, want 1", afterMigrate.Epoch)
	}

	waitFor(t, "job to finish on the target node", func() bool {
		j, err := f.store.GetJob(ctx, job.ID)
		return err == nil && j.Status == model.StatusDone
	})

	finished, err := f.store.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}

	// Exactly-once: every step committed exactly one op, none twice.
	ops, err := f.store.OpsCount(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ops != steps {
		t.Fatalf("op log has %d rows for %d steps: work was repeated or lost", ops, steps)
	}

	// Correctness: a run that never migrated must end at the same checksum.
	control, err := f.coord.CreateJob(ctx, coordinator.CreateJobRequest{Workload: "compute", Steps: steps})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "control job to finish", func() bool {
		j, err := f.store.GetJob(ctx, control.ID)
		return err == nil && j.Status == model.StatusDone
	})
	ctrl, err := f.store.GetJob(ctx, control.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ctrl.Checksum == "" || finished.Checksum != ctrl.Checksum {
		t.Fatalf("migrated checksum %q != control checksum %q (state was corrupted by migration)",
			finished.Checksum, ctrl.Checksum)
	}
	if mig.PauseMs < 0 {
		t.Fatalf("negative pause: %d", mig.PauseMs)
	}
	t.Logf("migrated %s at seq %d: pause=%dms bytes=%d chunks_sent=%d deduped=%d checksum=%s",
		job.ID, mig.Skipped, mig.PauseMs, mig.BytesSent, mig.ChunksSent, mig.Skipped, finished.Checksum)
}

func TestSecondMigrationShipsLessThanFirst(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	f := newFleet(t, 8)
	const steps = 120

	job, err := f.coord.CreateJob(ctx, coordinator.CreateJobRequest{Workload: "compute", Steps: steps})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "seq >= 24", func() bool {
		j, err := f.store.GetJob(ctx, job.ID)
		return err == nil && j.Seq >= 24
	})

	first, err := f.coord.Migrate(ctx, job.ID, other(job.Owner))
	if err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	waitFor(t, "seq >= 48", func() bool {
		j, err := f.store.GetJob(ctx, job.ID)
		return err == nil && j.Seq >= 48
	})

	j2, err := f.store.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.coord.Migrate(ctx, job.ID, other(j2.Owner))
	if err != nil {
		t.Fatalf("second migrate: %v", err)
	}

	if first.Outcome != "ok" || second.Outcome != "ok" {
		t.Fatalf("outcomes %q %q", first.Outcome, second.Outcome)
	}
	if second.EpochTo != 2 {
		t.Fatalf("second migration epoch %d, want 2", second.EpochTo)
	}
	// The state only grows by one step between checkpoints, so the second hop
	// must not resend everything: some chunks are already in the store.
	if second.Skipped == 0 {
		t.Fatalf("second migration deduped nothing (skipped=0, sent=%d)", second.ChunksSent)
	}
	t.Logf("first: sent=%d skipped=%d bytes=%d | second: sent=%d skipped=%d bytes=%d",
		first.ChunksSent, first.Skipped, first.BytesSent,
		second.ChunksSent, second.Skipped, second.BytesSent)
}

func TestMigrateRejectsUnknownTarget(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	f := newFleet(t, 10)
	job, err := f.coord.CreateJob(ctx, coordinator.CreateJobRequest{Workload: "compute", Steps: 40})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.coord.Migrate(ctx, job.ID, "does-not-exist"); err == nil {
		t.Fatal("migrating to an unregistered node should fail")
	}
	// The job must still be running on its original owner afterwards.
	j, err := f.store.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if j.Status != model.StatusRunning && j.Status != model.StatusDone {
		t.Fatalf("job left in %q after a rejected migration", j.Status)
	}
}

func TestAgentWorkloadMigrates(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	f := newFleet(t, 6)
	job, err := f.coord.CreateJob(ctx, coordinator.CreateJobRequest{Workload: "agent", Steps: 14, Prompt: "why does resumption matter"})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, "agent seq >= 4", func() bool {
		j, err := f.store.GetJob(ctx, job.ID)
		return err == nil && j.Seq >= 4
	})
	mig, err := f.coord.Migrate(ctx, job.ID, other(job.Owner))
	if err != nil {
		t.Fatalf("migrate agent: %v", err)
	}
	if mig.Outcome != "ok" {
		t.Fatalf("outcome %q", mig.Outcome)
	}
	waitFor(t, "agent job done", func() bool {
		j, err := f.store.GetJob(ctx, job.ID)
		return err == nil && j.Status == model.StatusDone
	})
	ops, err := f.store.OpsCount(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ops != 14 {
		t.Fatalf("agent op log has %d rows for 14 steps", ops)
	}
}

func other(node string) string {
	if node == "A" {
		return "B"
	}
	return "A"
}

var _ = rand.Int
var _ = json.Marshal
