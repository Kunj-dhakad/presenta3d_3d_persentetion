import { db } from "@/server/db/client";
import { api } from "@/server/http/api";
import { serializeJob } from "@/server/services/jobs";

/** Recent jobs for the current user (notifications, studio history). */
export const GET = api(async ({ req, user }) => {
  const url = new URL(req.url);
  const kinds = url.searchParams.get("kinds")?.split(",").filter(Boolean).slice(0, 12);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 30) || 30, 100);
  const jobs = await db.generationJob.findMany({
    where: { userId: user.id, ...(kinds?.length ? { kind: { in: kinds } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return { jobs: jobs.map(serializeJob) };
});
