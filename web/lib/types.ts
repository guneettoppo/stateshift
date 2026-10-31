export type ConnState = "connecting" | "live" | "offline";

export interface NodeInfo {
  id: string;
  addr: string;
  last_seen: string;
  jobs: number;
}

export type JobStatus =
  | "running"
  | "draining"
  | "restoring"
  | "drained"
  | "done"
  | "failed";

export interface JobView {
  id: string;
  workload: string;
  epoch: number;
  seq: number;
  total_steps: number;
  status: string;
  owner: string;
  pause_ms: number;
  bytes_total: number;
  ops: number;
  checksum: string;
  phase?: string;
  progress: number;
  state_hash: string;
  updated_at: string;
}

export interface Migration {
  id: number;
  job_id: string;
  from: string;
  to: string;
  started_at: string;
  quiesced_at: string;
  restored_at: string;
  /** 0 if still nil (string only on wire) */
  pause_ms: number;
  bytes_transferred: number;
  chunks_sent: number;
  chunks_skipped: number;
  outcome: string;
  epoch_from: number;
  epoch_to: number;
}

export interface Totals {
  jobs: number;
  ops: number;
  bytes: number;
  last_pause_ms: number;
  migrations: number;
  chunks_sent: number;
  chunks_skipped: number;
}

export interface Snapshot {
  nodes: NodeInfo[];
  jobs: JobView[];
  migrations: Migration[];
  totals: Totals;
  labels: Record<string, string>;
  uptime_s: number;
  now: string;
}

export interface CreateJobPayload {
  workload: string;
  steps: number;
  prompt?: string;
  node?: string;
}
