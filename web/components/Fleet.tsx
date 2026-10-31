"use client";

import type { NodeInfo } from "@/lib/types";
import { nodeHue } from "@/lib/format";

export function Fleet({
  nodes,
  authoritative,
}: {
  nodes: NodeInfo[] | undefined;
  authoritative: string[];
}) {
  const fleet = nodes ?? [];
  if (!fleet.length) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-mute">
          No workers registered yet.
          <span className="mt-1 block font-mono text-[11px] text-mute/80">
            start a node with —role=node, or run —role=all for two local
            workers
          </span>
        </p>
      </div>
    );
  }

  const maxLoad = Math.max(1, ...fleet.map((n) => n.jobs));

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {fleet.map((n) => {
        const hue = nodeHue(n.id);
        const owns = authoritative.includes(n.id);
        return (
          <div
            key={n.id}
            className={`card rise relative p-4 transition ${
              owns ? "shadow-[0_0_0_1px_var(--accent)]" : ""
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: hue }}
              />
              <span className="font-mono text-[15px] font-semibold text-ink">
                {n.id}
              </span>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset ${
                  owns
                    ? "bg-accent-soft text-accent ring-accent/30"
                    : "text-mute ring-line"
                }`}
              >
                {owns ? "authoritative" : n.jobs ? "loaded" : "idle"}
              </span>
            </div>
            <div className="mt-1 pl-[17px] font-mono text-[11px] text-mute">
              {n.addr || "—"}
            </div>
            <div className="mt-3 flex items-center gap-3 pl-[17px]">
              <span className="num text-[12px] text-ink">
                {n.jobs} job{n.jobs === 1 ? "" : "s"}
              </span>
              <div className="bar flex-1">
                <i style={{ width: `${(n.jobs / maxLoad) * 100}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
