import { api } from "@/server/http/api";
import { localJobEvents } from "@/server/jobs/runner";
import { getOwnedJob } from "@/server/services/jobs";
import type { JobEvent } from "@/lib/jobs";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Short-poll a job's events: `?after=N` returns events from index N on.
 * Works on any host (no long-lived streaming response needed). Events come
 * from memory when the job runs in this instance, otherwise from the
 * database, where the runner saves them about once a second.
 */
export const GET = api<{ id: string }>(async ({ req, user, params }) => {
  const after = Math.max(0, Number.parseInt(new URL(req.url).searchParams.get("after") ?? "0", 10) || 0);
  const local = localJobEvents(params.id);
  const job = await getOwnedJob(user.id, params.id);
  const events = local ? local.events : ((job.events as JobEvent[] | null) ?? []);
  const done = local ? local.done : TERMINAL.has(job.status);
  return {
    events: events.slice(after),
    total: events.length,
    status: local && !local.done && TERMINAL.has(job.status) ? "running" : job.status,
    error: job.error,
    done,
  };
});
