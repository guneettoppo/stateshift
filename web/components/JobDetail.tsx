"use client";

import { useEffect } from "react";
import type { JobView, Migration, NodeInfo } from "@/lib/types";
import { fmtBytes, fmtClock, fmtNum, fmtPct, nodeHue } from "@/lib/format";
import { StatusPill } from "./status";
import { ArrowSwap, X } from "@/lib/icons";

export function JobDetail({
  job,
  nodes,
  migrations,
  migrating,
  onClose,
  onMigrate,
}: {
  job: JobView;
  nodes: NodeInfo[];
  migrations: Migration[];
  migrating: string | null;
  onClose: () => void;
  onMigrate: (jobId: string, target: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const owned = migrations
    .filter((m) => m.job_id === job.id)
    .sort((a: any, b: any) => (b as any).id - (a as any).id);
  const hue = nodeHue(job.owner);
  const targets = nodes.filter((n) => n.id !== job.owner);
  const canMigrate = job.status === "running" && targets.length > 0;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4">
      <div
        className="fade-in absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="sheet-in relative w-full max-w-lg overflow-hidden rounded-[22px] bg-card shadow-2xl">
        <div className="flex items-start justify-between px-6 pt-5">
          <div>
            <div className="font-mono text-[15px] font-semibold text-ink">
              {job.id}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-accent">
                {job.workload}
              </span>
              <StatusPill status={job.status} phase={job.phase} />
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-mute transition hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pt-5">
          <div className="flex items-end justify-between">
            <span className="num text-[26px] font-semibold tracking-tight text-ink">
              {fmtNum(job.seq)}
              <span className="text-[16px] font-normal text-mute">
                {" "}
                / {fmtNum(job.total_steps)}
              </span>
            </span>
            <span className="num text-[13px] font-medium text-mute">
              {fmtPct(job.progress)}
            </span>
          </div>
          <div className="mt-2 bar h-2">
            <i style={{ width: fmtPct(job.progress) }} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 px-6 sm:grid-cols-3">
          <Cell label="Owner" value={<NodeChip id={job.owner} />} />
          <Cell
            label="Epoch"
            value={<span className="num font-mono text-ink">{job.epoch}</span>}
          />
          <Cell label="Ops" value={<span className="num font-mono text-ink">{fmtNum(job.ops)}</span>} />
          <Cell
            label="Pause"
            value={<span className="num font-mono text-ink">{job.pause_ms ? `${fmtNum(job.pause_ms)} ms` : "—"}</span>}
          />
          <Cell
            label="State moved"
            value={<span className="num font-mono text-ink">{fmtBytes(job.bytes_total)}</span>}
          />
          <Cell
            label="Updated"
            value={<span className="font-mono text-[12px] text-ink">{fmtClock(job.updated_at)}</span>}
          />
          <div className="col-span-2 sm:col-span-3">
            <Cell
              label="Checksum"
              value={
                <span className="font-mono text-[11.5px] break-all text-mute">
                  {job.checksum || job.state_hash || "—"}
                </span>
              }
            />
          </div>
        </div>

        {canMigrate && (
          <div className="mx-6 mt-5 rounded-2xl border border-line p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
              Migrate to
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {targets.map((n) => (
                <button
                  key={n.id}
                  disabled={migrating === job.id}
                  onClick={() => onMigrate(job.id, n.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[12px] font-medium text-ink transition hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <ArrowSwap className="h-3.5 w-3.5 text-accent" />
                  {n.id}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] leading-snug text-mute">
              Quiesce → checkpoint → fence (epoch +1) → restore. One
              authoritative owner, always.
            </p>
          </div>
        )}

        {owned.length > 0 && (
          <div className="mt-5 border-t border-line px-6 py-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
              Migration history
            </div>
            <div className="space-y-1.5">
              {owned.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg bg-page px-3 py-2 dark:bg-white/[0.03]">
                  <NodeChip id={m.from} />
                  <span className="text-[11px] text-mute">→</span>
                  <NodeChip id={m.to} />
                  <span className="ml-auto font-mono text-[11px] text-mute">
                    {fmtNum(m.pause_ms)} ms · {fmtBytes(m.bytes_transferred)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="h-5" />
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">
        {label}
      </div>
      <div className="text-[13px]">{value}</div>
    </div>
  );
}

function NodeChip({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: nodeHue(id) }} />
      {id}
    </span>
  );
}
