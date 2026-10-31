// Package coordinator is the control plane: it owns the fleet view, creates
// jobs, and drives migrations. It is deliberately the only component that talks
// to UI, which keeps jobs addressable by logical ID rather than by node.
package coordinator

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/guneettoppo/stateshift/internal/blob"
	"github.com/guneettoppo/stateshift/internal/model"
	"github.com/guneettoppo/stateshift/internal/store"
	"github.com/guneettoppo/stateshift/internal/webui"
	"github.com/guneettoppo/stateshift/internal/workload"
)

// Coordinator drives migrations.
type Coordinator struct {
	store store.Store
	blob  blob.Blob
	reg   *workload.Registry
	httpc *http.Client

	mu       sync.Mutex
	nodes    map[string]*model.NodeInfo
	phases   map[string]string
	subs     map[chan []byte]struct{}
	labels   map[string]string // db / blob / llm, for the dashboard footer
	started  time.Time
}

func New(st store.Store, b blob.Blob, reg *workload.Registry, labels map[string]string) *Coordinator {
	return &Coordinator{
		store:   st,
		blob:    b,
		reg:     reg,
		httpc:   &http.Client{Timeout: 60 * time.Second},
		nodes:   map[string]*model.NodeInfo{},
		phases:  map[string]string{},
		subs:    map[chan []byte]struct{}{},
		labels:  labels,
		started: time.Now(),
	}
}

// Handler exposes the public API plus the embedded dashboard.
func (c *Coordinator) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", c.handleIndex)
	mux.HandleFunc("GET /api/health", c.handleHealth)
	mux.HandleFunc("GET /api/state", c.handleState)
	mux.HandleFunc("GET /api/events", c.handleEvents)
	mux.HandleFunc("POST /api/jobs", c.handleCreateJob)
	mux.HandleFunc("POST /api/migrate", c.handleMigrate)
	mux.HandleFunc("POST /api/nodes/register", c.handleRegister)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (c *Coordinator) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	page, err := webui.Files.ReadFile("index.html")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(page)
}

func (c *Coordinator) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "uptime_s": int(time.Since(c.started).Seconds())})
}

type registerReq struct {
	ID   string `json:"id"`
	Addr string `json:"addr"`
}

func (c *Coordinator) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		writeJSON(w, 400, map[string]string{"error": "id and addr required"})
		return
	}
	c.mu.Lock()
	n, ok := c.nodes[req.ID]
	if !ok {
		n = &model.NodeInfo{ID: req.ID}
		c.nodes[req.ID] = n
	}
	n.Addr = req.Addr
	n.LastSeen = time.Now().UTC()
	c.mu.Unlock()
	writeJSON(w, 200, map[string]any{"ok": true, "nodes": c.nodeCount()})
}

func (c *Coordinator) nodeCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.nodes)
}

func (c *Coordinator) setPhase(jobID, phase string) {
	c.mu.Lock()
	if phase == "" {
		delete(c.phases, jobID)
	} else {
		c.phases[jobID] = phase
	}
	c.mu.Unlock()
}

// ---------------------------------------------------------------------------
// snapshot + SSE
// ---------------------------------------------------------------------------

type jobView struct {
	ID         string    `json:"id"`
	Workload   string    `json:"workload"`
	Epoch      int       `json:"epoch"`
	Seq        int       `json:"seq"`
	TotalSteps int       `json:"total_steps"`
	Status     string    `json:"status"`
	Owner      string    `json:"owner"`
	PauseMs    int       `json:"pause_ms"`
	BytesTotal int64     `json:"bytes_total"`
	Ops        int       `json:"ops"`
	Checksum   string    `json:"checksum"`
	Phase      string    `json:"phase,omitempty"`
	Progress   float64   `json:"progress"`
	StateHash  string    `json:"state_hash"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type snapshot struct {
	Nodes      []*model.NodeInfo  `json:"nodes"`
	Jobs       []jobView          `json:"jobs"`
	Migrations []*model.Migration `json:"migrations"`
	Totals     struct {
		Jobs       int   `json:"jobs"`
		Ops        int   `json:"ops"`
		Bytes      int64 `json:"bytes"`
		LastPause  int   `json:"last_pause_ms"`
		Migrations int   `json:"migrations"`
		ChunksSent int   `json:"chunks_sent"`
		Skipped    int   `json:"chunks_skipped"`
	} `json:"totals"`
	Labels map[string]string `json:"labels"`
	Uptime int               `json:"uptime_s"`
	Now    time.Time         `json:"now"`
}

func (c *Coordinator) buildSnapshot(ctx context.Context) (*snapshot, error) {
	jobs, err := c.store.ListJobs(ctx)
	if err != nil {
		return nil, err
	}
	migs, err := c.store.ListMigrations(ctx, 12)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	nodes := make([]*model.NodeInfo, 0, len(c.nodes))
	for _, n := range c.nodes {
		if time.Since(n.LastSeen) > 20*time.Second {
			continue
		}
		cp := *n
		c.mu.Unlock()
		cp.Jobs = countOwned(jobs, cp.ID)
		c.mu.Lock()
		if live, ok := c.nodes[cp.ID]; ok {
			live.Jobs = cp.Jobs
		}
		nodes = append(nodes, &cp)
	}
	phases := make(map[string]string, len(c.phases))
	for k, v := range c.phases {
		phases[k] = v
	}
	c.mu.Unlock()

	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })

	snap := &snapshot{Nodes: nodes, Migrations: migs, Labels: c.labels, Uptime: int(time.Since(c.started).Seconds()), Now: time.Now().UTC()}
	for _, j := range jobs {
		v := jobView{
			ID: j.ID, Workload: j.Workload, Epoch: j.Epoch, Seq: j.Seq, TotalSteps: j.TotalSteps,
			Status: j.Status, Owner: j.Owner, PauseMs: j.PauseMs, BytesTotal: j.BytesTotal,
			Ops: j.Ops, Checksum: j.Checksum, Phase: phases[j.ID], StateHash: shortHash(j.StateHash),
			UpdatedAt: j.UpdatedAt,
		}
		if j.TotalSteps > 0 {
			v.Progress = float64(j.Seq) / float64(j.TotalSteps)
		}
		snap.Jobs = append(snap.Jobs, v)
		snap.Totals.Jobs++
		snap.Totals.Ops += j.Ops
		snap.Totals.Bytes += j.BytesTotal
	}
	for i, m := range migs {
		if i == 0 {
			snap.Totals.LastPause = m.PauseMs
		}
		snap.Totals.Migrations++
		snap.Totals.ChunksSent += m.ChunksSent
		snap.Totals.Skipped += m.Skipped
	}
	return snap, nil
}

func shortHash(h string) string {
	if len(h) > 8 {
		return h[:8]
	}
	return h
}

func countOwned(jobs []*model.Job, node string) int {
	n := 0
	for _, j := range jobs {
		if j.Owner == node && (j.Status == model.StatusRunning || j.Status == model.StatusRestoring || j.Status == model.StatusDraining) {
			n++
		}
	}
	return n
}

func (c *Coordinator) handleState(w http.ResponseWriter, r *http.Request) {
	snap, err := c.buildSnapshot(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, snap)
}

func (c *Coordinator) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan []byte, 4)
	c.mu.Lock()
	c.subs[ch] = struct{}{}
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.subs, ch)
		c.mu.Unlock()
	}()

	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			if _, err := fmt.Fprintf(w, "data: %s\n\n", msg); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// Broadcast feeds every SSE subscriber. Started once from main.
func (c *Coordinator) Broadcast(ctx context.Context) {
	tick := time.NewTicker(700 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			snap, err := c.buildSnapshot(ctx)
			if err != nil {
				continue
			}
			msg, err := json.Marshal(snap)
			if err != nil {
				continue
			}
			c.mu.Lock()
			for ch := range c.subs {
				select {
				case ch <- msg:
				default: // slow client: drop a frame rather than block the fleet
				}
			}
			c.mu.Unlock()
		}
	}
}

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------

type CreateJobRequest struct {
	Workload string `json:"workload"`
	Steps    int    `json:"steps"`
	Prompt   string `json:"prompt"`
	Node     string `json:"node"`
}

func (c *Coordinator) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var req CreateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	job, err := c.CreateJob(r.Context(), req)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, job)
}

// CreateJob builds the initial state, assigns an owner and starts execution.
func (c *Coordinator) CreateJob(ctx context.Context, req CreateJobRequest) (*model.Job, error) {
	wl, ok := c.reg.Get(req.Workload)
	if !ok {
		return nil, fmt.Errorf("unknown workload %q (have %v)", req.Workload, c.reg.Names())
	}
	params := map[string]any{"steps": req.Steps}
	if req.Prompt != "" {
		params["prompt"] = req.Prompt
	}
	state, total, err := wl.Init(params)
	if err != nil {
		return nil, err
	}

	owner := c.pickNode(req.Node, nil)
	if owner == nil {
		return nil, errors.New("no worker node registered yet")
	}

	sum := sha256.Sum256(state)
	now := time.Now().UTC()
	job := &model.Job{
		ID:         newID(),
		Workload:   req.Workload,
		Epoch:      0,
		Seq:        0,
		TotalSteps: total,
		Status:     model.StatusRunning,
		Owner:      owner.ID,
		State:      state,
		StateHash:  hex.EncodeToString(sum[:]),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := c.store.CreateJob(ctx, job); err != nil {
		return nil, err
	}
	if err := c.postJSON(ctx, owner.Addr+"/internal/start", map[string]any{"job_id": job.ID, "epoch": 0}, nil); err != nil {
		_ = c.store.MarkFailed(ctx, job.ID, "start failed: "+err.Error())
		return nil, err
	}
	log.Printf("job %s (%s, %d steps) started on %s", job.ID, job.Workload, total, owner.ID)
	return job, nil
}

func newID() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return "job-" + hex.EncodeToString(b[:])
}

// pickNode chooses the least loaded healthy worker.
func (c *Coordinator) pickNode(preferred string, exclude map[string]bool) *model.NodeInfo {
	c.mu.Lock()
	defer c.mu.Unlock()
	var best *model.NodeInfo
	bestLoad := 1 << 30
	for _, n := range c.nodes {
		if exclude[n.ID] || (preferred != "" && n.ID != preferred) {
			continue
		}
		if time.Since(n.LastSeen) > 20*time.Second {
			continue
		}
		if n.Jobs < bestLoad {
			cp := *n
			best = &cp
			bestLoad = n.Jobs
		}
	}
	return best
}

// ---------------------------------------------------------------------------
// migration
// ---------------------------------------------------------------------------

type migrateReq struct {
	JobID  string `json:"job_id"`
	Target string `json:"target"`
}

func (c *Coordinator) handleMigrate(w http.ResponseWriter, r *http.Request) {
	var req migrateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	mig, err := c.Migrate(r.Context(), req.JobID, req.Target)
	if err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error(), "migration": fmt.Sprint(mig)})
		return
	}
	writeJSON(w, 200, mig)
}

type quiesceResp struct {
	Seq         int       `json:"seq"`
	ManifestKey string    `json:"manifest_key"`
	StateHash   string    `json:"state_hash"`
	Size        int       `json:"size"`
	Chunks      int       `json:"chunks"`
	Uploaded    int       `json:"chunks_uploaded"`
	Skipped     int       `json:"chunks_skipped"`
	Bytes       int64     `json:"bytes"`
	QuiescedAt  time.Time `json:"quiesced_at"`
	Err         string    `json:"error"`
}

type restoreResp struct {
	Bytes         int64     `json:"bytes"`
	ChunksFetched int       `json:"chunks_fetched"`
	ResumedAt     time.Time `json:"resumed_at"`
	Seq           int       `json:"seq"`
}

// Migrate runs the full handover:
//
//	quiesce source -> checkpoint -> fence (epoch++) -> restore target -> resume
//
// Every failure path ends with exactly one authoritative owner.
func (c *Coordinator) Migrate(ctx context.Context, jobID, target string) (*model.Migration, error) {
	job, err := c.store.GetJob(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if job.Status != model.StatusRunning {
		return nil, fmt.Errorf("job is %s, not running", job.Status)
	}
	if target == "" {
		return nil, errors.New("target required")
	}
	if target == job.Owner {
		return nil, errors.New("target is already the owner")
	}
	targetNode := c.pickNode(target, nil)
	if targetNode == nil {
		return nil, fmt.Errorf("node %q is not registered", target)
	}
	sourceNode := c.pickNode(job.Owner, nil)
	if sourceNode == nil {
		return nil, fmt.Errorf("source node %q is not registered", job.Owner)
	}

	mig := &model.Migration{
		JobID:     jobID,
		From:      job.Owner,
		To:        target,
		StartedAt: time.Now().UTC(),
		EpochFrom: job.Epoch,
	}

	// 1. Freeze scheduling on the source.
	ok, err := c.store.SetStatusCAS(ctx, jobID, model.StatusRunning, model.StatusDraining)
	if err != nil || !ok {
		mig.Outcome = "aborted-status-race"
		_, _ = c.store.PutMigration(ctx, mig)
		return mig, fmt.Errorf("could not mark job draining: %v", err)
	}
	c.setPhase(jobID, "quiescing")
	defer c.setPhase(jobID, "")

	// 2. Source checkpoints and stops at a step boundary.
	var q quiesceResp
	if err := c.postJSON(ctx, sourceNode.Addr+"/internal/quiesce",
		map[string]any{"job_id": jobID, "epoch": job.Epoch}, &q); err != nil || q.Err != "" {
		_, _ = c.store.SetStatusCAS(ctx, jobID, model.StatusDraining, model.StatusRunning)
		_ = c.postJSON(ctx, sourceNode.Addr+"/internal/start",
			map[string]any{"job_id": jobID, "epoch": job.Epoch}, nil)
		mig.Outcome = "aborted-quiesce-failed"
		_, _ = c.store.PutMigration(ctx, mig)
		if err == nil {
			err = errors.New(q.Err)
		}
		return mig, fmt.Errorf("quiesce failed, source resumed: %w", err)
	}
	mig.QuiescedAt = q.QuiescedAt
	mig.BytesSent = q.Bytes
	mig.ChunksSent = q.Uploaded
	mig.Skipped = q.Skipped

	// 3. Fence: increment the epoch and hand ownership to the target. Exactly one
	// caller can win this; a stale source now fails every CommitStep.
	c.setPhase(jobID, "fencing")
	newEpoch, won, err := c.store.TransferEpoch(ctx, jobID, job.Epoch, target, model.StatusRestoring)
	if err != nil || !won {
		_, _ = c.store.SetStatusCAS(ctx, jobID, model.StatusDraining, model.StatusRunning)
		_ = c.postJSON(ctx, sourceNode.Addr+"/internal/start",
			map[string]any{"job_id": jobID, "epoch": job.Epoch}, nil)
		mig.Outcome = "aborted-fence-lost"
		_, _ = c.store.PutMigration(ctx, mig)
		return mig, fmt.Errorf("fence lost: %v", err)
	}
	mig.EpochTo = newEpoch

	// 4. Target restores and resumes.
	c.setPhase(jobID, "restoring")
	var rr restoreResp
	if err := c.postJSON(ctx, targetNode.Addr+"/internal/restore", map[string]any{
		"job_id": jobID, "seq": q.Seq, "epoch": newEpoch, "manifest_key": q.ManifestKey,
	}, &rr); err != nil {
		// Recovery: hand authority back to the source and restart it from the
		// committed state. The target never became authoritative.
		backEpoch, _, ferr := c.store.TransferEpoch(ctx, jobID, newEpoch, sourceNode.ID, model.StatusRunning)
		if ferr == nil {
			_ = c.postJSON(ctx, sourceNode.Addr+"/internal/start",
				map[string]any{"job_id": jobID, "epoch": backEpoch}, nil)
		}
		mig.Outcome = "failed-failover-back"
		mig.RestoredAt = time.Now().UTC()
		_, _ = c.store.PutMigration(ctx, mig)
		return mig, fmt.Errorf("restore failed, authority returned to %s: %w", sourceNode.ID, err)
	}
	mig.RestoredAt = time.Now().UTC()
	if mig.RestoredAt.Before(mig.QuiescedAt) {
		mig.RestoredAt = mig.QuiescedAt
	}
	mig.PauseMs = int(mig.RestoredAt.Sub(mig.QuiescedAt).Milliseconds())
	mig.BytesSent += rr.Bytes
	mig.ChunksSent += rr.ChunksFetched
	mig.Outcome = "ok"

	if id, err := c.store.PutMigration(ctx, mig); err != nil {
		log.Printf("migrate %s: record: %v", jobID, err)
	} else {
		mig.ID = id
	}
	if err := c.store.MarkPause(ctx, jobID, mig.PauseMs); err != nil {
		log.Printf("migrate %s: mark pause: %v", jobID, err)
	}
	log.Printf("migrated %s %s -> %s epoch %d->%d seq %d pause %dms bytes %d",
		jobID, mig.From, mig.To, mig.EpochFrom, mig.EpochTo, q.Seq, mig.PauseMs, mig.BytesSent)
	return mig, nil
}

func (c *Coordinator) postJSON(ctx context.Context, url string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s: %s", resp.Status, buf.String())
	}
	if out != nil {
		if err := json.Unmarshal(buf.Bytes(), out); err != nil {
			return err
		}
	}
	return nil
}

// SeedNodes lets tests and role=all declare workers without waiting for the
// registration heartbeat.
func (c *Coordinator) SeedNodes(nodes ...*model.NodeInfo) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, n := range nodes {
		cp := *n
		c.nodes[n.ID] = &cp
	}
}
