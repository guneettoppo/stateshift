"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnState, Snapshot } from "./types";

/**
 * Subscribes to the coordinator's live snapshot stream (SSE) and keeps a
 * fallback 2s poll running until it has actually received a data frame.
 *
 * This is deliberate: `next dev` and many proxies buffer SSE, delivering the
 * heartbeat but stalling the data frames, so the dashboard MUST NOT depend on
 * the stream alone. The immediate fetch paints fast in both dev and prod, and
 * polling takes over if the stream stalls.
 */
export function useStateShift() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const sseActiveRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let failover: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const stopPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const startPoll = () => {
      if (pollRef.current) return;
      const tick = async () => {
        if (!active) return;
        try {
          const r = await fetch("/api/state");
          if (!r.ok) throw new Error(`${r.status}`);
          apply(await r.text());
        } catch (e) {
          if (!active) return;
          setConn("offline");
          setLastError(e instanceof Error ? e.message : String(e));
        }
      };
      void tick();
      pollRef.current = setInterval(tick, 2000);
    };

    const apply = (text: string) => {
      if (!active) return;
      try {
        setSnap(JSON.parse(text));
        setLastError(null);
        setConn("live");
      } catch {
        /* drop malformed frame */
      }
    };

    // First paint fast, before any stream delivers.
    const boot = async () => {
      try {
        const r = await fetch("/api/state");
        if (!r.ok) throw new Error(`${r.status}`);
        apply(await r.text());
      } catch {
        /* static server will try again via poll */
      }
    };
    void boot();

    try {
      es = new EventSource("/api/events");
    } catch {
      startPoll();
      return;
    }

    es.onmessage = (ev) => {
      sseActiveRef.current = true;
      stopPoll();
      apply(ev.data);
    };
    es.onerror = () => {
      if (es && es.readyState === EventSource.CLOSED) {
        sseActiveRef.current = false;
        es.close();
        es = null;
        startPoll();
      }
    };

    // If the stream never actually delivers a frame (dev buffering), poll.
    failover = setTimeout(() => {
      if (!sseActiveRef.current) startPoll();
    }, 1500);

    return () => {
      active = false;
      if (failover) clearTimeout(failover);
      es?.close();
      stopPoll();
    };
  }, []);

  return { snap, conn, lastError };
}
