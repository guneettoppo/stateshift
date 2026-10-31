// Package model holds the wire and storage types shared by the coordinator,
// the worker nodes and the dashboard.
package model

import "time"

// Job lifecycle. Only one node may hold a job at a time; the store enforces it
// through the epoch CAS in Store.CommitStep.
const (
	StatusRunning   = "running"
	StatusDraining  = "draining"
	StatusRestoring = "restoring"
	StatusDrained   = "drained"
	StatusDone      = "done"
	StatusFailed    = "failed"
)

// Job is a migratable workload instance.
type Job struct {
	ID         string    `json:"id"`
	Workload   string    `json:"workload"`
	Epoch      int       `json:"epoch"`
	Seq        int       `json:"seq"`
	TotalSteps int       `json:"total_steps"`
	Status     string    `json:"status"`
	Owner      string    `json:"owner"`
	State      []byte    `json:"-"`
	StateHash  string    `json:"state_hash"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	PauseMs    int       `json:"pause_ms"`
	BytesTotal int64     `json:"bytes_total"`
	Ops        int       `json:"ops"`
	Checksum   string    `json:"checksum"`
}

// Op is one committed side effect of a job step. Op IDs are the unit of
// exactly-once semantics: replaying a step cannot re-apply them.
type Op struct {
	ID     string `json:"id"`
	Result string `json:"result"`
}

// Checkpoint is a durable, content-addressed snapshot of a job at a step
// boundary.
type Checkpoint struct {
	JobID       string    `json:"job_id"`
	Seq         int       `json:"seq"`
	Epoch       int       `json:"epoch"`
	ManifestKey string    `json:"manifest_key"`
	StateHash   string    `json:"state_hash"`
	Size        int       `json:"size"`
	Chunks      int       `json:"chunks"`
	Uploaded    int       `json:"chunks_uploaded"`
	Skipped     int       `json:"chunks_skipped"`
	CreatedAt   time.Time `json:"created_at"`
}

// Migration is one audited handover attempt, successful or not.
type Migration struct {
	ID         int64     `json:"id"`
	JobID      string    `json:"job_id"`
	From       string    `json:"from"`
	To         string    `json:"to"`
	StartedAt  time.Time `json:"started_at"`
	QuiescedAt time.Time `json:"quiesced_at"`
	RestoredAt time.Time `json:"restored_at"`
	PauseMs    int       `json:"pause_ms"`
	BytesSent  int64     `json:"bytes_transferred"`
	ChunksSent int       `json:"chunks_sent"`
	Skipped    int       `json:"chunks_skipped"`
	Outcome    string    `json:"outcome"`
	EpochFrom  int       `json:"epoch_from"`
	EpochTo    int       `json:"epoch_to"`
}

// NodeInfo is the coordinator's view of a registered worker.
type NodeInfo struct {
	ID       string    `json:"id"`
	Addr     string    `json:"addr"`
	LastSeen time.Time `json:"last_seen"`
	Jobs     int       `json:"jobs"`
}
