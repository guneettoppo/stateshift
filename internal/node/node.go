// Package node is the worker agent: it runs one migratable job at a time per
// job ID, checkpoints at step boundaries, and accepts three control calls:
// start, quiesce and restore.
package node

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/guneettoppo/stateshift/internal/blob"
	"github.com/guneettoppo/stateshift/internal/chunk"
	"github.com/guneettoppo/stateshift/internal/model"
	"github.com/guneettoppo/stateshift/internal/store"
	"github.com/guneettoppo/stateshift/internal/workload"
)

// Config is the worker's tuning surface.
type Config struct {
	ID             string
	Addr           string // advertised base URL, e.g. http://10.0.0.5:9101
	CoordinatorURL string
	StepDelay      time.Duration
	CheckpointEach int
}

// Node is a worker agent.
type Node struct {
	cfg   Config
	store store.Store
	blob  blob.Blob
	reg   *workload.Registry
	httpc *http.Client

	mu   sync.Mutex
	runs map[string]*run
}

type run struct {
	jobID string
	epoch int
	cancel context.CancelFunc
	pause  chan chan quiesceResult
	stopped chan struct{}

	seqMu sync.Mutex
	seq   int
}

func (r *run) setSeq(n int) {
	r.seqMu.Lock()
	r.seq = n
	r.seqMu.Unlock()
}

func (r *run) getSeq() int {
	r.seqMu.Lock()
	defer r.seqMu.Unlock()
	return r.seq
}

// quiesceResult is what the source node reports after freezing at a boundary.
type quiesceResult struct {
	Seq         int       `json:"seq"`
	ManifestKey string    `json:"manifest_key"`
	StateHash   string    `json:"state_hash"`
	Size        int       `json:"size"`
	Chunks      int       `json:"chunks"`
	Uploaded    int       `json:"chunks_uploaded"`
	Skipped     int       `json:"chunks_skipped"`
	Bytes       int64     `json:"bytes"`
	QuiescedAt  time.Time `json:"quiesced_at"`
	Err         string    `json:"error,omitempty"`
}

func New(cfg Config, st store.Store, b blob.Blob, reg *workload.Registry) *Node {
	return &Node{
		cfg:   cfg,
		store: st,
		blob:  b,
		reg:   reg,
		httpc: &http.Client{Timeout: 60 * time.Second},
		runs:  map[string]*run{},
	}
}

// Handler returns the worker's internal API.
func (n *Node) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /internal/health", n.handleHealth)
	mux.HandleFunc("GET /internal/jobs", n.handleJobs)
	mux.HandleFunc("POST /internal/start", n.handleStart)
	mux.HandleFunc("POST /internal/quiesce", n.handleQuiesce)
	mux.HandleFunc("POST /internal/restore", n.handleRestore)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (n *Node) handleHealth(w http.ResponseWriter, _ *http.Request) {
	n.mu.Lock()
	ids := make([]string, 0, len(n.runs))
	for id := range n.runs {
		ids = append(ids, id)
	}
	n.mu.Unlock()
	writeJSON(w, 200, map[string]any{"node": n.cfg.ID, "addr": n.cfg.Addr, "running": ids})
}

func (n *Node) handleJobs(w http.ResponseWriter, _ *http.Request) {
	n.mu.Lock()
	out := make([]map[string]any, 0, len(n.runs))
	for _, r := range n.runs {
		out = append(out, map[string]any{"job_id": r.jobID, "epoch": r.epoch, "seq": r.getSeq()})
	}
	n.mu.Unlock()
	writeJSON(w, 200, out)
}

type startReq struct {
	JobID string `json:"job_id"`
	Epoch int    `json:"epoch"`
}

// handleStart begins (or resumes) execution of a job from the state already in
// the store. Used for the initial start and for failover back to the source.
func (n *Node) handleStart(w http.ResponseWriter, r *http.Request) {
	var req startReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	job, err := n.store.GetJob(r.Context(), req.JobID)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": err.Error()})
		return
	}
	if job.Owner != "" && job.Owner != n.cfg.ID {
		writeJSON(w, 409, map[string]string{"error": "job owned by " + job.Owner})
		return
	}
	wl, ok := n.reg.Get(job.Workload)
	if !ok {
		writeJSON(w, 400, map[string]string{"error": "unknown workload " + job.Workload})
		return
	}
	if _, err := n.store.SetStatusCAS(r.Context(), job.ID, model.StatusDrained, model.StatusRunning); err != nil {
		log.Printf("node %s: status reset: %v", n.cfg.ID, err)
	}
	n.startRun(job.ID, req.Epoch, wl, job.State, job.Seq)
	writeJSON(w, 200, map[string]any{"ok": true, "node": n.cfg.ID, "seq": job.Seq})
}

type quiesceReq struct {
	JobID string `json:"job_id"`
	Epoch int    `json:"epoch"`
}

// handleQuiesce freezes the job at the next step boundary, writes a checkpoint
// and reports where it stopped. The node then stops executing: from now on the
// epoch decides who is authoritative.
func (n *Node) handleQuiesce(w http.ResponseWriter, r *http.Request) {
	var req quiesceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	n.mu.Lock()
	r0 := n.runs[req.JobID]
	n.mu.Unlock()
	if r0 == nil {
		writeJSON(w, 409, map[string]string{"error": "job not running on " + n.cfg.ID})
		return
	}
	if r0.epoch != req.Epoch {
		writeJSON(w, 409, map[string]string{"error": "epoch mismatch on source"})
		return
	}

	reply := make(chan quiesceResult, 1)
	select {
	case r0.pause <- reply:
	case <-r0.stopped:
		writeJSON(w, 409, map[string]string{"error": "job finished before quiesce"})
		return
	case <-time.After(2 * time.Second):
		writeJSON(w, 409, map[string]string{"error": "node busy, retry"})
		return
	}

	select {
	case res := <-reply:
		if res.Err != "" {
			writeJSON(w, 500, res)
			return
		}
		// Freeze: the run has returned, drop it from the local table.
		n.mu.Lock()
		delete(n.runs, req.JobID)
		n.mu.Unlock()
		r0.cancel()
		writeJSON(w, 200, res)
	case <-time.After(15 * time.Second):
		writeJSON(w, 504, map[string]string{"error": "quiesce timed out"})
	}
}

type restoreReq struct {
	JobID       string `json:"job_id"`
	Seq         int    `json:"seq"`
	Epoch       int    `json:"epoch"`
	ManifestKey string `json:"manifest_key"`
}

// handleRestore pulls the checkpoint from the blob store, verifies its hash and
// resumes execution here under the new epoch.
func (n *Node) handleRestore(w http.ResponseWriter, r *http.Request) {
	var req restoreReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	job, err := n.store.GetJob(r.Context(), req.JobID)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": err.Error()})
		return
	}
	if job.Epoch != req.Epoch {
		writeJSON(w, 409, map[string]string{"error": fmt.Sprintf("epoch mismatch: want %d have %d", req.Epoch, job.Epoch)})
		return
	}
	wl, ok := n.reg.Get(job.Workload)
	if !ok {
		writeJSON(w, 400, map[string]string{"error": "unknown workload " + job.Workload})
		return
	}

	man, state, st, err := chunk.Get(r.Context(), n.blob, req.ManifestKey)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if man.Seq != req.Seq {
		writeJSON(w, 409, map[string]string{"error": fmt.Sprintf("manifest seq %d != requested %d", man.Seq, req.Seq)})
		return
	}
	// Cross-check the DB's state hash: the blob and the control plane must agree.
	sum := sha256.Sum256(state)
	if hex.EncodeToString(sum[:]) != job.StateHash && job.StateHash != "" {
		writeJSON(w, 409, map[string]string{"error": "restored state does not match committed state hash"})
		return
	}

	if ok, err := n.store.SetStatusCAS(r.Context(), job.ID, model.StatusRestoring, model.StatusRunning); err != nil || !ok {
		writeJSON(w, 409, map[string]string{"error": "could not claim job for resume"})
		return
	}

	n.startRun(job.ID, req.Epoch, wl, state, req.Seq)
	writeJSON(w, 200, map[string]any{
		"ok":            true,
		"node":          n.cfg.ID,
		"seq":           req.Seq,
		"bytes":         st.Bytes,
		"chunks_fetched": st.Uploaded,
		"resumed_at":    time.Now().UTC(),
	})
}

func (n *Node) startRun(jobID string, epoch int, wl workload.Workload, state []byte, seq int) {
	n.stopRun(jobID)
	ctx, cancel := context.WithCancel(context.Background())
	r := &run{
		jobID:   jobID,
		epoch:   epoch,
		cancel:  cancel,
		pause:   make(chan chan quiesceResult, 1),
		stopped: make(chan struct{}),
		seq:     seq,
	}
	n.mu.Lock()
	n.runs[jobID] = r
	n.mu.Unlock()
	go n.runJob(ctx, r, wl, state, seq)
}

func (n *Node) stopRun(jobID string) {
	n.mu.Lock()
	r := n.runs[jobID]
	delete(n.runs, jobID)
	n.mu.Unlock()
	if r == nil {
		return
	}
	r.cancel()
	select {
	case <-r.stopped:
	case <-time.After(5 * time.Second):
	}
}

// runJob is the execution loop. Its only authority check is CommitStep: if the
// epoch moved, the step is rejected and the loop exits without side effects.
func (n *Node) runJob(ctx context.Context, r *run, wl workload.Workload, state []byte, seq int) {
	defer close(r.stopped)
	stepsSince := 0

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		next, ops, done, err := wl.Step(ctx, state)
		if err != nil {
			log.Printf("node %s job %s: step error: %v", n.cfg.ID, r.jobID, err)
			_ = n.store.MarkFailed(ctx, r.jobID, err.Error())
			return
		}

		sum := sha256.Sum256(next)
		if err := n.store.CommitStep(ctx, r.jobID, r.epoch, seq, seq+1, next, hex.EncodeToString(sum[:]), ops); err != nil {
			if errors.Is(err, store.ErrStaleEpoch) {
				log.Printf("node %s job %s: fenced out at seq %d (epoch %d)", n.cfg.ID, r.jobID, seq, r.epoch)
				return
			}
			log.Printf("node %s job %s: commit failed: %v", n.cfg.ID, r.jobID, err)
			return
		}

		state = next
		seq++
		r.setSeq(seq)
		stepsSince++

		// Migration request: checkpoint here, report, then stop executing.
		select {
		case reply := <-r.pause:
			res := n.checkpoint(ctx, r.jobID, r.epoch, seq, state)
			reply <- res
			return
		default:
		}

		if done {
			if err := n.store.MarkDone(ctx, r.jobID, r.epoch, wl.Checksum(state)); err != nil {
				log.Printf("node %s job %s: mark done: %v", n.cfg.ID, r.jobID, err)
			}
			return
		}

		if n.cfg.CheckpointEach > 0 && stepsSince >= n.cfg.CheckpointEach {
			stepsSince = 0
			if res := n.checkpoint(ctx, r.jobID, r.epoch, seq, state); res.Err != "" {
				log.Printf("node %s job %s: periodic checkpoint: %s", n.cfg.ID, r.jobID, res.Err)
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(n.cfg.StepDelay):
		}
	}
}

func (n *Node) checkpoint(ctx context.Context, jobID string, epoch, seq int, state []byte) quiesceResult {
	res := quiesceResult{Seq: seq, QuiescedAt: time.Now().UTC()}

	key, hash, chunks, st, err := chunk.Put(ctx, n.blob, jobID, seq, epoch, state)
	if err != nil {
		res.Err = err.Error()
		return res
	}

	cp := &model.Checkpoint{
		JobID:       jobID,
		Seq:         seq,
		Epoch:       epoch,
		ManifestKey: key,
		StateHash:   hash,
		Size:        len(state),
		Chunks:      chunks,
		Uploaded:    st.Uploaded,
		Skipped:     st.Skipped,
		CreatedAt:   res.QuiescedAt,
	}
	if err := n.store.PutCheckpoint(ctx, cp); err != nil {
		res.Err = err.Error()
		return res
	}
	if err := n.store.AddBytes(ctx, jobID, st.Bytes); err != nil {
		log.Printf("node %s: add bytes: %v", n.cfg.ID, err)
	}

	res.ManifestKey = key
	res.StateHash = hash
	res.Size = len(state)
	res.Chunks = chunks
	res.Uploaded = st.Uploaded
	res.Skipped = st.Skipped
	res.Bytes = st.Bytes
	return res
}

// Register keeps this node visible to the coordinator.
func (n *Node) Register(ctx context.Context) {
	if n.cfg.CoordinatorURL == "" {
		return
	}
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	body := map[string]string{"id": n.cfg.ID, "addr": n.cfg.Addr}
	for {
		payload, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.cfg.CoordinatorURL+"/api/nodes/register", bytes.NewReader(payload))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
			if resp, err := n.httpc.Do(req); err == nil {
				resp.Body.Close()
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
