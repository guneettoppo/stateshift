"use client";

import type { Totals } from "@/lib/types";
import { Bolt, Clock, Database, Gauge, Layers } from "@/lib/icons";
import { dedupeRate, fmtBytes, fmtNum } from "@/lib/format";

export function StatCards({
  totals,
  running,
}: {
  totals: Totals | undefined;
  running: number;
}) {
  const t = totals;
  const cards = [
    {
      icon: Layers,
      label: "Jobs",
      value: fmtNum(t?.jobs),
      sub: `${running} active`,
      tint: "text-accent",
    },
    {
      icon: Bolt,
      label: "Ops committed",
      value: fmtNum(t?.ops),
      sub: "exactly-once steps",
      tint: "text-emerald-500",
    },
    {
      icon: Database,
      label: "State shipped",
      value: fmtBytes(t?.bytes),
      sub: "across handovers",
      tint: "text-violet-500",
    },
    {
      icon: Clock,
      label: "Last pause",
      value: t?.last_pause_ms ? `${fmtNum(t.last_pause_ms)}` : "—",
      sub: t?.last_pause_ms ? "ms downtime" : "no migration yet",
      tint: "text-amber-500",
    },
    {
      icon: Bolt,
      label: "Chunk dedupe",
      value: dedupeRate(t ?? { chunks_sent: 0, chunks_skipped: 0 }),
      sub: "of chunks skipped",
      tint: "text-sky-500",
    },
    {
      icon: Gauge,
      label: "Migrations",
      value: fmtNum(t?.migrations),
      sub: "handovers recorded",
      tint: "text-rose-500",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {cards.map((c, i) => (
        <div
          key={c.label}
          className="card rise p-4"
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mute">
              {c.label}
            </span>
            <c.icon className={`h-4 w-4 ${c.tint}`} />
          </div>
          <div className="num mt-2.5 text-[26px] font-semibold leading-none tracking-tight text-ink">
            {c.value}
          </div>
          <div className="mt-2 text-[11px] text-mute">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
