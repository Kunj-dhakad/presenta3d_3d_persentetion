import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import type { Prisma } from "@/generated/mysql-prisma/client";
import type { JobEvent, JobEventBody } from "@/lib/jobs";


type Listener = (e: JobEvent) => void;

type Handle = {
  id: string;
  /** Lease token for a job run in steps (see claimJob); its writes only apply while it holds the lease. */
  lease: string | null;
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
  /**
   * Time (ms epoch) by which a step of a job run in steps should stop and return CONTINUE
   * (see claimJob). Infinity for jobs that run to the end in one go.
   */
  deadline: number;
  /**
   * Throws (as a cancellation) if another step has taken this job over, e.g. after this instance was
   * frozen past its lease. Call before writing project data. A no-op for jobs that are not leased.
   */
  ensureLease: () => Promise<void>;
  emit: (e: JobEventBody) => void;
  progress: (p: number) => void;
};

const g = globalThis as unknown as { __deck3dJobs?: Map<string, Handle>; __deck3dQueue?: (() => void)[]; __deck3dActive?: { n: number } };
const handles = (g.__deck3dJobs ??= new Map<string, Handle>());
const queue = (g.__deck3dQueue ??= []);
const active = (g.__deck3dActive ??= { n: 0 });
const MAX_ACTIVE_JOBS = 4;

/** Returned by the work of a job run in steps when it saved a checkpoint and has more to do. */
export const CONTINUE = Symbol("continue-job");

/** Only the lease holder may write a leased job; a frozen instance that wakes up later cannot. */
const owned = (h: Handle) => (h.lease ? { id: h.id, externalId: h.lease } : { id: h.id });

async function flush(h: Handle, extra: Prisma.GenerationJobUpdateInput = {}): Promise<boolean> {
  if (h.flushTimer) {
    clearTimeout(h.flushTimer);
    h.flushTimer = null;
  }
  return db.generationJob
    .updateMany({ where: owned(h), data: { events: h.events.slice(-500) as unknown as Prisma.InputJsonValue, progress: h.progress, ...extra } })
    .then(
      (r) => r.count > 0,
      () => false,
    );
}

function scheduleFlush(h: Handle) {
  if (h.flushTimer) return;
  h.flushTimer = setTimeout(() => void flush(h), 800);
}

/** Persist a job's final state (with its final status event), then deliver that event to listeners. */
async function settle(h: Handle, event: JobEventBody, data: Prisma.GenerationJobUpdateInput) {
  const ev = { ...event, t: Date.now() } as JobEvent;
  const events = [...h.events, ev];
  const save = () =>
    db.generationJob
      .updateMany({ where: owned(h), data: { ...data, events: events.slice(-500) as unknown as Prisma.InputJsonValue, progress: h.progress } })
      .then(
        (r) => r.count > 0,
        () => false,
      );
  if (h.flushTimer) {
    clearTimeout(h.flushTimer);
    h.flushTimer = null;
  }
  if (!(await save())) {
    await new Promise((r) => setTimeout(r, 500));
    await save(); // one retry on a transient database error
  }
  h.events.push(ev);
  for (const l of h.listeners) l(ev);
}

type JobInput = { id?: string; userId: string; projectId?: string | null; kind: string; provider: string; model?: string | null; input: Prisma.InputJsonValue };

/**
 * A running job refreshes updatedAt every HEARTBEAT_MS, even during long silent model calls.
 *
 * Jobs run in steps (claimJob) hold a lease while a step runs. A lease silent for LEASE_STALE_MS
 * belongs to a step that was stopped (serverless request cut off and its instance frozen, server
 * restart); the next step request takes the job over and resumes it from its checkpoint.
 *
 * A job nobody has worked on for STALE_MS (no step running and none requested, e.g. the browser was
 * closed for a while) is given up and marked failed.
 */
const HEARTBEAT_MS = 10_000;
const LEASE_STALE_MS = 30_000;
const STALE_MS = 3 * 60_000;

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

type Prepared = {
  claimed?: boolean;
  lease?: string;
  /** Events and progress saved by the previous steps of this job. */
  events?: JobEvent[];
  progress?: number;
  deadline?: number;
};

/** What a run ended with: the job finished (succeeded, failed or cancelled), or a step saved a checkpoint. */
export type RunOutcome = "finished" | "continue";

/** Run `work` for an existing job row in this process. Returns the run function (not yet started). */
function prepare<T>(jobId: string, work: (ctx: JobContext) => Promise<T | typeof CONTINUE>, opts: Prepared = {}) {
  const h: Handle = { id: jobId, lease: opts.lease ?? null, events: [...(opts.events ?? [])], listeners: new Set(), controller: new AbortController(), done: false, progress: opts.progress ?? 0, flushTimer: null };
  handles.set(jobId, h);
  let leaseLost = false;

  const emit = (e: JobEventBody) => {
    const ev = { ...e, t: Date.now() } as JobEvent;
    h.events.push(ev);
    for (const l of h.listeners) l(ev);
    scheduleFlush(h);
  };

  const run = async (): Promise<RunOutcome> => {
    active.n++;
    // Keeps updatedAt fresh during long silent phases (model reasoning) so other instances do not consider the job dead.
    // It also notices a cancel requested through another instance (status no longer "running"),
    // and a lease taken over by another step after this instance was frozen.
    const heartbeat = setInterval(() => {
      void db.generationJob
        .updateMany({ where: { ...owned(h), status: "running" }, data: { updatedAt: new Date() } })
        .then((r) => {
          if (r.count === 0 && !h.done) {
            leaseLost = Boolean(h.lease);
            h.controller.abort();
          }
        })
        .catch(() => {});
    }, HEARTBEAT_MS);
    // A claimed job was already marked running by the claim itself.
    if (!opts.claimed) await db.generationJob.update({ where: { id: h.id }, data: { status: "running", startedAt: new Date() } }).catch(() => {});
    // Announced once, by the first step.
    if (!h.events.length) emit({ type: "status", status: "running" });
    let outcome: RunOutcome = "finished";
    try {
      if (h.controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      const output = await work({
        jobId: h.id,
        signal: h.controller.signal,
        deadline: opts.deadline ?? Infinity,
        ensureLease: async () => {
          if (!h.lease) return;
          const mine = await db.generationJob.count({ where: { ...owned(h), status: "running" } });
          if (mine === 0) {
            leaseLost = true;
            h.controller.abort();
          }
          if (h.controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
        },
        emit,
        progress: (p) => {
          h.progress = Math.max(0, Math.min(1, p));
          emit({ type: "progress", progress: h.progress }); // persisted with the next (batched) flush
        },
      });
      if (output === CONTINUE) {
        // Checkpoint saved: save the events and release the lease so the next step can take the job at once.
        outcome = "continue";
        await flush(h, h.lease ? { externalId: null } : {});
        return outcome;
      }
      // The final status is saved before it is announced: a client that sees "succeeded" may send the
      // next prompt at once, and that request must not find this job still "running" in the database.
      // Clears any "interrupted" mark another request may have set while this job was slow.
      await settle(h, { type: "status", status: "succeeded" }, { status: "succeeded", progress: 1, error: null, output: (output ?? null) as Prisma.InputJsonValue, finishedAt: new Date() });
    } catch (err) {
      // Another step owns the job now (this instance was frozen past its lease): leave it alone.
      if (leaseLost) {
        outcome = "continue";
        return outcome;
      }
      const cancelled = h.controller.signal.aborted;
      const message = cancelled ? "Cancelled" : err instanceof Error ? err.message : "Job failed";
      const status = cancelled ? "cancelled" : "failed";
      await settle(h, { type: "status", status, message }, { status, error: message.slice(0, 2000), finishedAt: new Date() });
    } finally {
      clearInterval(heartbeat);
      h.done = true;
      for (const l of h.listeners) l({ type: "end", t: Date.now() } as JobEvent);
      h.listeners.clear();
      active.n--;
      queue.shift()?.();
      // An unfinished job is followed through the database until its next step runs (anywhere).
      if (outcome === "continue") {
        if (h.flushTimer) clearTimeout(h.flushTimer);
        if (handles.get(h.id) === h) handles.delete(h.id);
      }
      // Keep the finished handle briefly so late subscribers get the in-memory stream.
      else setTimeout(() => handles.get(h.id) === h && handles.delete(h.id), 5 * 60_000).unref?.();
    }
    return outcome;
  };
  return { h, emit, run };
}

/** Start a job that runs detached in this process (long-lived servers only). */
export async function startJob<T>(input: JobInput, work: (ctx: JobContext) => Promise<T | typeof CONTINUE>): Promise<string> {
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
 * Record a job without running it. It is executed in steps by the requests
 * that claim it (see `claimJob`).
 */
export async function createDeferredJob(input: JobInput): Promise<string> {
  const job = await createJobRow(input);
  return job.id;
}

/**
 * Serverless hosts (AWS Amplify compute) cut a request off after about a
 * minute and freeze its instance, so a job may not depend on one long request.
 * Deferred jobs therefore run in steps: each request that claims the job holds
 * a lease and works until `ctx.deadline` (JOB_STEP_BUDGET_MS, 45 s by default),
 * saves a checkpoint and returns CONTINUE; the client then requests the next step at once.
 *
 * Atomically take a queued job, a job between steps, or a job whose step was
 * stopped (lease silent for LEASE_STALE_MS), and run its next step here.
 * Returns `{ done }` (settles when the step ends), or null if a step is already running.
 */
export async function claimJob<T>(
  jobId: string,
  work: (ctx: JobContext) => Promise<T | typeof CONTINUE>,
  opts: { budgetMs?: number } = {},
): Promise<{ done: Promise<RunOutcome> } | null> {
  // The lease in the database decides who runs the job (even within this process: a step whose
  // database writes hung past its lease may be taken over here).
  const lease = `lease:${randomUUID()}`;
  const now = new Date();
  const first = await db.generationJob.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "running", startedAt: now, externalId: lease, updatedAt: now } });
  const claimed =
    first.count === 1 ||
    (
      await db.generationJob.updateMany({
        where: { id: jobId, status: "running", OR: [{ externalId: null }, { updatedAt: { lt: new Date(now.getTime() - LEASE_STALE_MS) } }] },
        data: { externalId: lease, updatedAt: now },
      })
    ).count === 1;
  if (!claimed) return null;
  const row = await db.generationJob.findUnique({ where: { id: jobId }, select: { events: true, progress: true } });
  const { run } = prepare(jobId, work, {
    claimed: true,
    lease,
    events: (row?.events as JobEvent[] | null) ?? [],
    progress: row?.progress ?? 0,
    deadline: now.getTime() + (opts.budgetMs ?? env().JOB_STEP_BUDGET_MS),
  });
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

/** The project's unfinished generation job, if one is really still running. */
export async function activeProjectJob(projectId: string) {
  const unfinished = await db.generationJob.findMany({
    where: { projectId, status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, status: true, updatedAt: true },
  });
  for (const job of unfinished) {
    // Finished in this process, but its final database write failed: not running.
    if (handles.get(job.id)?.done) continue;
    const r = await reconcileOrphanedJob(job);
    if (r.status !== "failed") return job;
  }
  return null;
}
