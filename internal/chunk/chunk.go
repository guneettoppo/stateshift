// Package chunk implements content-defined chunking and content-addressed
// checkpoint transfer.
//
// The point of content-defined chunking here is measurable: consecutive
// checkpoints of the same job share most chunks, so the second migration ships
// only the chunks that actually changed. That is the "avoid retransmitting
// unchanged state" requirement of the problem statement, and it is what the
// delta numbers on the dashboard come from.
package chunk

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/guneettoppo/stateshift/internal/blob"
)

const (
	minChunk   = 256
	maxChunk   = 4096
	chunkMask  = 0x3FF // ~1 KiB average
	gearPrime  = 0x9E3779B97F4A7C15
	manifestID = "sha256"
)

// gear table is generated deterministically so every node chunks identically.
var gear [256]uint64

func init() {
	x := uint64(0x2545F4914F6CDD1D)
	for i := 0; i < 256; i++ {
		x ^= x << 13
		x ^= x >> 7
		x ^= x << 17
		gear[i] = x * gearPrime
	}
}

// Ref points at one chunk inside a manifest.
type Ref struct {
	Hash string `json:"h"`
	Off  int    `json:"o"`
	Len  int    `json:"l"`
}

// Manifest is the checkpoint envelope: how to rebuild the state blob and what
// it must hash to.
type Manifest struct {
	JobID     string `json:"job"`
	Seq       int    `json:"seq"`
	Epoch     int    `json:"epoch"`
	Algo      string `json:"algo"`
	StateHash string `json:"state_hash"`
	Size      int    `json:"size"`
	Chunks    []Ref  `json:"chunks"`
}

// Split cuts data into content-defined chunks and returns their refs plus the
// chunk bytes keyed by hash.
func Split(data []byte) ([]Ref, map[string][]byte) {
	var refs []Ref
	chunks := map[string][]byte{}
	start := 0
	var h uint64

	for i := 0; i < len(data); i++ {
		h = (h << 1) + gear[data[i]]
		size := i - start + 1
		if size < minChunk {
			continue
		}
		if size >= maxChunk || (h&chunkMask) == 0 {
			part := data[start : i+1]
			sum := sha256.Sum256(part)
			key := hex.EncodeToString(sum[:])
			chunks[key] = part
			refs = append(refs, Ref{Hash: key, Off: start, Len: len(part)})
			start = i + 1
			h = 0
		}
	}
	if start < len(data) {
		part := data[start:]
		sum := sha256.Sum256(part)
		key := hex.EncodeToString(sum[:])
		chunks[key] = part
		refs = append(refs, Ref{Hash: key, Off: start, Len: len(part)})
	}
	return refs, chunks
}

// Stats reports what a Put actually moved.
type Stats struct {
	Uploaded int
	Skipped  int
	Bytes    int64
}

// Put chunks the state, uploads only chunks the store does not already have,
// and writes the manifest.
func Put(ctx context.Context, b blob.Blob, jobID string, seq, epoch int, state []byte) (string, string, int, Stats, error) {
	refs, chunks := Split(state)
	sum := sha256.Sum256(state)
	stateHash := hex.EncodeToString(sum[:])

	var st Stats
	for _, ref := range refs {
		key := blob.ChunkKey(ref.Hash)
		if b.Has(ctx, key) {
			st.Skipped++
			continue
		}
		if err := b.Put(ctx, key, chunks[ref.Hash]); err != nil {
			return "", "", 0, st, err
		}
		st.Uploaded++
		st.Bytes += int64(ref.Len)
	}

	m := Manifest{
		JobID:     jobID,
		Seq:       seq,
		Epoch:     epoch,
		Algo:      manifestID,
		StateHash: stateHash,
		Size:      len(state),
		Chunks:    refs,
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return "", "", 0, st, err
	}
	key := blob.ManifestKey(jobID, seq)
	if err := b.Put(ctx, key, raw); err != nil {
		return "", "", 0, st, err
	}
	return key, stateHash, len(refs), st, nil
}

// Get reassembles a checkpoint and verifies it against the manifest hash.
func Get(ctx context.Context, b blob.Blob, manifestKey string) (*Manifest, []byte, Stats, error) {
	raw, err := b.Get(ctx, manifestKey)
	if err != nil {
		return nil, nil, Stats{}, err
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, nil, Stats{}, err
	}

	var buf bytes.Buffer
	var st Stats
	for _, ref := range m.Chunks {
		data, err := b.Get(ctx, blob.ChunkKey(ref.Hash))
		if err != nil {
			return nil, nil, st, fmt.Errorf("chunk %s: %w", ref.Hash, err)
		}
		st.Bytes += int64(len(data))
		st.Uploaded++
		buf.Write(data)
	}
	state := buf.Bytes()
	sum := sha256.Sum256(state)
	if hex.EncodeToString(sum[:]) != m.StateHash {
		return nil, nil, st, fmt.Errorf("state hash mismatch: manifest %s, reassembled %x", m.StateHash, sum[:])
	}
	return &m, state, st, nil
}
