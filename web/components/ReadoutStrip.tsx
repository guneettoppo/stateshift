"use client";

import type { Totals } from "@/lib/types";
import { dedupeRate, fmtNum } from "@/lib/format";

/**
 * Replaces the six equal "stat cards" with one band: four numbers, no icons,
 * no decoration. The values are the point, so they are set in mono and large.
 */
export function ReadoutStrip({
  totals,
  running,
  workers,
}: {
  totals: Totals | undefined;
  running: number;
  workers: number;
}) {
  const t = totals;
  const totalChunks = (t?.chunks_sent ?? 0) + (t?.chunks_skipped ?? 0);

  return (
    <section className="panel" aria-label="Readouts">
      <div className="readouts">
        <div className="readout">
          <div className="lbl">Ops committed</div>
          <div className="v">{fmtNum(t?.ops)}</div>
          <div className="s">
            {running} running · {workers} worker{workers === 1 ? "" : "s"}
          </div>
        </div>
        <div className="readout">
          <div className="lbl">Last pause</div>
          <div className="v">
            {t?.last_pause_ms ? fmtNum(t.last_pause_ms) : "—"}
            {t?.last_pause_ms ? <span style={{ fontSize: 12, marginLeft: 4 }}>ms</span> : null}
          </div>
          <div className="s">
            {t?.last_pause_ms ? "measured downtime" : "no handover yet"}
          </div>
        </div>
        <div className="readout">
          <div className="lbl">Chunks reused</div>
          <div className="v">{dedupeRate(t ?? { chunks_sent: 0, chunks_skipped: 0 })}</div>
          <div className="s">
            {fmtNum(t?.chunks_skipped)} of {fmtNum(totalChunks)} skipped
          </div>
        </div>
        <div className="readout">
          <div className="lbl">Handovers</div>
          <div className="v">{fmtNum(t?.migrations)}</div>
          <div className="s">epochs advanced</div>
        </div>
      </div>
    </section>
  );
}
