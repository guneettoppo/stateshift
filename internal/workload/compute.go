package workload

import (
	"context"
	"encoding/hex"
	"fmt"

	"github.com/guneettoppo/stateshift/internal/model"
)

// Compute is a deterministic CPU-bound job: the correctness proof. Every step
// mixes a 64-bit accumulator, so the final checksum is a strict fingerprint of
// having executed exactly the right steps in exactly the right order.
type Compute struct{}

// computeState is shaped like most real in-memory workloads: a large resident
// dataset that does not change, followed by a small mutable progress tail.
// The immutable section comes first and the mutable section is fixed width, so
// consecutive checkpoints differ only in their trailing chunks - which is what
// content-defined chunking is able to skip.
type computeState struct {
	Base  string `json:"base"`
	Total int    `json:"total"`
	Done  string `json:"done"`
	Acc   string `json:"acc"`
	Sum   string `json:"sum"`
}

const basePadSize = 12288

var padOnce string

// basePad is a deterministic 12 KiB resident dataset, identical on every node.
func basePad() string {
	if padOnce != "" {
		return padOnce
	}
	const hexdigits = "0123456789abcdef"
	buf := make([]byte, basePadSize)
	x := uint64(0x9E3779B97F4A7C15)
	for i := 0; i < len(buf); i++ {
		x ^= x << 13
		x ^= x >> 7
		x ^= x << 17
		buf[i] = hexdigits[x&0xF]
	}
	padOnce = string(buf)
	return padOnce
}

func (Compute) Name() string { return "compute" }

func (Compute) Init(params map[string]any) ([]byte, int, error) {
	total := paramInt(params, "steps", 400)
	if total < 10 {
		total = 10
	}
	if total > 100000 {
		total = 100000
	}
	st := computeState{
		Base:  basePad(),
		Total: total,
		Done:  "000000",
		Acc:   "243f6a8885a308d3",
		Sum:   "0000000000000000",
	}
	raw, err := encode(st)
	return raw, total, err
}

func (Compute) Step(_ context.Context, raw []byte) ([]byte, []model.Op, bool, error) {
	st, err := decode[computeState](raw)
	if err != nil {
		return nil, nil, false, err
	}

	acc, err := hex.DecodeString(st.Acc)
	if err != nil {
		return nil, nil, false, err
	}
	sum, err := hex.DecodeString(st.Sum)
	if err != nil {
		return nil, nil, false, err
	}

	// A little real work so a step is not free: ~200k iterations per step.
	a := toU64(acc)
	s := toU64(sum)
	for i := 0; i < 200_000; i++ {
		a = a*6364136223846793005 + 1442695040888963407
		a ^= a >> 29
	}
	s += a

	done := atoiSafe(st.Done) + 1
	st.Acc = fmt.Sprintf("%016x", a)
	st.Sum = fmt.Sprintf("%016x", s)
	st.Done = fmt.Sprintf("%06d", done)

	op := model.Op{
		ID:     "compute-" + st.Done,
		Result: st.Sum[8:],
	}
	next, err := encode(st)
	if err != nil {
		return nil, nil, false, err
	}
	return next, []model.Op{op}, done >= st.Total, nil
}

func (Compute) Checksum(raw []byte) string {
	st, err := decode[computeState](raw)
	if err != nil {
		return ""
	}
	return st.Sum
}

func toU64(b []byte) uint64 {
	var v uint64
	for _, x := range b {
		v = v<<8 | uint64(x)
	}
	return v
}

func atoiSafe(s string) int {
	n := 0
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return n
		}
		n = n*10 + int(s[i]-'0')
	}
	return n
}
