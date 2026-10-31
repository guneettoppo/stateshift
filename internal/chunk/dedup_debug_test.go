package chunk

import (
	"context"
	"fmt"
	"testing"

	"github.com/guneettoppo/stateshift/internal/blob"
	"github.com/guneettoppo/stateshift/internal/workload"
)

func TestDedupeAcrossConsecutiveComputeStates(t *testing.T) {
	ctx := context.Background()
	b, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cw := workload.Compute{}
	state, _, err := cw.Init(map[string]any{"steps": 200})
	if err != nil {
		t.Fatal(err)
	}
	// advance 40 steps
	for i := 0; i < 40; i++ {
		next, _, _, err := cw.Step(ctx, state)
		if err != nil {
			t.Fatal(err)
		}
		state = next
	}
	keyA, _, nA, stA, err := Put(ctx, b, "dbg", 40, 0, state)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		next, _, _, err := cw.Step(ctx, state)
		if err != nil {
			t.Fatal(err)
		}
		state = next
	}
	_, _, nB, stB, err := Put(ctx, b, "dbg", 50, 0, state)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("state size=%d chunksA=%d uploadedA=%d bytesA=%d | chunksB=%d uploadedB=%d skippedB=%d bytesB=%d\n",
		len(state), nA, stA.Uploaded, stA.Bytes, nB, stB.Uploaded, stB.Skipped, stB.Bytes)

	man, raw, _, err := Get(ctx, b, keyA)
	if err != nil {
		t.Fatal(err)
	}
	_ = man
	_ = raw
	if stB.Skipped == 0 {
		t.Fatalf("no chunk reuse across 10 steps: chunking is not content-defined")
	}
}
