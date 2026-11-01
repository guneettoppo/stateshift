"use client";

import type { Migration } from "@/lib/types";
import { fmtNum } from "@/lib/format";

const HINT: Record<string, string> = {
  ok: "committed",
  "aborted-status-race": "status race",
  "aborted-quiesce-failed": "quiesce failed",
  "aborted-fence-lost": "fence lost",
  "failed-failover-back": "restore failed",
};

function outcomeTone(outcome: string): { dot: string; text: string } {
  if (outcome === "ok") return { dot: "ok", text: "committed" };
  const failing = outcome.startsWith("failed") || outcome.startsWith("aborted");
  return { dot: failing ? "bad" : "", text: HINT[outcome] ?? outcome };
}

/** The audit trail: every epoch, who moved where, what it cost. */
export function HandoverLog({ migrations }: { migrations: Migration[] }) {
  const rows = [...(migrations ?? [])].reverse();

  return (
    <div className="panel" id="migrations">
      <div className="p-head">
        <span className="lbl">Handovers</span>
        <span className="right">
          <span className="mono">{migrations?.length ?? 0}</span> recorded
        </span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Epoch</th>
              <th>Job</th>
              <th>Route</th>
              <th className="r">Pause</th>
              <th className="r">Moved</th>
              <th className="r">Chunks</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={7} className="empty" style={{ height: "auto" }}>
                  No handovers yet. Migrate a running job to record one.
                </td>
              </tr>
            )}
            {rows.map((m) => {
              const tone = outcomeTone(m.outcome);
              return (
                <tr key={m.id} style={{ cursor: "default" }}>
                  <td className="mono">
                    {m.epoch_from}
                    <span style={{ color: "var(--faint)" }}>→</span>
                    {m.epoch_to}
                  </td>
                  <td className="jid">{m.job_id.replace(/^job-/, "").slice(0, 10)}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {m.from}
                    <span style={{ color: "var(--faint)" }}> → </span>
                    {m.to}
                  </td>
                  <td className="r mono">{m.pause_ms ? `${fmtNum(m.pause_ms)} ms` : "—"}</td>
                  <td className="r mono">{fmtNum(m.bytes_transferred)} B</td>
                  <td className="r mono">
                    {m.chunks_sent}
                    <span style={{ color: "var(--faint)" }}> / {m.chunks_sent + m.chunks_skipped}</span>
                  </td>
                  <td>
                    <span className={`status ${m.outcome === "ok" ? "done" : tone.dot === "bad" ? "failed" : ""}`}>
                      <span className={`dot ${tone.dot}`} />
                      {tone.text}
                    </span>
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
