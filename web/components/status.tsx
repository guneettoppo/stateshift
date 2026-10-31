const STATUS: Record<
  string,
  { label: string; cls: string; live: boolean }
> = {
  running: {
    label: "Running",
    cls: "bg-emerald-500/10 text-emerald-600 ring-emerald-600/20 dark:text-emerald-400 dark:ring-emerald-400/30",
    live: true,
  },
  draining: {
    label: "Draining",
    cls: "bg-amber-400/10 text-amber-600 ring-amber-500/25 dark:text-amber-400 dark:ring-amber-400/30",
    live: true,
  },
  restoring: {
    label: "Restoring",
    cls: "bg-sky-500/10 text-sky-600 ring-sky-500/25 dark:text-sky-400 dark:ring-sky-400/30",
    live: true,
  },
  drained: {
    label: "Drained",
    cls: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300 dark:ring-zinc-400/25",
    live: false,
  },
  done: {
    label: "Done",
    cls: "bg-zinc-800/10 text-zinc-800 ring-zinc-900/15 dark:bg-white/10 dark:text-zinc-100 dark:ring-white/20",
    live: false,
  },
  failed: {
    label: "Failed",
    cls: "bg-rose-500/10 text-rose-600 ring-rose-500/25 dark:text-rose-400 dark:ring-rose-400/30",
    live: false,
  },
};

export function StatusPill({ status, phase }: { status: string; phase?: string }) {
  const s = STATUS[status] ?? {
    label: status,
    cls: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300",
    live: false,
  };
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap ${s.cls}`}
      >
        {s.live && (
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-50 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
          </span>
        )}
        {s.label}
      </span>
      {phase && (
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-mute whitespace-nowrap">
          {phase}
        </span>
      )}
    </div>
  );
}

const FAILURE_HINTS: Record<string, string> = {
  ok: "Committed",
  "aborted-status-race": "Status race",
  "aborted-quiesce-failed": "Quiesce failed",
  "aborted-fence-lost": "Fence lost",
  "failed-failover-back": "Restore failed",
};

export function OutcomePill({ outcome }: { outcome: string }) {
  const ok = outcome === "ok";
  const failing = outcome.startsWith("failed") || outcome.startsWith("aborted");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ring-1 ring-inset whitespace-nowrap ${
        ok
          ? "bg-emerald-500/10 text-emerald-600 ring-emerald-600/20 dark:text-emerald-400"
          : failing
            ? "bg-amber-400/10 text-amber-600 ring-amber-500/25 dark:text-amber-400"
            : "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300"
      }`}
    >
      {FAILURE_HINTS[outcome] ?? outcome}
    </span>
  );
}
