import { api } from "@/server/http/api";
import { startDeferredJob } from "@/server/jobs/deferred";
import { getOwnedJob } from "@/server/services/jobs";

/**
 * Execute a queued generation job inside this request. Holding the request
 * open keeps a serverless instance (AWS Amplify / Lambda) alive until the
 * job finishes; the client follows progress through /poll meanwhile.
 * If the job is already running or finished, this returns immediately.
 */
export const POST = api<{ id: string }>(async ({ user, params }) => {
  const job = await getOwnedJob(user.id, params.id);
  const run = await startDeferredJob(job);
  if (!run) return { started: false, status: job.status };
  await run.done;
  const after = await getOwnedJob(user.id, params.id);
  return { started: true, status: after.status };
});
