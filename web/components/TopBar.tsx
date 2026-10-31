"use client";

import { useState } from "react";
import type { ConnState } from "@/lib/types";
import { Logo, Moon, Plus, Sun } from "@/lib/icons";

export function TopBar({
  labels,
  conn,
  theme,
  onToggleTheme,
  onNewJob,
}: {
  labels: Record<string, string> | undefined;
  conn: ConnState;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onNewJob: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 -mx-4 px-4 py-3 backdrop-blur-xl bg-page/70 border-b border-line md:-mx-8 md:px-8">
      <div className="mx-auto flex max-w-6xl items-center gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white shadow-sm"
            style={{ background: "linear-gradient(135deg,#0a84ff,#5e5ce6)" }}
          >
            <Logo className="h-9 w-9" />
          </span>
          <div className="leading-tight">
            <div className="text-[17px] font-semibold tracking-tight text-ink">
              StateShift
            </div>
            <div className="text-[11px] text-mute">
              live migration control plane
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1.5 md:flex">
            {(labels ? Object.entries(labels) : []).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute"
              >
                {k}
                <b className="font-semibold text-ink">{v}</b>
              </span>
            ))}
          </div>

          <ConnBadge conn={conn} />

          <button
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-card text-mute transition hover:text-ink hover:border-line-strong"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            onClick={onNewJob}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent pl-3 pr-4 text-[13px] font-medium text-white shadow-sm transition hover:brightness-105 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            New job
          </button>
        </div>
      </div>
    </header>
  );
}

function ConnBadge({ conn }: { conn: ConnState }) {
  const reload = () => window.location.reload();
  const color =
    conn === "live"
      ? "text-emerald-600 dark:text-emerald-400"
      : conn === "offline"
        ? "text-rose-600 dark:text-rose-400"
        : "text-amber-600 dark:text-amber-400";
  const label =
    conn === "live" ? "Live" : conn === "offline" ? "Offline" : "Connecting";
  return (
    <button
      onClick={reload}
      title={conn === "offline" ? "Reconnect" : "Connection status"}
      className={`inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-[11px] font-medium ${color}`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={`absolute inline-flex h-full w-full rounded-full bg-current opacity-60 animate-ping ${
            conn === "live" ? "live-dot" : ""
          }`}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
      </span>
      {label}
    </button>
  );
}
