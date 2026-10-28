import { api } from "@/server/http/api";
import { startDeferredJob } from "@/server/jobs/deferred";
import { getOwnedJob } from "@/server/services/jobs";

/**
 * Run the next step of a generation job inside this request. A step lasts at
 * most about 45 seconds (serverless hosts such as AWS Amplify cut longer
 * requests off and freeze the instance); it saves a checkpoint and returns
 * `continue: true`, and the client requests the next step at once. The client
 * follows progress through /poll meanwhile.
 * If a step is already running (or the job has finished), this returns immediately.
 */
export const maxDuration = 60;

export const POST = api<{ id: string }>(async ({ user, params }) => {
  const job = await getOwnedJob(user.id, params.id);
  const run = await startDeferredJob(job);
  if (!run) return { started: false, continue: false, status: job.status };
  const outcome = await run.done;
  return { started: true, continue: outcome === "continue", status: outcome === "continue" ? "running" : (await getOwnedJob(user.id, params.id)).status };
});
