"use client";

import type { Migration } from "@/lib/types";
import { fmtBytes, fmtClock, fmtNum, nodeHue } from "@/lib/format";
import { OutcomePill } from "./status";

export function Migrations({ migrations }: { migrations: Migration[] | undefined }) {
  const list = migrations ?? [];
  if (!list.length) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-mute">
          No migrations recorded yet — the epoch fence has never been exercised.
        </p>
      </div>
    );
  }
  return (
    <div className="card divide-y divide-line">
      {list.map((m) => {
        return (
          <div key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-[180px] flex-1 items-center gap-2">
              <span className="font-mono text-[12px] font-medium text-ink">
                {m.job_id}
              </span>
              <div className="flex items-center gap-1.5">
                <NodeChip id={m.from} />
                <span className="text-[11px] text-mute">→</span>
                <NodeChip id={m.to} />
              </div>
            </div>

            <div className="hidden text-center font-mono text-[11px] text-mute md:block">
              <span className="num">{m.epoch_from}</span>{" "}
              <span className="text-mute/60">→</span>{" "}
              <span className="num text-ink">{m.epoch_to}</span>
            </div>

            <div className="flex items-center gap-4 text-[12px] sm:w-[280px] sm:justify-end">
              <Metric label="Pause" value={`${fmtNum(m.pause_ms)} ms`} />
              <Metric label="Bytes" value={fmtBytes(m.bytes_transferred)} />
              <Metric
                label="Chunks"
                value={`${fmtNum(m.chunks_sent)}·${fmtNum(m.chunks_skipped)}`}
              />
            </div>

            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span className="font-mono text-[10.5px] text-mute">
                {fmtClock(m.restored_at || m.started_at)}
              </span>
              <OutcomePill outcome={m.outcome} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NodeChip({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: nodeHue(id) }} />
      {id}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-mute">
        {label}
      </div>
      <div className="num font-mono text-[12px] font-medium text-ink">{value}</div>
    </div>
  );
}
