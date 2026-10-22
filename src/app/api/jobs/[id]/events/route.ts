import { api } from "@/server/http/api";
import { db } from "@/server/db/client";
import { reconcileOrphanedJob, subscribe } from "@/server/jobs/runner";
import { startDeferredJob } from "@/server/jobs/deferred";
import { getOwnedJob } from "@/server/services/jobs";
import type { JobEvent } from "@/lib/jobs";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const POLL_MS = 1000;

/**
 * NDJSON stream of a job's events: full history first, then live events until
 * the job ends.
 *
 * - A queued deferred job is claimed and executed by this request, so the
 *   work lives exactly as long as this streaming response (serverless-safe).
 * - A job running in this process streams live from memory.
 * - A job running on another instance is followed through its persisted
 *   events in the database.
 */
export const GET = api<{ id: string }>(async ({ req, user, params }) => {
  const job = await getOwnedJob(user.id, params.id);
  const run = await startDeferredJob(job);
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (e: JobEvent | Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          close();
        }
      };
      heartbeat = setInterval(() => send({ type: "heartbeat", t: Date.now() }), 15_000);
      req.signal.addEventListener("abort", close);

      unsubscribe = subscribe(job.id, (e) => {
        send(e);
        if (e.type === "end") close();
      });
      if (unsubscribe) {
        // Keep this request (and a serverless instance) alive until the job it runs has finished.
        if (run) void run.done.finally(close);
        return;
      }

      // Not running here: replay persisted events and poll until the job finishes elsewhere.
      void (async () => {
        let sent = 0;
        let current: { status: string; error: string | null; events: unknown; updatedAt: Date } | null = job;
        while (!closed && current) {
          const events = (current.events as JobEvent[] | null) ?? [];
          for (; sent < events.length; sent++) send(events[sent]);
          if (TERMINAL.has(current.status)) break;
          await new Promise((r) => setTimeout(r, POLL_MS));
          current = await db.generationJob.findUnique({ where: { id: job.id }, select: { id: true, status: true, error: true, events: true, updatedAt: true } });
          if (current) current = await reconcileOrphanedJob({ ...current, id: job.id });
        }
        if (current && !closed) {
          const last = ((current.events as JobEvent[] | null) ?? []).at(-1);
          if (!(last?.type === "status" && last.status === current.status)) send({ type: "status", status: current.status, message: current.error ?? undefined, t: Date.now() });
        }
        send({ type: "end", t: Date.now() });
        close();
      })().catch(close);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
});
