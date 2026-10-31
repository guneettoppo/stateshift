"use client";

import { useState } from "react";
import type { NodeInfo } from "@/lib/types";
import type { ApiResult } from "@/lib/api";
import { X } from "@/lib/icons";

const WORKLOADS = [
  {
    id: "compute",
    title: "Compute",
    desc: "Deterministic step state · correctness proof",
  },
  {
    id: "agent",
    title: "Agent",
    desc: "Tool-calling LLM loop · exactly-once LLM spend",
  },
];

export function NewJobSheet({
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
    <div className="fixed inset-0 z-40">
      <div
        className="fade-in absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside className="sheet-in absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-5">
          <div>
            <h2 className="text-[19px] font-semibold tracking-tight text-ink">
              Start a job
            </h2>
            <p className="mt-0.5 text-[12px] text-mute">
              Deploy a migratable workload to the fleet.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-mute transition hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="scroll-slim flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
          <Field label="Workload">
            <div className="grid gap-2">
              {WORKLOADS.map((w) => (
                <button
                  type="button"
                  key={w.id}
                  onClick={() => setWorkload(w.id)}
                  className={`rounded-2xl border p-3 text-left transition ${
                    workload === w.id
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-card hover:border-line-strong"
                  }`}
                >
                  <div className="text-[14px] font-semibold text-ink">{w.title}</div>
                  <div className="mt-0.5 text-[11px] text-mute">{w.desc}</div>
                </button>
              ))}
            </div>
          </Field>

          <Field label={`Steps — ${steps.toLocaleString()}`}>
            <input
              type="range"
              min={10}
              max={2000}
              step={10}
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent"
            />
            <div className="mt-1 flex justify-between text-[10px] font-medium uppercase tracking-wide text-mute">
              <span>10</span>
              <span>2000</span>
            </div>
          </Field>

          {workload === "agent" && (
            <Field label="Prompt (optional)">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="What should the agent do?"
                className="w-full resize-none rounded-xl border border-line bg-card px-3 py-2.5 text-[13px] text-ink outline-none transition placeholder:text-mute/70 focus:border-accent"
              />
            </Field>
          )}

          <Field label="Run on">
            <div className="relative">
              <select
                value={node}
                onChange={(e) => setNode(e.target.value)}
                className="w-full appearance-none rounded-xl border border-line bg-card px-3 py-2.5 text-[13px] text-ink outline-none transition focus:border-accent"
              >
                <option value="">Auto — least-loaded worker</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id} · {n.jobs} job{n.jobs === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
                ▾
              </span>
            </div>
          </Field>

          {!nodes.length && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-[12px] text-amber-700 dark:text-amber-400">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              No workers are registered. Start the coordinator and nodes before
              creating a job.
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 text-[12px] text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="mt-auto pt-2">
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-accent py-3 text-[14px] font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? "Starting…" : "Start job"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
        {label}
      </div>
      {children}
    </div>
  );
}
