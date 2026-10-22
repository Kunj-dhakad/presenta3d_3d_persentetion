import "server-only";
import { db } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import { reconcileOrphanedJob } from "@/server/jobs/runner";
import type { GenerationJob } from "@/generated/prisma/client";

export async function getOwnedJob(userId: string, id: string) {
  const job = await db.generationJob.findFirst({ where: { id, userId } });
  if (!job) throw notFound("Job");
  const r = await reconcileOrphanedJob(job);
  return r.status !== job.status ? ((await db.generationJob.findUnique({ where: { id } })) as GenerationJob) : job;
}

export function serializeJob(j: GenerationJob) {
  return {
    id: j.id,
    kind: j.kind,
    status: j.status,
    provider: j.provider,
    model: j.model,
    progress: j.progress,
    error: j.error,
    projectId: j.projectId,
    input: j.input,
    // Media outputs expose only non-sensitive fields (no storage keys).
    output: j.output && typeof j.output === "object" && "storageKey" in (j.output as object) ? { mimeType: (j.output as { mimeType: string }).mimeType, size: (j.output as { size: number }).size, url: `/api/jobs/${j.id}/output` } : j.output,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}
