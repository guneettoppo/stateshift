"use client";

import type { NodeInfo } from "@/lib/types";

/** Workers as rows, not cards: name, address, load, and who holds authority. */
export function NodeLedger({
  nodes,
  authoritative,
}: {
  nodes: NodeInfo[] | undefined;
  authoritative: string[];
}) {
  const fleet = nodes ?? [];
  if (!fleet.length) {
    return (
      <div className="empty">
        No workers registered.
        <div className="mono" style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>
          start a node with --role=node, or --role=all for two local workers
        </div>
      </div>
    );
  }

  const maxLoad = Math.max(1, ...fleet.map((n) => n.jobs));

  return (
    <div className="p-body" style={{ paddingTop: 4, paddingBottom: 6 }} id="nodes">
      {fleet.map((n) => {
        const owns = authoritative.includes(n.id);
        const filled = n.jobs ? Math.max(1, Math.round((n.jobs / maxLoad) * 10)) : 0;
        return (
          <div className="kv" key={n.id}>
            <span className="k" style={{ minWidth: 0, color: "var(--ink)" }}>
              <span className={`dot ${owns ? "live" : "ok"}`} style={{ marginRight: 7 }} />
              <span className="mono" style={{ fontSize: 12 }}>
                {n.id}
              </span>
            </span>
            <span className="v" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>
                {n.addr}
              </span>
              <span
                aria-hidden
                style={{ display: "inline-flex", gap: 1.5 }}
                title={`${n.jobs} job${n.jobs === 1 ? "" : "s"}`}
              >
                {Array.from({ length: 10 }).map((_, i) => (
                  <i
                    key={i}
                    style={{
                      display: "block",
                      width: 3,
                      height: 10,
                      borderRadius: 1,
                      background: i < filled ? "var(--ink)" : "var(--line)",
                      opacity: i < filled ? 0.8 : 1,
                    }}
                  />
                ))}
              </span>
              <span style={{ minWidth: 44, textAlign: "right" }}>
                {owns ? "auth" : n.jobs ? `${n.jobs} job${n.jobs === 1 ? "" : "s"}` : "idle"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
