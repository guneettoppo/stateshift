const PALETTE = [
  "#0a84ff",
  "#8e5cf0",
  "#2bb673",
  "#f5a623",
  "#ff453a",
  "#00c7be",
  "#ff2d92",
  "#af52de",
];

/** Deterministic accent for a node id, so A and B stay visually distinct. */
export function nodeHue(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function fmtNum(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-US");
}

export function fmtBytes(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(2)} MB`;
  return `${(v / 1073741824).toFixed(2)} GB`;
}

export function fmtPct(p: number | null | undefined): string {
  return `${Math.round((Math.max(0, Math.min(1, p ?? 0)) || 0) * 100)}%`;
}

export function fmtUptime(s: number | null | undefined): string {
  const t = s ?? 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${Math.floor(t % 60)}s`;
  return `${t}s`;
}

export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function dedupeRate(t: {
  chunks_sent: number;
  chunks_skipped: number;
}): string {
  const total = (t.chunks_sent ?? 0) + (t.chunks_skipped ?? 0);
  if (!total || !t.chunks_skipped) return "—";
  return `${Math.round((t.chunks_skipped / total) * 100)}%`;
}

export function shortId(id: string, n = 14): string {
  if (id.length <= n) return id;
  return `${id.slice(0, n)}…`;
}
