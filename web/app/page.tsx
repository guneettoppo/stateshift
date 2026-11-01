"use client";

import { useEffect, useMemo, useState } from "react";
import { useStateShift } from "@/lib/useStateShift";
import type { ApiResult } from "@/lib/api";
import { createJob, migrateJob } from "@/lib/api";
import type { CreateJobPayload, JobView } from "@/lib/types";
import { fmtNum, fmtUptime } from "@/lib/format";
import { Masthead } from "@/components/Masthead";
import { ReadoutStrip } from "@/components/ReadoutStrip";
import { NodeLedger } from "@/components/NodeLedger";
import { LedgerTable } from "@/components/LedgerTable";
import { HandoverLog } from "@/components/HandoverLog";
import { InspectPanel } from "@/components/InspectPanel";
import { Composer } from "@/components/Composer";
import {
  GlyphConsole,
  GlyphGear,
  GlyphJobs,
  GlyphLogs,
  GlyphNodes,
  GlyphPlus,
  GlyphSearch,
  GlyphSwap,
} from "@/lib/glyphs";

type Theme = "light" | "dark";

export default function Dashboard() {
  const { snap, conn } = useStateShift();
  const [theme, setTheme] = useState<Theme>("light");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [migratingJob, setMigratingJob] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    // The theme lives on <html> (set before paint by layout.tsx), so it can
    // only be read after mount — reading it during render would mismatch SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(
      typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
    );
  }, []);

  const toggleTheme = () =>
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      if (typeof document !== "undefined")
        document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("ss-theme", next);
      } catch {}
      return next;
    });

  const showToast = (msg: string, tone: "ok" | "err" = "ok") => {
    setToast({ msg, tone });
    window.setTimeout(() => setToast(null), 3600);
  };

  const nodes = useMemo(() => snap?.nodes ?? [], [snap]);
  const jobs = useMemo(() => snap?.jobs ?? [], [snap]);
  const migrations = useMemo(() => snap?.migrations ?? [], [snap]);
  const running = jobs.filter((j) => j.status === "running").length;

  const authoritative = useMemo(
    () =>
      Array.from(
        new Set(
          jobs
            .filter((j) => ["running", "restoring", "draining"].includes(j.status))
            .map((j) => j.owner),
        ),
      ),
    [jobs],
  );

  /* The open inspector follows the live snapshot by id. */
  const selected: JobView | null = selectedId
    ? jobs.find((j) => j.id === selectedId) ?? null
    : null;

  const visibleJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      [j.id, j.workload, j.owner, j.status, String(j.epoch)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [jobs, query]);

  const doMigrate = async (jobId: string, target: string) => {
    setMigratingJob(jobId);
    const res = await migrateJob(jobId, target);
    setMigratingJob(null);
    if (res.ok) showToast(`Migration → ${target} committed`);
    else showToast(res.error ?? "Migration failed", "err");
  };

  const doCreate = async (p: CreateJobPayload): Promise<ApiResult> => {
    const res = await createJob(p);
    if (res.ok)
      showToast(
        p.node ? `Job started on ${p.node}` : "Job started on the least-loaded worker",
      );
    return res;
  };

  if (!snap) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 24 }}>
        <div className="panel" style={{ maxWidth: 440, width: "100%", padding: 24 }}>
          <div className="lbl">stateshift</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
            {conn === "offline" ? "Coordinator not reachable" : "Connecting…"}
          </div>
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>
            {conn === "offline"
              ? "Start the coordinator, then reload. The console subscribes to its snapshot stream and picks up as soon as it is back."
              : "Waiting for the first snapshot from the control plane."}
          </p>
          <pre
            className="mono"
            style={{
              marginTop: 14,
              padding: 10,
              border: "1px solid var(--line)",
              borderRadius: 4,
              fontSize: 10.5,
              color: "var(--muted)",
              overflowX: "auto",
            }}
          >{`go run ./cmd/stateshift --role=all \\
  --db=mem --blob=fs --blob-dir=.run/blob --llm=mock`}</pre>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Masthead
        labels={snap.labels}
        conn={conn}
        theme={theme}
        onToggleTheme={toggleTheme}
        query={query}
        onQuery={setQuery}
      />

      <nav className="rail" aria-label="Primary">
        <button aria-current="page" title="Console">
          <GlyphConsole />
        </button>
        <a href="#jobs" title="Jobs">
          <GlyphJobs />
        </a>
        <a href="#migrations" title="Handovers">
          <GlyphSwap />
        </a>
        <a href="#nodes" title="Workers">
          <GlyphNodes />
        </a>
        <a href="#pause" title="Pause">
          <GlyphLogs />
        </a>
        <span className="grow" />
        <button title="Settings">
          <GlyphGear />
        </button>
      </nav>

      <aside className="side">
        <div className="ws">
          <span className="dot ok" />
          stateshift
          <span style={{ marginLeft: "auto", color: "var(--faint)" }}>⌄</span>
        </div>
        <button className="nav-item" aria-current="page">
          Overview
        </button>
        <a className="nav-item" href="#jobs">
          Jobs <span className="count">{jobs.length}</span>
        </a>
        <a className="nav-item" href="#migrations">
          Handovers <span className="count">{migrations.length}</span>
        </a>
        <a className="nav-item" href="#nodes">
          Workers <span className="count">{nodes.length}</span>
        </a>

        <div className="divider" />
        <div className="lbl" style={{ padding: "0 6px 6px" }}>
          Workers
        </div>
        {nodes.length ? (
          nodes.map((n) => (
            <div className="node-row" key={n.id}>
              <span className="nm">{n.id}</span>
              <span className="st">
                <span className={`dot ${authoritative.includes(n.id) ? "live" : "ok"}`} />
                {authoritative.includes(n.id) ? "auth" : String(n.jobs)}
              </span>
            </div>
          ))
        ) : (
          <div className="node-row" style={{ color: "var(--faint)" }}>
            none registered
          </div>
        )}

        <div className="divider" />
        <div className="lbl" style={{ padding: "0 6px 6px" }}>
          Storage
        </div>
        <div className="node-row">
          <span className="dot ok" />
          <span className="mono" style={{ fontSize: 11 }}>
            {snap.labels?.blob ?? "—"}
          </span>
        </div>

        <div className="side-foot">
          <span>{snap.labels?.llm ?? "llm: —"}</span>
          <span>{fmtUptime(snap.uptime_s)}</span>
        </div>
      </aside>

      <main className="main">
        <div className="page-head">
          <h1>Jobs</h1>
          <span className="meta">
            <span className={`dot ${conn === "live" ? "ok" : "run"}`} />
            {conn === "live" ? "stream live" : conn}
            <span style={{ color: "var(--faint)" }}>·</span>
            <span className="mono">{fmtUptime(snap.uptime_s)} up</span>
          </span>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() => document.querySelector<HTMLInputElement>(".search input")?.focus()}
          >
            <GlyphSearch />
            Filter
          </button>
          <button className="btn primary" onClick={() => setSheetOpen(true)}>
            <GlyphPlus />
            New job
          </button>
        </div>

        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected="true">
            Overview
          </button>
          <a className="tab" href="#jobs" role="tab" aria-selected={false}>
            Jobs
          </a>
          <a className="tab" href="#migrations" role="tab" aria-selected={false}>
            Handovers
          </a>
          <a className="tab" href="#nodes" role="tab" aria-selected={false}>
            Workers
          </a>
        </div>

        {conn === "offline" && (
          <div
            className="mono"
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              border: "1px solid var(--line)",
              borderRadius: 4,
              fontSize: 11.5,
              color: "var(--warn)",
            }}
          >
            snapshot stream lost — showing the last frame while it retries
          </div>
        )}

        <ReadoutStrip totals={snap.totals} running={running} workers={nodes.length} />

        <div className="grid2" style={{ marginTop: 12 }}>
          <div>
            <LedgerTable
              jobs={visibleJobs}
              nodes={nodes}
              migrating={migratingJob}
              selectedId={selectedId}
              onSelect={(j) => setSelectedId(j.id)}
              onMigrate={doMigrate}
            />
            <HandoverLog migrations={migrations} />
          </div>

          <div>
            <PausePanel migrations={migrations} />
            <div className="panel" id="nodes">
              <div className="p-head">
                <span className="lbl">Fleet</span>
                <span className="right">
                  <span className="mono">{nodes.length}</span> workers
                </span>
              </div>
              <NodeLedger nodes={nodes} authoritative={authoritative} />
            </div>
            <div className="panel">
              <div className="p-head">
                <span className="lbl">Control plane</span>
              </div>
              <div className="p-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
                <div className="kv">
                  <span className="k">Database</span>
                  <span className="v">{snap.labels?.db ?? "—"}</span>
                </div>
                <div className="kv">
                  <span className="k">Object store</span>
                  <span
                    className="v"
                    style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }}
                    title={snap.labels?.blob}
                  >
                    {snap.labels?.blob ?? "—"}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Uptime</span>
                  <span className="v">{fmtUptime(snap.uptime_s)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid var(--line)",
            display: "flex",
            gap: 10,
            alignItems: "center",
            fontSize: 11,
            color: "var(--muted)",
            flexWrap: "wrap",
          }}
        >
          <span className="mono">epoch fence — exactly one authoritative owner</span>
          <span style={{ marginLeft: "auto" }} className="mono">
            {fmtNum(snap.totals?.ops)} ops · {fmtNum(migrations.length)} handovers
          </span>
        </footer>
      </main>

      <Composer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        nodes={nodes}
        onCreate={doCreate}
      />

      {selected && (
        <InspectPanel
          job={selected}
          nodes={nodes}
          migrations={migrations}
          migrating={migratingJob}
          onClose={() => setSelectedId(null)}
          onMigrate={doMigrate}
        />
      )}

      <div className="toast" data-show={!!toast} role="status" aria-live="polite">
        {toast?.msg}
      </div>
    </div>
  );
}

/** Pause per handover, drawn from the audit trail — the only real chart data. */
function PausePanel({
  migrations,
}: {
  migrations: { pause_ms: number; epoch_to: number }[];
}) {
  const recent = migrations.filter((m) => m.pause_ms > 0).slice(-8);
  const max = Math.max(1, ...recent.map((m) => m.pause_ms));
  const last = recent.length ? recent[recent.length - 1].pause_ms : 0;
  const sorted = recent.map((m) => m.pause_ms).sort((a, b) => a - b);
  const p50 = recent.length ? sorted[Math.floor(recent.length / 2)] : 0;

  return (
    <div className="panel" id="pause">
      <div className="p-head">
        <span className="lbl">Pause per handover</span>
        <span className="right">last {recent.length || 0}</span>
      </div>
      <div className="p-body" style={{ paddingTop: 10 }}>
        {recent.length ? (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 46 }}>
              {recent.map((m, i) => (
                <i
                  key={i}
                  title={`epoch ${m.epoch_to} · ${m.pause_ms} ms`}
                  style={{
                    display: "block",
                    flex: 1,
                    height: `${Math.max(6, (m.pause_ms / max) * 100)}%`,
                    background: "var(--ink)",
                    opacity: i === recent.length - 1 ? 1 : 0.45,
                    borderRadius: 1,
                  }}
                />
              ))}
            </div>
            <div className="legend" style={{ justifyContent: "space-between" }}>
              <span className="mono">last {fmtNum(last)} ms</span>
              <span className="mono">p50 {fmtNum(p50)} ms</span>
            </div>
          </>
        ) : (
          <div className="empty" style={{ padding: "10px 0" }}>
            No handovers recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}
