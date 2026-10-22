import { api } from "@/server/http/api";
import { subscribe } from "@/server/jobs/runner";
import { getOwnedJob } from "@/server/services/jobs";
import type { JobEvent } from "@/lib/jobs";

/**
 * NDJSON stream of a job's events: full history first, then live events until
 * the job ends. If the job is no longer in memory (finished long ago or the
 * server restarted), the persisted history and final status are returned.
 */
export const GET = api<{ id: string }>(async ({ req, user, params }) => {
  const job = await getOwnedJob(user.id, params.id);
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
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
      unsubscribe = subscribe(job.id, (e) => {
        send(e);
        if (e.type === "end") close();
      });
      if (!unsubscribe) {
        for (const e of (job.events as JobEvent[] | null) ?? []) send(e);
        send({ type: "status", status: job.status, message: job.error ?? undefined, t: Date.now() });
        send({ type: "end", t: Date.now() });
        close();
        return;
      }
      heartbeat = setInterval(() => send({ type: "heartbeat", t: Date.now() }), 15_000);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
});
