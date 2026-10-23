import "server-only";
import { db } from "@/server/db/client";
import type { Prisma } from "@/generated/mysql-prisma/client";
import type { JobEvent, JobEventBody } from "@/lib/jobs";

/**
 * Server-side job processing for long-running work (generation pipelines,
 * media generation). Jobs run detached from the HTTP request that created
 * them: closing the browser does not cancel a job, and clients can re-attach
 * to its event stream. Events are persisted to GenerationJob.events.
 *
 * Serverless hosts (AWS Amplify compute, Lambda) freeze an instance as soon
 * as its response is sent, so work started "in the background" never
 * finishes there. Generation jobs therefore use `createDeferredJob`: the
 * POST only records the job, and the first request for its event stream
 * claims it (atomically, so exactly one instance runs it) and executes it
 * while that streaming response is open. Other instances follow the job
 * through its persisted events.
 */

type Listener = (e: JobEvent) => void;

type Handle = {
  id: string;
  events: JobEvent[];
  listeners: Set<Listener>;
  controller: AbortController;
  done: boolean;
  progress: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
};

export type JobContext = {
  jobId: string;
  signal: AbortSignal;
  emit: (e: JobEventBody) => void;
  progress: (p: number) => void;
};

const g = globalThis as unknown as { __deck3dJobs?: Map<string, Handle>; __deck3dQueue?: (() => void)[]; __deck3dActive?: { n: number } };
const handles = (g.__deck3dJobs ??= new Map<string, Handle>());
const queue = (g.__deck3dQueue ??= []);
const active = (g.__deck3dActive ??= { n: 0 });
const MAX_ACTIVE_JOBS = 4;

async function flush(h: Handle, extra: Prisma.GenerationJobUpdateInput = {}) {
  if (h.flushTimer) {
    clearTimeout(h.flushTimer);
    h.flushTimer = null;
  }
  await db.generationJob
    .update({ where: { id: h.id }, data: { events: h.events.slice(-500) as unknown as Prisma.InputJsonValue, progress: h.progress, ...extra } })
    .catch(() => {});
}

function scheduleFlush(h: Handle) {
  if (h.flushTimer) return;
  h.flushTimer = setTimeout(() => void flush(h), 800);
}

type JobInput = { id?: string; userId: string; projectId?: string | null; kind: string; provider: string; model?: string | null; input: Prisma.InputJsonValue };

/** A job that has not reported progress for this long, and is not running in this process, is treated as dead. */
const STALE_MS = 2 * 60_000;
const HEARTBEAT_MS = 10_000;

function createJobRow(input: JobInput) {
  return db.generationJob.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
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
}

/** Run `work` for an existing job row in this process. Returns the run function (not yet started). */
function prepare<T>(jobId: string, work: (ctx: JobContext) => Promise<T>, opts: { claimed?: boolean } = {}) {
  const h: Handle = { id: jobId, events: [], listeners: new Set(), controller: new AbortController(), done: false, progress: 0, flushTimer: null };
  handles.set(jobId, h);

  const emit = (e: JobEventBody) => {
    const ev = { ...e, t: Date.now() } as JobEvent;
    h.events.push(ev);
    for (const l of h.listeners) l(ev);
    scheduleFlush(h);
  };

  const run = async () => {
    active.n++;
    // Keeps updatedAt fresh during long silent phases (model reasoning) so other instances do not consider the job dead.
    // It also notices a cancel requested through another instance (status no longer "running").
    const heartbeat = setInterval(() => {
      void db.generationJob
        .updateMany({ where: { id: h.id, status: "running" }, data: { updatedAt: new Date() } })
        .then((r) => {
          if (r.count === 0 && !h.done) h.controller.abort();
        })
        .catch(() => {});
    }, HEARTBEAT_MS);
    // A claimed job was already marked running by the claim itself.
    if (!opts.claimed) await db.generationJob.update({ where: { id: h.id }, data: { status: "running", startedAt: new Date() } }).catch(() => {});
    emit({ type: "status", status: "running" });
    try {
      if (h.controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      const output = await work({
        jobId: h.id,
        signal: h.controller.signal,
        emit,
        progress: (p) => {
          h.progress = Math.max(0, Math.min(1, p));
          emit({ type: "progress", progress: h.progress }); // persisted with the next (batched) flush
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
      clearInterval(heartbeat);
      h.done = true;
      for (const l of h.listeners) l({ type: "end", t: Date.now() } as JobEvent);
      h.listeners.clear();
      active.n--;
      queue.shift()?.();
      // Keep the finished handle briefly so late subscribers get the in-memory stream.
      setTimeout(() => handles.delete(h.id), 5 * 60_000).unref?.();
    }
  };
  return { h, emit, run };
}

/** Start a job that runs detached in this process (long-lived servers only). */
export async function startJob<T>(input: JobInput, work: (ctx: JobContext) => Promise<T>): Promise<string> {
  const job = await createJobRow(input);
  const { emit, run } = prepare(job.id, work);
  if (active.n < MAX_ACTIVE_JOBS) void run();
  else {
    emit({ type: "log", level: "info", message: "Queued behind other jobs" });
    queue.push(() => void run());
  }
  return job.id;
}

/**
 * Record a job without running it. It is executed by whichever request first
 * opens its event stream (see `claimJob`), which keeps a serverless instance
 * alive for the whole run.
 */
export async function createDeferredJob(input: JobInput): Promise<string> {
  const job = await createJobRow(input);
  return job.id;
}

/**
 * Atomically claim a queued job and start running it in this process.
 * Returns `{ done }` (settles when the job finishes), or null if another request/instance already claimed it.
 */
export async function claimJob<T>(jobId: string, work: (ctx: JobContext) => Promise<T>): Promise<{ done: Promise<void> } | null> {
  if (handles.has(jobId)) return null;
  const claimed = await db.generationJob.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "running", startedAt: new Date() } });
  if (claimed.count !== 1) return null;
  const { run } = prepare(jobId, work, { claimed: true });
  return { done: run() };
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

export async function cancelJob(jobId: string): Promise<boolean> {
  const h = handles.get(jobId);
  if (h && !h.done) {
    h.controller.abort();
    return true;
  }
  // Running on another instance: its heartbeat sees the status change and aborts.
  const r = await db.generationJob.updateMany({
    where: { id: jobId, status: { in: ["queued", "running"] } },
    data: { status: "cancelled", error: "Cancelled", finishedAt: new Date() },
  });
  return r.count > 0;
}

/** Events of a job running (or recently finished) in this process, or null. */
export function localJobEvents(jobId: string): { events: JobEvent[]; done: boolean } | null {
  const h = handles.get(jobId);
  return h ? { events: h.events, done: h.done } : null;
}

export function isJobLive(jobId: string): boolean {
  const h = handles.get(jobId);
  return Boolean(h && !h.done);
}

/**
 * A job that is unfinished in the database, not running in this process, and
 * silent for STALE_MS was interrupted (server restart, serverless timeout or
 * the instance was frozen); mark it failed. Jobs running on another instance
 * keep updatedAt fresh through the heartbeat and are left alone.
 */
export async function reconcileOrphanedJob<J extends { id: string; status: string; updatedAt?: Date }>(job: J): Promise<J> {
  if ((job.status === "running" || job.status === "queued") && !handles.has(job.id)) {
    const updatedAt = job.updatedAt ?? (await db.generationJob.findUnique({ where: { id: job.id }, select: { updatedAt: true } }))?.updatedAt;
    if (updatedAt && Date.now() - updatedAt.getTime() < STALE_MS) return job;
    const error = "Interrupted: the server stopped while this job was running. Please try again.";
    const r = await db.generationJob.updateMany({
      where: { id: job.id, status: job.status, updatedAt: updatedAt ?? undefined },
      data: { status: "failed", error, finishedAt: new Date() },
    });
    if (r.count) return { ...job, status: "failed", error };
  }
  return job;
}

export async function activeProjectJob(projectId: string) {
  const running = await db.generationJob.findFirst({
    where: { projectId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, updatedAt: true },
  });
  if (!running) return null;
  const r = await reconcileOrphanedJob(running);
  return r.status === "failed" ? null : running;
}
