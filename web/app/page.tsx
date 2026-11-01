"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStateShift } from "@/lib/useStateShift";
import { createJob, migrateJob } from "@/lib/api";
import type { ApiResult } from "@/lib/api";
import type { CreateJobPayload, JobView, Migration, NodeInfo } from "@/lib/types";
import { fmtBytes, fmtNum, shortId } from "@/lib/format";
import { Composer } from "@/components/Composer";
import { GlyphPlus, GlyphSwap } from "@/lib/glyphs";

/**
 * The stage: two workers, one wire, one authority.
 *
 * Everything on this screen is read from `/api/state` (SSE with a polling
 * fallback). Nothing is invented: seq, epoch, ops, pause, bytes and chunk
 * counts are the audit records the coordinator wrote during the handover.
 */

const PHASES = ["quiesce", "checkpoint", "upload", "fence", "restore", "resume"];
const TICKS = 40;

type Pending = { jobId: string; from: string; target: string; at: number };

export default function Stage() {
  const { snap, conn } = useStateShift();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /* Boundaries survive a reload for this tab: a page refresh mid-pitch must
     not blank the number on the fenced node. */
  const [boundaries, setBoundaries] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(sessionStorage.getItem("ss-boundaries") || "{}");
    } catch {
      return {};
    }
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    // The theme lives on <html>, applied before paint by layout.tsx; it can
    // only be read after mount without breaking SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  /* keep the elapsed clock running while a handover is in flight */
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [pending]);

  useEffect(() => {
    try {
      sessionStorage.setItem("ss-boundaries", JSON.stringify(boundaries));
    } catch {}
  }, [boundaries]);

  const setThemeMode = (next: "dark" | "light") => {
    setTheme(next);
    document.documentElement.classList.toggle("light", next === "light");
    try {
      localStorage.setItem("ss-theme", next);
    } catch {}
  };

  const say = (msg: string, err = false) => {
    setToast({ msg, err });
    window.setTimeout(() => setToast(null), 3800);
  };

  const nodes = useMemo(() => snap?.nodes ?? [], [snap]);
  const jobs = useMemo(() => snap?.jobs ?? [], [snap]);
  const migrations = useMemo(() => snap?.migrations ?? [], [snap]);

  /* The audit record carries the pause and the bytes, but not the seq the job
     stopped at. Watch the snapshot stream: the last seq seen while a job was
     still `running` is exactly the boundary it drains at. Only handovers
     witnessed by this tab get a number — nothing is inferred. */
  const prevStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    const seen: Record<string, string> = { ...prevStatus.current };
    const found: Record<string, number> = {};
    for (const j of jobs) {
      const was = seen[j.id];
      if (was === "running" && j.status !== "running" && j.status !== "draining") {
        found[j.id] = j.seq;
      }
      seen[j.id] = j.status;
    }
    prevStatus.current = seen;
    if (Object.keys(found).length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBoundaries((b) => {
        const next = { ...b };
        let changed = false;
        for (const [id, seq] of Object.entries(found)) {
          /* the first boundary seen is the real one; draining a job to
             completion must not overwrite it with the final seq */
          if (next[id] === undefined) {
            next[id] = seq;
            changed = true;
          }
        }
        return changed ? next : b;
      });
    }
  }, [jobs]);

  const job: JobView | null = useMemo(() => {
    if (selectedId) {
      const hit = jobs.find((j) => j.id === selectedId);
      if (hit) return hit;
    }
    if (!jobs.length) return null;
    const running = jobs.filter((j) => j.status === "running" || j.status === "restoring");
    const pool = running.length ? running : jobs;
    return [...pool].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )[0];
  }, [jobs, selectedId]);

  const peer: NodeInfo | null = job ? nodes.find((n) => n.id !== job.owner) ?? null : null;

  const lastMig: Migration | null = useMemo(() => {
    if (!job) return null;
    const own = migrations.filter((m) => m.job_id === job.id);
    return own.length ? own[own.length - 1] : null;
  }, [job, migrations]);

  const inFlight = pending && job && pending.jobId === job.id ? pending : null;
  const elapsed = inFlight ? Math.max(0, now - inFlight.at) : 0;

  /* Which worker is on the left, which on the right. Before any handover the
     owner sits on the left and the peer stands by on the right; after one the
     source is fenced on the left and the new owner is on the right. */
  const handedOver = !!(lastMig && job && lastMig.to === job.owner && lastMig.outcome === "ok");
  const leftId = inFlight ? inFlight.from : handedOver ? lastMig!.from : job?.owner ?? null;
  const rightId = inFlight ? inFlight.target : handedOver ? lastMig!.to : peer?.id ?? null;

  const leftNode = nodes.find((n) => n.id === leftId) ?? null;
  const rightNode = nodes.find((n) => n.id === rightId) ?? null;

  const leftFenced = !inFlight && handedOver;
  const leftSeq = leftFenced ? boundaries[job?.id ?? ""] ?? null : job?.seq ?? null;
  const rightSeq = !inFlight && (rightId === job?.owner) ? job?.seq ?? null : null;

  const boundary = job ? boundaries[job.id] ?? null : null;
  const hotTick =
    boundary && job && job.total_steps
      ? Math.max(0, Math.round((boundary / job.total_steps) * TICKS) - 1)
      : null;

  const canMigrate = !!job && job.status === "running" && !!peer && !inFlight;

  const doMigrate = async () => {
    if (!job || !peer) return;
    const from = job.owner;
    const target = peer.id;
    const observed = job.seq;
    setBoundaries((b) => ({ ...b, [job.id]: observed }));
    setPending({ jobId: job.id, from, target, at: Date.now() });
    const res = await migrateJob(job.id, target);
    setPending(null);
    if (res.ok) say(`Handover committed · ${from} → ${target}`);
    else say(res.error ?? "Handover failed — authority stayed put", true);
  };

  const doCreate = async (p: CreateJobPayload): Promise<ApiResult> => {
    const res = await createJob(p);
    if (res.ok) say(p.node ? `Job started on ${p.node}` : "Job started on the least-loaded worker");
    return res;
  };

  /* ── phase states ────────────────────────────────────────────────────── */
  const activePhase = inFlight ? Math.min(PHASES.length - 1, Math.floor(elapsed / 420)) : -1;
  const phasesDone = !inFlight && lastMig?.outcome === "ok";

  const liveText = !snap
    ? conn
    : conn !== "live"
      ? conn
      : inFlight
        ? `handover in flight · ${fmtNum(elapsed)} ms`
        : job?.status === "done"
          ? "job complete"
          : handedOver
            ? `resumed on ${job?.owner}`
            : canMigrate
              ? "stream live · ready to hand over"
              : "stream live";

  const blink = inFlight ? "acc" : job?.status === "done" ? "ok" : "ok";

  /* ── empty / connecting ──────────────────────────────────────────────── */
  if (!snap || !job) {
    const offline = conn === "offline";
    return (
      <div className="app">
        <TopBar
          theme={theme}
          onTheme={setThemeMode}
          live={offline ? "coordinator offline" : conn}
          liveDot={offline ? "bad" : "warn"}
          crumb={null}
          onNew={() => setSheetOpen(true)}
        />
        <div className="stage" style={{ alignItems: "center" }}>
          <div className="empty-state">
            <div className="empty-card">
              <div className="lbl">stateshift · control plane</div>
              <h2>
                {!snap ? (offline ? "Coordinator not reachable" : "Connecting…") : "No jobs yet"}
              </h2>
              <p>
                {!snap
                  ? "Start the coordinator, then reload. This screen subscribes to its snapshot stream and picks up as soon as it is back."
                  : "Start a migratable workload and it appears here with its owner, epoch and step position. Migrating it moves the authority to the other worker."}
              </p>
              <pre>{`go run ./cmd/stateshift --role=all \\
  --db=mem --blob=fs --blob-dir=.run/blob --llm=mock`}</pre>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button className="btn primary" onClick={() => setSheetOpen(true)}>
                  <GlyphPlus />
                  Start a job
                </button>
                <button className="btn" onClick={() => location.reload()}>
                  Reload
                </button>
              </div>
            </div>
          </div>
        </div>
        <Footer
          phases={PHASES.map(() => "todo")}
          caption="no handover recorded"
          metrics={null}
        />
        <Composer
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          nodes={nodes}
          onCreate={doCreate}
        />
        <div className="toast" data-show={!!toast}>
          {toast?.msg}
        </div>
      </div>
    );
  }

  /* ── the stage ───────────────────────────────────────────────────────── */
  const blob = shortBlob(snap.labels?.blob ?? "—");
  const migTotal = lastMig ? lastMig.chunks_sent + lastMig.chunks_skipped : 0;

  return (
    <div className="app">
      <TopBar
        theme={theme}
        onTheme={setThemeMode}
        live={liveText}
        liveDot={blink}
        crumb={
          <div className="crumbwrap">
            <select
              className="select"
              value={job.id}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Job"
            >
              {[...jobs]
                .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {shortId(j.id.replace(/^job-/, ""), 10)} · {j.workload} · {j.seq}/{j.total_steps}
                  </option>
                ))}
            </select>
            <span className="sep">/</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
              live handover
            </span>
          </div>
        }
        onNew={() => setSheetOpen(true)}
        action={
          <button className="btn primary" onClick={doMigrate} disabled={!canMigrate}>
            <GlyphSwap />
            {inFlight ? "Migrating…" : peer ? `Migrate → ${peer.id}` : "No peer"}
          </button>
        }
      />

      <main className="stage">
        <Worker
          node={leftNode}
          name={leftId ?? "—"}
          role={inFlight ? "owner" : leftFenced ? "fenced" : "owner"}
          badge={inFlight ? "authoritative" : leftFenced ? "fenced" : "authoritative"}
          seq={leftSeq}
          steps={job.total_steps}
          work={job.workload}
          jobId={job.id}
          epoch={leftFenced ? lastMig?.epoch_from ?? job.epoch : job.epoch}
          tag={
            inFlight
              ? "quiesced · boundary reached"
              : leftFenced
                ? "cannot write · epoch closed"
                : "executing · accepting commits"
          }
          state={
            inFlight
              ? "draining · step boundary reached"
              : leftFenced
                ? "fenced · state handed over"
                : `executing step ${fmtNum(job.seq)}`
          }
          tickFill={leftSeq ?? 0}
        />

        <div className="wire">
          <div className="labeltop">transfer</div>
          <div className="path">
            <div className={`lane a${inFlight ? " flow" : ""}`} />
            <div className="store">
              <div className="h">
                <span className={`dot ${lastMig ? "ok" : ""}`} />
                <span className="nm">{blob}</span>
              </div>
              <div className="m">
                <span>
                  {inFlight
                    ? "receiving checkpoint"
                    : lastMig
                      ? "checkpoint complete"
                      : "idle · no handover"}
                </span>
                <span>{lastMig ? fmtBytes(lastMig.bytes_transferred) : "0 B"}</span>
              </div>
              <div className="cells">
                {Array.from({ length: Math.max(7, migTotal) }).map((_, i) => (
                  <i
                    key={i}
                    className={
                      lastMig && i < lastMig.chunks_sent
                        ? "on"
                        : lastMig && i >= lastMig.chunks_sent && i < migTotal
                          ? "reuse"
                          : ""
                    }
                  />
                ))}
              </div>
              <div className="m">
                <span>chunks</span>
                <span>
                  {lastMig ? `${lastMig.chunks_sent} / ${migTotal}` : "0 / 0"}
                </span>
              </div>
            </div>
            <div className={`lane b${inFlight ? " flow" : ""}`} />
            <div
              className="packet"
              data-show={!!inFlight}
              style={{ top: elapsed < 420 ? "20%" : elapsed < 1200 ? "50%" : "80%" }}
            >
              <b>state @ seq {fmtNum(boundary ?? job.seq)}</b>
              <span>
                {lastMig ? fmtBytes(lastMig.bytes_transferred) : "—"} ·{" "}
                {lastMig ? `${migTotal} chunks` : "checkpoint"}
                <br />
                {job.checksum ? `checksum ${shortId(job.checksum, 8)}` : `epoch ${job.epoch}`}
              </span>
            </div>
          </div>
        </div>

        <Worker
          node={rightNode}
          name={rightId ?? "—"}
          role={rightId === job.owner && !inFlight ? "owner" : "standby"}
          badge={inFlight ? "restoring" : rightId === job.owner ? "authoritative" : "standby"}
          seq={rightSeq}
          steps={job.total_steps}
          work={job.workload}
          jobId={job.id}
          epoch={rightId === job.owner && !inFlight ? job.epoch : null}
          tag={
            inFlight
              ? "loading"
              : rightId === job.owner
                ? "owns authority"
                : "not loaded"
          }
          state={
            inFlight
              ? "restoring state"
              : rightId === job.owner
                ? job.status === "done"
                  ? "completed · all ops committed"
                  : `resumed · executing step ${fmtNum(job.seq)}`
                : "idle · no authority"
          }
          tickFill={rightSeq ?? 0}
          hotTick={rightId === job.owner ? hotTick : null}
          empty={!rightId}
        />
      </main>

      <Footer
        phases={PHASES.map((_, i) =>
          inFlight
            ? i === activePhase
              ? "active"
              : i < activePhase
                ? "done"
                : "todo"
            : phasesDone
              ? "done"
              : lastMig && lastMig.outcome !== "ok"
                ? "failed"
                : "todo",
        )}
        caption={
          lastMig
            ? `${lastMig.from} → ${lastMig.to} · ${lastMig.outcome === "ok" ? "committed" : lastMig.outcome} · epochs ${lastMig.epoch_from}→${lastMig.epoch_to}`
            : "no handover recorded for this job yet"
        }
        metrics={
          <>
            <Metric
              hot
              k="pause"
              v={inFlight ? fmtNum(elapsed) : lastMig ? fmtNum(lastMig.pause_ms) : "0"}
              s={inFlight ? "ms elapsed · in flight" : "ms downtime"}
            />
            <Metric
              k="bytes moved"
              v={lastMig ? fmtNum(lastMig.bytes_transferred) : "0"}
              s={lastMig ? `across ${migTotal} chunks` : "no checkpoint yet"}
            />
            <Metric
              k="chunks"
              v={lastMig ? String(lastMig.chunks_sent) : "0"}
              s={lastMig ? `sent · ${lastMig.chunks_skipped} reused` : "sent · 0 reused"}
            />
            <Metric k="epoch" v={String(job.epoch)} s="single authoritative owner" />
            <Metric
              k="ops committed"
              v={fmtNum(job.ops)}
              s={`${fmtNum(Math.max(0, job.ops - job.seq))} repeated`}
            />
          </>
        }
      />

      <Composer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        nodes={nodes}
        onCreate={doCreate}
      />

      <div className="toast" data-show={!!toast} style={toast?.err ? { color: "var(--bad)" } : undefined}>
        {toast?.msg}
      </div>
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function TopBar({
  crumb,
  live,
  liveDot,
  theme,
  onTheme,
  onNew,
  action,
}: {
  crumb: React.ReactNode;
  live: string;
  liveDot: string;
  theme: "dark" | "light";
  onTheme: (t: "dark" | "light") => void;
  onNew: () => void;
  action?: React.ReactNode;
}) {
  return (
    <header className="top">
      <div className="brand">
        <span className="mark">
          <i />
        </span>
        stateshift
      </div>
      <span className="sep">/</span>
      {crumb}
      <span className="spacer" />
      <div className="live">
        <span className={`dot ${liveDot}`} />
        {live}
      </div>
      {action}
      <button className="btn" onClick={onNew}>
        <GlyphPlus />
        New job
      </button>
      <div className="seg" role="group" aria-label="Theme">
        <button aria-pressed={theme === "light"} onClick={() => onTheme("light")}>
          Light
        </button>
        <button aria-pressed={theme === "dark"} onClick={() => onTheme("dark")}>
          Dark
        </button>
      </div>
    </header>
  );
}

function Worker({
  node,
  name,
  role,
  badge,
  seq,
  steps,
  work,
  jobId,
  epoch,
  tag,
  state,
  tickFill,
  hotTick,
  empty,
}: {
  node: NodeInfo | null;
  name: string;
  role: "owner" | "fenced" | "standby";
  badge: string;
  seq: number | null;
  steps: number;
  work: string;
  jobId: string;
  epoch: number | null;
  tag: string;
  state: string;
  tickFill: number;
  hotTick?: number | null;
  empty?: boolean;
}) {
  const addr = node ? node.addr.replace(/^https?:\/\//, "") : "not registered";
  const fill = steps ? Math.round((tickFill / steps) * TICKS) : 0;
  const badgeCls = role === "owner" ? "on" : role === "fenced" ? "off" : "standby";

  return (
    <section className="node" data-role={empty ? "standby" : role} aria-label={`Worker ${name}`}>
      <span className="edge" />
      <div className="n-head">
        <div style={{ minWidth: 0 }}>
          <div className="n-name">{name}</div>
          <div className="n-addr">{addr}</div>
        </div>
        <span className={`role ${badgeCls}`}>{badge}</span>
      </div>
      <div className="n-body">
        <div className="big">
          <span className="v">{seq === null ? "—" : fmtNum(seq)}</span>
          <span className="u">
            seq
            <br />
            of {fmtNum(steps)}
          </span>
        </div>
        <div className="subline">
          <span
            className={`dot ${
              role === "owner" ? "acc" : role === "fenced" ? "warn" : ""
            }`}
          />
          {state}
        </div>
        <div className="jobrow">
          <b>{shortId(jobId.replace(/^job-/, ""), 10)}</b>
          <span className="tag">{work}</span>
        </div>
        <div className="jobrow">
          <span>epoch</span>
          <b className="mono">{epoch === null ? "—" : epoch}</b>
          <span className="tag">{tag}</span>
        </div>
        <div className="steps">
          {Array.from({ length: TICKS }).map((_, i) => (
            <i
              key={i}
              className={hotTick === i && role === "owner" ? "hot" : i < fill ? "on" : ""}
            />
          ))}
        </div>
        <div className="steps-lbl">
          <span>0</span>
          <span>{seq === null ? "—" : `${fmtNum(seq)} committed`}</span>
          <span>{fmtNum(steps)}</span>
        </div>
      </div>
    </section>
  );
}

function Footer({
  phases,
  caption,
  metrics,
}: {
  phases: string[];
  caption: string;
  metrics: React.ReactNode;
}) {
  return (
    <footer className="bottom">
      <div className="phases">
        {PHASES.map((p, i) => (
          <div className="ph" key={p} data-state={phases[i] ?? "todo"}>
            <span className="k">
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              {p}
            </span>
          </div>
        ))}
      </div>
      <div className="caption">
        <span>{caption}</span>
      </div>
      {metrics ? <div className="metrics">{metrics}</div> : null}
    </footer>
  );
}

function Metric({
  k,
  v,
  s,
  hot,
}: {
  k: string;
  v: string;
  s: string;
  hot?: boolean;
}) {
  return (
    <div className={`m${hot ? " hot" : ""}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="s">{s}</div>
    </div>
  );
}

/** "fs://D:\...\blob" → "fs · local"; "spaces://bucket" → "spaces · bucket". */
function shortBlob(s: string): string {
  if (s.startsWith("fs://")) return "fs · local";
  if (s.startsWith("spaces://")) return `spaces · ${s.slice(9).split("/")[0]}`;
  return s.replace(/^https?:\/\//, "").slice(0, 26);
}
