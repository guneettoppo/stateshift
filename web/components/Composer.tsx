"use client";

import { useState } from "react";
import type { NodeInfo } from "@/lib/types";
import type { ApiResult } from "@/lib/api";
import { GlyphX } from "@/lib/glyphs";

const WORKLOADS = [
  { id: "compute", title: "Compute", desc: "Deterministic step state · correctness proof" },
  { id: "agent", title: "Agent", desc: "Tool-calling LLM loop · exactly-once model spend" },
];

/** New-job composer. Same payload as before, quieter surface. */
export function Composer({
  open,
  onClose,
  nodes,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  nodes: NodeInfo[];
  onCreate: (p: {
    workload: string;
    steps: number;
    prompt?: string;
    node?: string;
  }) => Promise<ApiResult>;
}) {
  const [workload, setWorkload] = useState("compute");
  const [steps, setSteps] = useState(400);
  const [prompt, setPrompt] = useState("");
  const [node, setNode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await onCreate({
      workload,
      steps,
      prompt: workload === "agent" ? prompt : undefined,
      node: node || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not start job");
      return;
    }
    onClose();
    setPrompt("");
    setSteps(400);
    setNode("");
  };

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <aside className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="dr-head" style={{ paddingLeft: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Start a job</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
              Deploy a migratable workload to the fleet.
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <GlyphX />
          </button>
        </div>

        <form
          onSubmit={submit}
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            overflowY: "auto",
          }}
        >
          <div>
            <div className="field-label">Workload</div>
            <div style={{ display: "grid", gap: 6 }}>
              {WORKLOADS.map((w) => (
                <button
                  type="button"
                  key={w.id}
                  className="opt"
                  aria-pressed={workload === w.id}
                  onClick={() => setWorkload(w.id)}
                >
                  <div className="t">{w.title}</div>
                  <div className="d">{w.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="field-label">Steps — {steps.toLocaleString()}</div>
            <input
              type="range"
              min={10}
              max={2000}
              step={10}
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent)" }}
            />
          </div>

          {workload === "agent" && (
            <div>
              <div className="field-label">Prompt (optional)</div>
              <textarea
                className="input"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should the agent do?"
                style={{ resize: "vertical" }}
              />
            </div>
          )}

          <div>
            <div className="field-label">Run on</div>
            <select className="input" value={node} onChange={(e) => setNode(e.target.value)}>
              <option value="">Auto — least-loaded worker</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id} · {n.jobs} job{n.jobs === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>

          {!nodes.length && (
            <div
              className="mono"
              style={{
                fontSize: 11.5,
                color: "var(--warn)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                padding: "8px 10px",
              }}
            >
              no workers registered — start the coordinator and a node first
            </div>
          )}

          {error && (
            <div
              className="mono"
              style={{
                fontSize: 11.5,
                color: "var(--bad)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                padding: "8px 10px",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginTop: "auto", paddingTop: 4 }}>
            <button
              type="submit"
              className="btn primary"
              disabled={busy}
              style={{ width: "100%", height: 32, justifyContent: "center" }}
            >
              {busy ? "Starting…" : "Start job"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
