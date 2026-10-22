"use client";

import type { JobEvent } from "./jobs";

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

/** JSON fetch against this app's API with consistent error handling. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
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
 * Follow a server-side job's NDJSON event stream. Resolves when the job ends.
 * Reconnects (replaying history) if the connection drops before the end event.
 */
export async function streamJob(jobId: string, onEvent: (e: JobEvent) => void, signal?: AbortSignal): Promise<void> {
  let attempts = 0;
  let seen = 0;
  for (;;) {
    if (signal?.aborted) return;
    let ended = false;
    try {
      const res = await fetch(`/api/jobs/${jobId}/events`, { signal, credentials: "same-origin" });
      if (!res.ok || !res.body) throw new ApiError(`Could not follow job (${res.status})`, res.status, "STREAM", null);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let index = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let e: JobEvent | { type: "heartbeat" };
          try {
            e = JSON.parse(line);
          } catch {
            continue;
          }
          if (e.type === "heartbeat") continue;
          // On reconnect the server replays history; skip events already delivered.
          if (index++ < seen) continue;
          seen++;
          onEvent(e as JobEvent);
          if (e.type === "end") ended = true;
        }
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
    }
    if (ended) return;
    if (++attempts > 5) throw new ApiError("Lost connection to the job stream", 0, "STREAM", null);
    await new Promise((r) => setTimeout(r, 800 * attempts));
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
