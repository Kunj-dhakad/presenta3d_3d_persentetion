"use client";

import type { JobEvent, JobStatus } from "./jobs";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: unknown,
  ) {
    super(message);
  }
}

/**
 * The PHP app's access token (from INIT_DATA, see src/components/embed/embed-gate.tsx).
 * There is no login here: every API request carries it.
 */
let accessToken = "";
export function setAccessToken(token: string) {
  accessToken = token;
}
function authHeaders(): Record<string, string> {
  return accessToken ? { "x-access-token": accessToken } : {};
}

/** JSON fetch against this app's API with consistent error handling. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...authHeaders(), ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Network error: could not reach the server", 0, "NETWORK", null);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? "ERROR", err?.details ?? null);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "VALIDATION" && Array.isArray(err.details) && err.details.length) {
      const d = err.details[0] as { path?: string; message?: string };
      return `${err.message}: ${d.path ? `${d.path} — ` : ""}${d.message ?? ""}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

/**
 * Follow a server-side job until it ends, delivering each event once.
 *
 * Works on any host, including serverless ones that cut long requests off
 * (AWS Amplify): the job runs in steps of under a minute, each one inside a
 * `POST /run` request; when a step ends with `continue`, the next one is
 * requested at once, and a step that was cut off is taken over by a later
 * request. Short `GET /poll?after=N` requests fetch new events meanwhile
 * (from memory on the running instance, otherwise from the database).
 */
export async function streamJob(jobId: string, onEvent: (e: JobEvent) => void, signal?: AbortSignal): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let running = false;
  let finished = false;
  let nextKickAt = 0;
  const kick = () => {
    running = true;
    // Long request: it lasts as long as one step. Not tied to `signal`: leaving the page must not stop
    // a step half-way. Requesting a step twice is harmless (only one request can hold the job's lease).
    void fetch(`/api/jobs/${jobId}/run`, { method: "POST", credentials: "same-origin", headers: authHeaders() })
      .then((r) => (r.ok ? (r.json() as Promise<{ started: boolean; continue: boolean }>) : null))
      .then(
        (r) => {
          running = false;
          // The step saved a checkpoint: run the next one now. Otherwise another request holds the job
          // (or this one was cut off): check again shortly; a stopped step is taken over after its lease expires.
          if (r?.continue && !finished) kick();
          else nextKickAt = Date.now() + 3000;
        },
        () => {
          running = false;
          nextKickAt = Date.now() + 2000;
        },
      );
  };
  kick();

  let seen = 0;
  let failures = 0;
  for (;;) {
    if (signal?.aborted) return;
    let data: { events: JobEvent[]; total: number; status: string; error: string | null; done: boolean };
    try {
      data = await api(`/api/jobs/${jobId}/poll?after=${seen}`, { signal });
      failures = 0;
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
      if (++failures > 8) throw new ApiError("Lost connection to the job", 0, "STREAM", null);
      await sleep(Math.min(4000, 500 * failures));
      continue;
    }
    // The server's list may be shorter than what we have seen if it was trimmed; never replay.
    if (data.total < seen) seen = data.total;
    for (const e of data.events) {
      seen++;
      onEvent(e);
    }
    if (data.done) {
      finished = true;
      const last = data.events.at(-1);
      if (!(last?.type === "status" && last.status === data.status)) {
        onEvent({ type: "status", status: data.status as JobStatus, message: data.error ?? undefined, t: Date.now() });
      }
      onEvent({ type: "end", t: Date.now() } as JobEvent);
      return;
    }
    // No step running from this page (cut off, lost, or another request held the job): request the next one.
    if (!running && Date.now() >= nextKickAt) kick();
    await sleep(700);
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}
