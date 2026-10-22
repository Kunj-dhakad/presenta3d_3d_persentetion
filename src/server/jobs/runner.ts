import "server-only";
import { db } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import type { JobEvent, JobEventBody } from "@/lib/jobs";

/**
 * Server-side job processing for long-running work (generation pipelines,
 * media generation). Jobs run detached from the HTTP request that created
 * them: closing the browser does not cancel a job, and clients can re-attach
 * to its event stream. Events are persisted to GenerationJob.events.
 *
 * Single-process design: for multiple app instances, move execution to a
 * queue worker (e.g. BullMQ on Redis) behind this same interface.
 */

type Listener = (e: JobEvent) => void;

type Handle = {
  id: string;
  events: JobEvent[];
  listeners: Set<Listener>;
  controller: AbortController;
  done: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
};

export type JobContext = {
  jobId: string;
  signal: AbortSignal;
  emit: (e: JobEventBody) => void;
  progress: (p: number) => void;
};

const g = globalThis as unknown as { __strataJobs?: Map<string, Handle>; __strataQueue?: (() => void)[]; __strataActive?: { n: number } };
const handles = (g.__strataJobs ??= new Map<string, Handle>());
const queue = (g.__strataQueue ??= []);
const active = (g.__strataActive ??= { n: 0 });
const MAX_ACTIVE_JOBS = 4;

async function flush(h: Handle, extra: Prisma.GenerationJobUpdateInput = {}) {
  if (h.flushTimer) {
    clearTimeout(h.flushTimer);
    h.flushTimer = null;
  }
  await db.generationJob
    .update({ where: { id: h.id }, data: { events: h.events.slice(-500) as unknown as Prisma.InputJsonValue, ...extra } })
    .catch(() => {});
}

function scheduleFlush(h: Handle) {
  if (h.flushTimer) return;
  h.flushTimer = setTimeout(() => void flush(h), 800);
}

export async function startJob<T>(
  input: { userId: string; projectId?: string | null; kind: string; provider: string; model?: string | null; input: Prisma.InputJsonValue },
  work: (ctx: JobContext) => Promise<T>,
): Promise<string> {
  const job = await db.generationJob.create({
    data: {
      userId: input.userId,
      projectId: input.projectId ?? null,
      kind: input.kind,
      provider: input.provider,
      model: input.model ?? null,
      input: input.input,
      status: "queued",
      events: [],
    },
  });
  const h: Handle = { id: job.id, events: [], listeners: new Set(), controller: new AbortController(), done: false, flushTimer: null };
  handles.set(job.id, h);

  const emit = (e: JobEventBody) => {
    const ev = { ...e, t: Date.now() } as JobEvent;
    h.events.push(ev);
    for (const l of h.listeners) l(ev);
    scheduleFlush(h);
  };

  const run = async () => {
    active.n++;
    await db.generationJob.update({ where: { id: h.id }, data: { status: "running", startedAt: new Date() } }).catch(() => {});
    emit({ type: "status", status: "running" });
    try {
      if (h.controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      const output = await work({
        jobId: h.id,
        signal: h.controller.signal,
        emit,
        progress: (p) => {
          emit({ type: "progress", progress: Math.max(0, Math.min(1, p)) });
          void db.generationJob.update({ where: { id: h.id }, data: { progress: Math.max(0, Math.min(1, p)) } }).catch(() => {});
        },
      });
      emit({ type: "status", status: "succeeded" });
      await flush(h, { status: "succeeded", progress: 1, output: (output ?? null) as Prisma.InputJsonValue, finishedAt: new Date() });
    } catch (err) {
      const cancelled = h.controller.signal.aborted;
      const message = cancelled ? "Cancelled" : err instanceof Error ? err.message : "Job failed";
      emit({ type: "status", status: cancelled ? "cancelled" : "failed", message });
      await flush(h, { status: cancelled ? "cancelled" : "failed", error: message.slice(0, 2000), finishedAt: new Date() });
    } finally {
      h.done = true;
      for (const l of h.listeners) l({ type: "end", t: Date.now() } as JobEvent);
      h.listeners.clear();
      active.n--;
      queue.shift()?.();
      // Keep the finished handle briefly so late subscribers get the in-memory stream.
      setTimeout(() => handles.delete(h.id), 5 * 60_000).unref?.();
    }
  };

  if (active.n < MAX_ACTIVE_JOBS) void run();
  else {
    emit({ type: "log", level: "info", message: "Queued behind other jobs" });
    queue.push(() => void run());
  }
  return job.id;
}

/** Subscribe to a job's events, replaying history first. Returns an unsubscribe function, or null if not in memory. */
export function subscribe(jobId: string, listener: Listener): (() => void) | null {
  const h = handles.get(jobId);
  if (!h) return null;
  for (const e of h.events) listener(e);
  if (h.done) {
    listener({ type: "end", t: Date.now() } as JobEvent);
    return () => {};
  }
  h.listeners.add(listener);
  return () => h.listeners.delete(listener);
}

export function cancelJob(jobId: string): boolean {
  const h = handles.get(jobId);
  if (!h || h.done) return false;
  h.controller.abort();
  return true;
}

export function isJobLive(jobId: string): boolean {
  const h = handles.get(jobId);
  return Boolean(h && !h.done);
}

/** Jobs left "running" in the database by a previous process can never finish; mark them failed. */
export async function reconcileOrphanedJob(job: { id: string; status: string }) {
  if ((job.status === "running" || job.status === "queued") && !handles.has(job.id)) {
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "failed", error: "Interrupted: the server restarted while this job was running", finishedAt: new Date() },
    });
    return { ...job, status: "failed" };
  }
  return job;
}

export async function activeProjectJob(projectId: string) {
  const running = await db.generationJob.findFirst({
    where: { projectId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (!running) return null;
  const r = await reconcileOrphanedJob(running);
  return r.status === "failed" ? null : running;
}
