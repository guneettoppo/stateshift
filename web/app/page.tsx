"use client";

import { useEffect, useMemo, useState } from "react";
import { useStateShift } from "@/lib/useStateShift";
import type { CreateJobPayload, JobView } from "@/lib/types";
import type { ApiResult } from "@/lib/api";
import { createJob, migrateJob } from "@/lib/api";
import { fmtClock, fmtUptime } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { StatCards } from "@/components/StatCards";
import { Fleet } from "@/components/Fleet";
import { JobsTable } from "@/components/JobsTable";
import { Migrations } from "@/components/Migrations";
import { NewJobSheet } from "@/components/NewJobSheet";
import { JobDetail } from "@/components/JobDetail";
import { Logo } from "@/lib/icons";

type Theme = "light" | "dark";

export default function Dashboard() {
  const { snap, conn } = useStateShift();
  const [theme, setTheme] = useState<Theme>("light");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<JobView | null>(null);
  const [migratingJob, setMigratingJob] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
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

  const nodes = snap?.nodes ?? [];
  const jobs = snap?.jobs ?? [];
  const running = jobs.filter((j) => j.status === "running").length;
  const authoritative = useMemo(
    () =>
      new Set(
        jobs
          .filter((j) => ["running", "restoring", "draining"].includes(j.status))
          .map((j) => j.owner),
      ),
    [jobs],
  );

  /* Keep the open detail pane live against the snapshot stream. */
  const liveSelected =
    selected && snap ? snap.jobs.find((j) => j.id === selected.id) ?? null : selected;

  const doMigrate = async (jobId: string, target: string) => {
    setMigratingJob(jobId);
    const res = await migrateJob(jobId, target);
    setMigratingJob(null);
    if (res.ok) {
      showToast(`Migration → ${target} committed`);
      setSelected(snap?.jobs.find((j) => j.id === jobId) ?? null);
    } else {
      showToast(res.error ?? "Migration failed", "err");
    }
  };

  const doCreate = async (p: CreateJobPayload): Promise<ApiResult> => {
    const pinned = nodeless(p) ? "" : p.node!;
    const res = await createJob(p);
    if (res.ok) {
      showToast(
        pinned ? `Job started on ${pinned}` : "Job started on the least-loaded worker",
      );
    }
    return res;
  };

  return (
    <div className="min-h-dvh pb-16">
      <TopBar
        labels={snap?.labels}
        conn={conn}
        theme={theme}
        onToggleTheme={toggleTheme}
        onNewJob={() => setSheetOpen(true)}
      />

      <main className="mx-auto max-w-6xl px-4 pt-8 md:px-8">
        {!snap ? (
          <OfflineCard
            offline={conn === "offline"}
            onRetry={() => window.location.reload()}
          />
        ) : (
          <>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
                  Control plane
                </div>
                <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-ink">
                  Fleet overview
                </h1>
                <p className="mt-1 max-w-xl text-[13px] text-mute">
                  Every migration is a pause at a step boundary, a handover of
                  authority through an epoch fence, and a resume — nothing lost,
                  nothing repeated.
                </p>
              </div>
              <div className="num hidden text-right font-mono text-[11px] text-mute sm:block">
                <div>uptime {fmtUptime(snap.uptime_s)}</div>
                <div>sync {fmtClock(snap.now)}</div>
              </div>
            </div>

            {conn === "offline" && (
              <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-[12.5px] text-amber-700 dark:text-amber-400">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                Stream lost — showing the last snapshot while we retry.
                Reconnecting…
              </div>
            )}

            <StatCards totals={snap.totals} running={running} />

            <section className="mt-9">
              <SectionHead
                title="Fleet"
                hint={`${nodes.length} worker${nodes.length === 1 ? "" : "s"}`}
              />
              <Fleet nodes={nodes} authoritative={[...authoritative]} />
            </section>

            <section className="mt-9">
              <SectionHead
                title="Jobs"
                hint={`${jobs.length} total · ${running} running`}
                action={
                  <button
                    onClick={() => setSheetOpen(true)}
                    className="text-[12px] font-medium text-accent transition hover:brightness-110"
                  >
                    + New job
                  </button>
                }
              />
              <JobsTable
                jobs={jobs}
                nodes={nodes}
                migrating={migratingJob}
                onSelect={setSelected}
                onMigrate={doMigrate}
              />
            </section>

            <section className="mt-9">
              <SectionHead
                title="Migrations"
                hint={`${snap.totals.migrations} handovers`}
              />
              <Migrations migrations={snap.migrations} />
            </section>

            <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[11px] text-mute">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-accent text-white">
                  <Logo className="h-6 w-6" />
                </span>
                <span className="font-mono">
                  epoch fence — exactly one authoritative owner
                </span>
              </div>
              <div className="font-mono">
                StateShift control plane · {fmtUptime(snap.uptime_s)}
              </div>
            </footer>
          </>
        )}
      </main>

      <NewJobSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        nodes={nodes}
        onCreate={doCreate}
      />

      {liveSelected && (
        <JobDetail
          job={liveSelected}
          nodes={nodes}
          migrations={snap?.migrations ?? []}
          migrating={migratingJob}
          onClose={() => setSelected(null)}
          onMigrate={doMigrate}
        />
      )}

      {toast && (
        <div
          className={`fade-in rise fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border px-4 py-2 text-[13px] font-medium shadow-xl ${
            toast.tone === "ok"
              ? "border-line bg-card text-ink"
              : "border-rose-500/30 bg-rose-600/95 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function nodeless(p: CreateJobPayload): boolean {
  return !p.node || !p.node.trim();
}

function SectionHead({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <span className="num text-[12px] font-mono text-mute">{hint}</span>}
      </div>
      {action}
    </div>
  );
}

function OfflineCard({
  offline,
  onRetry,
}: {
  offline: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="card mx-auto mt-16 max-w-md p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Logo className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-ink">
        StateShift
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-mute">
        {offline
          ? "The coordinator isn't reachable. Start it, then refresh — the dashboard subscribes live and will pick up as soon as it's back."
          : "Connecting to the control plane…"}
      </p>
      <button
        onClick={onRetry}
        className="mt-5 rounded-full bg-accent px-5 py-2 text-[13px] font-medium text-white transition hover:brightness-105"
      >
        Try again
      </button>
      <pre className="mt-6 rounded-xl bg-page p-3 text-left font-mono text-[10.5px] leading-relaxed text-mute dark:bg-white/[0.03]">
{`go run ./cmd/stateshift --role=all \\
  --db=mem --blob=fs --blob-dir=.run/blob --llm=mock
# dashboard: :9100 · this UI proxies each /api/* call there`}
      </pre>
    </div>
  );
}
