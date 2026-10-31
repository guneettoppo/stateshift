// Package workload defines the step-state-machine that StateShift migrates.
//
// This is the scoping decision that makes the project feasible: we migrate
// explicit application state at step boundaries, not kernel memory and sockets.
// Any workload that can express progress as (opaque state, one step at a time)
// can be checkpointed, moved and resumed.
package workload

import (
	"context"
	"encoding/json"

	"github.com/guneettoppo/stateshift/internal/model"
)

// Workload is one migratable program.
type Workload interface {
	Name() string
	// Init builds the initial state from user params and reports the number of
	// steps the job will take (used for progress display only).
	Init(params map[string]any) (state []byte, totalSteps int, err error)
	// Step advances exactly one unit of work. It must be safe to call again
	// with an older state: the op IDs are what make replay a no-op.
	Step(ctx context.Context, state []byte) (next []byte, ops []model.Op, done bool, err error)
	// Checksum summarises the final state so two runs can be compared.
	Checksum(state []byte) string
}

// Registry resolves workload names coming off the wire.
type Registry struct {
	m map[string]Workload
}

func NewRegistry(ws ...Workload) *Registry {
	r := &Registry{m: make(map[string]Workload, len(ws))}
	for _, w := range ws {
		r.m[w.Name()] = w
	}
	return r
}

func (r *Registry) Get(name string) (Workload, bool) {
	w, ok := r.m[name]
	return w, ok
}

func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.m))
	for k := range r.m {
		out = append(out, k)
	}
	return out
}

func decode[T any](state []byte) (T, error) {
	var v T
	err := json.Unmarshal(state, &v)
	return v, err
}

func encode(v any) ([]byte, error) { return json.Marshal(v) }

func paramInt(params map[string]any, key string, def int) int {
	if params == nil {
		return def
	}
	switch v := params[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		n, err := v.Int64()
		if err == nil {
			return int(n)
		}
	}
	return def
}

func paramStr(params map[string]any, key, def string) string {
	if params == nil {
		return def
	}
	if s, ok := params[key].(string); ok && s != "" {
		return s
	}
	return def
}
