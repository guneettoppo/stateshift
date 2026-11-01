"use client";

import type { JobView, NodeInfo } from "@/lib/types";
import { fmtNum, fmtPct, shortId } from "@/lib/format";
import { GlyphSwap } from "@/lib/glyphs";

const STATUS: Record<string, { dot: string; label: string; cls?: string }> = {
  running: { dot: "run", label: "running" },
  draining: { dot: "run", label: "draining", cls: "draining" },
  restoring: { dot: "run", label: "restoring", cls: "restoring" },
  drained: { dot: "", label: "drained" },
  done: { dot: "ok", label: "done", cls: "done" },
  failed: { dot: "bad", label: "failed", cls: "failed" },
};

function StatusMark({ status }: { status: string }) {
  const s = STATUS[status] ?? { dot: "", label: status };
  return (
    <span className={`status ${s.cls ?? ""}`}>
      <span className={`dot ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function LedgerTable({
  jobs,
  nodes,
  migrating,
  selectedId,
  onSelect,
  onMigrate,
}: {
  jobs: JobView[];
  nodes: NodeInfo[];
  migrating: string | null;
  selectedId: string | null;
  onSelect: (job: JobView) => void;
  onMigrate: (jobId: string, target: string) => void;
}) {
  const list = [...jobs].reverse();

  return (
    <div className="panel" id="jobs">
      <div className="p-head">
        <span className="lbl">Jobs</span>
        <span className="right">
          <span className="mono">{jobs.length}</span> total ·{" "}
          <span className="mono">{jobs.filter((j) => j.status === "running").length}</span> running
        </span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Job</th>
              <th>Owner</th>
              <th>Epoch</th>
              <th>Progress</th>
              <th className="r">Ops</th>
              <th className="r">Pause</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!list.length && (
              <tr>
                <td colSpan={8} className="empty" style={{ height: "auto" }}>
                  No jobs yet — start one to get a migratable workload.
                </td>
              </tr>
            )}
            {list.map((j) => {
              const canMigrate = j.status === "running" && nodes.length > 1;
              const targets = nodes.filter((n) => n.id !== j.owner).slice(0, 2);
              return (
                <tr
                  key={j.id}
                  onClick={() => onSelect(j)}
                  aria-selected={selectedId === j.id}
                >
                  <td>
                    <span className="jid">{shortId(j.id.replace(/^job-/, ""), 12)}</span>
                    <span className="tagwork">{j.workload}</span>
                  </td>
                  <td>
                    <span className="owner">
                      <span className={`dot ${j.status === "failed" ? "bad" : "ok"}`} />
                      {j.owner}
                    </span>
                  </td>
                  <td className="mono">{j.epoch}</td>
                  <td>
                    <span className={`bar ${j.status === "done" ? "done" : ""}`}>
                      <i style={{ width: fmtPct(j.progress) }} />
                    </span>{" "}
                    <span className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
                      {fmtNum(j.seq)}/{fmtNum(j.total_steps)}
                    </span>
                  </td>
                  <td className="r mono">{fmtNum(j.ops)}</td>
                  <td className="r mono">{j.pause_ms ? `${fmtNum(j.pause_ms)} ms` : "—"}</td>
                  <td>
                    <StatusMark status={j.status} />
                  </td>
                  <td className="r">
                    {canMigrate ? (
                      <span className="rowact" style={{ display: "inline-flex", gap: 4 }}>
                        {targets.map((n) => (
                          <button
                            key={n.id}
                            className="mini"
                            disabled={migrating === j.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onMigrate(j.id, n.id);
                            }}
                            title={`Migrate to ${n.id}`}
                          >
                            <GlyphSwap width={10} height={10} />
                            {migrating === j.id ? "…" : n.id}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="tbl-foot">
        <span>
          {list.length} shown
          {migrating ? " · migration in flight" : ""}
        </span>
        <span className="mono" style={{ marginLeft: "auto" }}>
          click a row to inspect
        </span>
      </div>
    </div>
  );
}
