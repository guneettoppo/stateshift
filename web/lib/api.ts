import type { CreateJobPayload } from "./types";

export interface ApiResult {
  ok: boolean;
  error?: string;
}

async function postJSON(url: string, body: unknown): Promise<ApiResult> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data.error || `request failed (${r.status})` };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e ?? "network error"),
    };
  }
}

export function createJob(p: CreateJobPayload): Promise<ApiResult> {
  const body: Record<string, unknown> = { workload: p.workload, steps: p.steps };
  if (p.prompt?.trim()) body.prompt = p.prompt.trim();
  if (p.node?.trim()) body.node = p.node.trim();
  return postJSON("/api/jobs", body);
}

export function migrateJob(jobId: string, target: string): Promise<ApiResult> {
  return postJSON("/api/migrate", { job_id: jobId, target });
}
