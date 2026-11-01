"use client";

import { useEffect, useRef } from "react";
import type { ConnState } from "@/lib/types";
import { GlyphSearch } from "@/lib/glyphs";

/**
 * The masthead: identity, breadcrumb, job filter, cluster + stream state,
 * theme switch. Kept deliberately thin — it is chrome, not content.
 */
export function Masthead({
  labels,
  conn,
  theme,
  onToggleTheme,
  query,
  onQuery,
}: {
  labels?: Record<string, string>;
  conn: ConnState;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  query: string;
  onQuery: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const db = labels?.db ?? "—";
  const stream =
    conn === "live" ? "stream live" : conn === "connecting" ? "connecting" : "offline";

  return (
    <header className="top">
      <div className="brand">
        <span className="mark" aria-hidden>
          <i />
        </span>
        stateshift
      </div>

      <nav className="crumb" aria-label="Breadcrumb">
        <span>/</span>
        <span>fleet</span>
        <span>/</span>
        <b>jobs</b>
      </nav>

      <label className="search" style={{ cursor: "text" }}>
        <GlyphSearch />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter jobs by id, owner, status…"
          aria-label="Filter jobs"
          style={{
            border: 0,
            background: "transparent",
            outline: "none",
            color: "var(--ink)",
            fontSize: 12.5,
            width: "100%",
            minWidth: 0,
          }}
        />
        <kbd>⌘K</kbd>
      </label>

      <div className="env" title={`control plane db: ${db}`}>
        <span className={`dot ${conn === "live" ? "ok" : conn === "offline" ? "bad" : "run"}`} />
        cluster <b>{db}</b>
      </div>

      <div className="env">
        <span className={`dot ${conn === "live" ? "live" : "bad"}`} />
        {stream}
      </div>

      <div className="seg" role="group" aria-label="Theme">
        <button
          onClick={onToggleTheme}
          aria-pressed={theme === "light"}
          title="Light theme"
        >
          Light
        </button>
        <button
          onClick={onToggleTheme}
          aria-pressed={theme === "dark"}
          title="Dark theme"
        >
          Dark
        </button>
      </div>

      <div className="avatar" aria-hidden>
        GT
      </div>
    </header>
  );
}
