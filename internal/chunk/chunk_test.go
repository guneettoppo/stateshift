package chunk

import (
	"bytes"
	"context"
	"testing"

	"github.com/guneettoppo/stateshift/internal/blob"
)

func TestSplitReassemblesExactly(t *testing.T) {
	data := bytes.Repeat([]byte("stateshift-checkpoint-payload-"), 400)
	refs, chunks := Split(data)
	if len(refs) < 2 {
		t.Fatalf("expected multiple chunks, got %d", len(refs))
	}
	var buf bytes.Buffer
	for _, r := range refs {
		if r.Off+r.Len > len(data) {
			t.Fatalf("ref out of range: %+v", r)
		}
		buf.Write(chunks[r.Hash])
	}
	if !bytes.Equal(buf.Bytes(), data) {
		t.Fatal("reassembled bytes differ from input")
	}
}

func TestPutDedupesUnchangedChunks(t *testing.T) {
	ctx := context.Background()
	b, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	// Two states that share a long prefix: the second checkpoint should skip
	// most chunks, which is the whole delta-transfer claim.
	base := bytes.Repeat([]byte("0123456789abcdef"), 600)
	v1 := append(append([]byte{}, base...), []byte("...tail-one")...)
	v2 := append(append([]byte{}, base...), []byte("...tail-two")...)

	_, hash1, n1, st1, err := Put(ctx, b, "job-x", 10, 0, v1)
	if err != nil {
		t.Fatal(err)
	}
	if st1.Uploaded == 0 {
		t.Fatal("first checkpoint uploaded nothing")
	}
	_, hash2, n2, st2, err := Put(ctx, b, "job-x", 20, 0, v2)
	if err != nil {
		t.Fatal(err)
	}

	if hash1 == hash2 {
		t.Fatal("different states produced the same hash")
	}
	if n1 != n2 {
		t.Fatalf("chunk count changed unexpectedly: %d vs %d", n1, n2)
	}
	if st2.Skipped == 0 {
		t.Fatal("second checkpoint skipped no chunks: dedupe is not working")
	}
	if st2.Uploaded >= n2 {
		t.Fatalf("expected the second checkpoint to upload fewer than all chunks, uploaded %d of %d", st2.Uploaded, n2)
	}
	if st2.Bytes > st1.Bytes {
		t.Fatalf("second checkpoint moved more bytes than the first: %d > %d", st2.Bytes, st1.Bytes)
	}
}

func TestGetVerifiesHash(t *testing.T) {
	ctx := context.Background()
	b, err := blob.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	state := []byte(`{"hello":"world","n":42}`)
	key, hash, _, _, err := Put(ctx, b, "job-y", 5, 3, state)
	if err != nil {
		t.Fatal(err)
	}

	man, got, _, err := Get(ctx, b, key)
	if err != nil {
		t.Fatal(err)
	}
	if man.StateHash != hash {
		t.Fatalf("manifest hash %s != %s", man.StateHash, hash)
	}
	if !bytes.Equal(got, state) {
		t.Fatalf("state mismatch: %s", got)
	}

	// Corrupt a chunk and make sure verification catches it.
	ref := man.Chunks[0]
	if err := b.Put(ctx, blob.ChunkKey(ref.Hash), []byte("tampered")); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := Get(ctx, b, key); err == nil {
		t.Fatal("corrupted chunk was accepted: hash verification is not working")
	}
}
