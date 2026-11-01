"use client";

import type { JobView, Migration, NodeInfo } from "@/lib/types";
import { fmtBytes, fmtNum, shortId } from "@/lib/format";
import { GlyphArrow, GlyphX } from "@/lib/glyphs";

function msBetween(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const x = new Date(a).getTime();
  const y = new Date(b).getTime();
  if (Number.isNaN(x) || Number.isNaN(y) || y < x) return null;
  if (y - x > 1000 * 60 * 60) return null;
  return y - x;
}

/**
 * Right-hand inspector. Everything here is a key/value row or a small
 * measurement of the handover — no cards, no badges.
 */
export function InspectPanel({
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
  const own = migrations.filter((m) => m.job_id === job.id);
  const last = own.length ? own[own.length - 1] : null;

  const quiesceMs = last ? msBetween(last.started_at, last.quiesced_at) : null;
  const restoreMs = last ? msBetween(last.quiesced_at, last.restored_at) : null;
  const pauseMs = last ? last.pause_ms || (quiesceMs ?? 0) + (restoreMs ?? 0) : job.pause_ms;

  const sent = last?.chunks_sent ?? 0;
  const skipped = last?.chunks_skipped ?? 0;
  const chunks = sent + skipped;

  const targets = nodes.filter((n) => n.id !== job.owner);
  const canMigrate = job.status === "running" && targets.length > 0;
  const busy = migrating === job.id;

  return (
    <aside className="drawer" data-open="true" aria-label={`Job ${job.id}`}>
      <div className="dr-head">
        <span className={`dot ${job.status === "failed" ? "bad" : job.status === "done" ? "ok" : "run"}`} />
        <span className="jt">{shortId(job.id.replace(/^job-/, ""), 12)}</span>
        <span className="tagwork" style={{ marginLeft: 0 }}>
          {job.workload}
        </span>
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {job.status}
        </span>
        <button className="x" onClick={onClose} aria-label="Close">
          <GlyphX />
        </button>
      </div>

      <div className="dr-body">
        <div className="kv">
          <span className="k">Owner</span>
          <span className="v">
            <span className={`dot ${job.status === "failed" ? "bad" : "ok"}`} style={{ marginRight: 5 }} />
            {job.owner}
          </span>
        </div>
        <div className="kv">
          <span className="k">Epoch</span>
          <span className="v">{job.epoch}</span>
        </div>
        <div className="kv">
          <span className="k">Steps</span>
          <span className="v">
            {fmtNum(job.seq)} / {fmtNum(job.total_steps)}
          </span>
        </div>
        <div className="kv">
          <span className="k">Ops</span>
          <span className="v">
            {fmtNum(job.ops)} · {Math.max(0, job.ops - job.seq)} repeated
          </span>
        </div>
        <div className="kv">
          <span className="k">Checksum</span>
          <span className="v">{job.checksum ? shortId(job.checksum, 16) : "—"}</span>
        </div>
        <div className="kv">
          <span className="k">Updated</span>
          <span className="v">{new Date(job.updated_at).toLocaleTimeString()}</span>
        </div>

        {last ? (
          <>
            <div className="dr-sec">
              <div className="h">Handover</div>
              <div className="ribbon">
                <span className="segA" style={{ flex: 1 }} />
                <span className="gap" style={{ padding: "0 6px" }}>
                  {pauseMs ? (pauseMs >= 1000 ? `${(pauseMs / 1000).toFixed(1)}s` : `${pauseMs}ms`) : "—"}
                </span>
                <span className="segB" style={{ flex: 1 }} />
              </div>
              <div className="ribbon-lbl">
                <span>
                  {last.from} · epoch {last.epoch_from}
                </span>
                <span>
                  {last.to} · epoch {last.epoch_to}
                </span>
              </div>
            </div>

            <div className="dr-sec">
              <div className="h">Where the pause went</div>
              <div className="wf">
                <div className="wf-row">
                  <span className="n">quiesce</span>
                  <span className="wf-track">
                    <span
                      className="wf-fill"
                      style={{ width: `${scale(quiesceMs, Math.max(quiesceMs ?? 0, pauseMs))}%` }}
                    />
                  </span>
                  <span className="t">{quiesceMs != null ? `${quiesceMs} ms` : "—"}</span>
                </div>
                <div className="wf-row acc">
                  <span className="n">restore</span>
                  <span className="wf-track">
                    <span
                      className="wf-fill"
                      style={{ width: `${scale(pauseMs, Math.max(quiesceMs ?? 0, pauseMs))}%` }}
                    />
                  </span>
                  <span className="t">{fmtNum(pauseMs)} ms</span>
                </div>
              </div>
              <div
                className="mono"
                style={{ fontSize: 10, color: "var(--faint)", marginTop: 6 }}
              >
                pause is measured from the fence to the first step on {last.to}
              </div>
            </div>

            {chunks > 0 && (
              <div className="dr-sec">
                <div className="h">
                  Chunks · {chunks} · {fmtBytes(last.bytes_transferred)}
                </div>
                <div className="chunks">
                  {Array.from({ length: Math.min(chunks, 48) }).map((_, i) => (
                    <i key={i} className={i < sent ? "s" : ""} />
                  ))}
                </div>
                <div className="legend">
                  <span>
                    <i style={{ background: "var(--ink)", opacity: 0.82 }} />
                    sent · {sent}
                  </span>
                  <span>
                    <i style={{ background: "var(--panel)", border: "1px solid var(--line2)" }} />
                    reused · {skipped}
                  </span>
                  <span className="mono" style={{ marginLeft: "auto" }}>
                    {chunks ? Math.round((skipped / chunks) * 100) : 0}% reused
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="dr-sec">
            <div className="h">Handover</div>
            <div className="empty" style={{ padding: "12px 0", textAlign: "left" }}>
              This job has not been migrated yet. Its state has never left{" "}
              <span className="mono">{job.owner}</span>.
            </div>
          </div>
        )}

        <div className="dr-sec" style={{ display: "flex", gap: 8, marginTop: 22 }}>
          {targets.length ? (
            targets.slice(0, 1).map((n) => (
              <button
                key={n.id}
                className="btn primary"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!canMigrate || busy}
                onClick={() => onMigrate(job.id, n.id)}
                title={
                  canMigrate
                    ? `Migrate to ${n.id}`
                    : `Only running jobs can move (status: ${job.status})`
                }
              >
                {busy ? "Migrating…" : `Migrate to ${n.id}`}
                <GlyphArrow width={12} height={12} />
              </button>
            ))
          ) : (
            <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
              need a second worker to migrate
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function scale(part: number | null, total: number): number {
  if (part == null || !total) return 0;
  return Math.max(2, Math.min(100, (part / total) * 100));
}
