"use client";

import type { JobView, NodeInfo } from "@/lib/types";
import { nodeHue, fmtNum, fmtPct, shortId } from "@/lib/format";
import { StatusPill } from "./status";
import { ArrowSwap } from "@/lib/icons";

export function JobsTable({
  jobs,
  nodes,
  migrating,
  onSelect,
  onMigrate,
}: {
  jobs: JobView[] | undefined;
  nodes: NodeInfo[];
  migrating: string | null;
  onSelect: (job: JobView) => void;
  onMigrate: (jobId: string, target: string) => void;
}) {
  const list = [...(jobs ?? [])].reverse();

  return (
    <div className="card overflow-hidden">
      <div className="scroll-slim overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              {[
                "Job",
                "Owner",
                "Status",
                "Epoch",
                "Progress",
                "Ops",
                "Pause",
                "Checksum",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-mute"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.length && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-mute">
                  No jobs yet — create one to start a migratable workload.
                </td>
              </tr>
            )}
            {list.map((j) => {
              const hue = nodeHue(j.owner);
              const canMigrate = j.status === "running" && nodes.length > 1;
              return (
                <tr
                  key={j.id}
                  onClick={() => onSelect(j)}
                  className="group cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-black/[0.015] dark:hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-3">
                    <div className="font-mono text-[12.5px] font-medium text-ink">
                      {shortId(j.id)}
                    </div>
                    <div className="mt-0.5 inline-flex rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                      {j.workload}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: hue }}
                      />
                      <span className="font-mono text-[12px] text-ink">{j.owner}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={j.status} phase={j.phase} />
                  </td>
                  <td className="num px-4 py-3 font-mono text-[12px] text-ink">
                    {j.epoch}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="num w-[72px] font-mono text-[11.5px] text-mute">
                        {fmtNum(j.seq)} / {fmtNum(j.total_steps)}
                      </span>
                      <div className="bar w-24 flex-none">
                        <i style={{ width: fmtPct(j.progress) }} />
                      </div>
                    </div>
                  </td>
                  <td className="num px-4 py-3 font-mono text-[12px] text-ink">
                    {fmtNum(j.ops)}
                  </td>
                  <td className="num px-4 py-3 font-mono text-[11.5px] text-mute">
                    {j.pause_ms ? `${fmtNum(j.pause_ms)} ms` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-mute">
                    {shortId(j.checksum || j.state_hash, 10) || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canMigrate ? (
                      <MigrateMenu
                        job={j}
                        nodes={nodes}
                        migrating={migrating === j.id}
                        onMigrate={onMigrate}
                      />
                    ) : (
                      <span className="inline-block w-16" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MigrateMenu({
  job,
  nodes,
  migrating,
  onMigrate,
}: {
  job: JobView;
  nodes: NodeInfo[];
  migrating: boolean;
  onMigrate: (jobId: string, target: string) => void;
}) {
  const targets = nodes.filter((n) => n.id !== job.owner);

  /* Menu is intentionally lightweight: clicking a target migrates immediately. */
  return (
    <div className="flex items-center justify-end gap-1">
      {targets.slice(0, 2).map((n) => (
        <button
          key={n.id}
          disabled={migrating}
          onClick={(e) => {
            e.stopPropagation();
            onMigrate(job.id, n.id);
          }}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.05em] text-mute transition hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <ArrowSwap className="h-3 w-3" />
          {n.id}
        </button>
      ))}
      {targets.length > 2 && (
        <span className="text-[10px] text-mute">+{targets.length - 2}</span>
      )}
    </div>
  );
}
