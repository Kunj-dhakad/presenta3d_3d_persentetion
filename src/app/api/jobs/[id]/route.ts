import { api } from "@/server/http/api";
import { cancelJob } from "@/server/jobs/runner";
import { getOwnedJob, serializeJob } from "@/server/services/jobs";
import { audit } from "@/server/audit";

type P = { id: string };

export const GET = api<P>(async ({ user, params }) => {
  const job = await getOwnedJob(user.id, params.id);
  return { job: serializeJob(job) };
});

/** Cancel a running job. */
export const DELETE = api<P>(async ({ user, params, ip }) => {
  const job = await getOwnedJob(user.id, params.id);
  const cancelled = await cancelJob(job.id);
  if (cancelled) await audit(user.id, "job.cancel", { type: "job", id: job.id }, undefined, ip);
  return { cancelled };
});
