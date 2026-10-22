import { db } from "@/server/db/client";

let n = 0;
export async function createUser(name = "Test") {
  return db.user.create({ data: { email: `u${Date.now()}-${n++}@test.local`, name, passwordHash: "x" } });
}

/** Wait for a server-side job to reach a terminal state. */
export async function waitForJob(jobId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`job ${jobId} still ${job.status}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
