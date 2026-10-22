import { z } from "zod";
import { db } from "@/server/db/client";
import { api, readJson } from "@/server/http/api";
import { getOwnedProject, snapshot } from "@/server/services/projects";

type P = { id: string };

export const GET = api<P>(async ({ user, params }) => {
  const p = await getOwnedProject(user.id, params.id);
  const versions = await db.projectVersion.findMany({
    where: { projectId: p.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, kind: true, label: true, summary: true, fileCount: true, isWorking: true, createdAt: true, digest: true },
  });
  return { versions: versions.map((v) => ({ ...v, isLastWorking: v.id === p.lastWorkingVersionId })) };
});

const Post = z.object({ label: z.string().trim().min(1).max(80) });

/** Create a named checkpoint of the current files. */
export const POST = api<P>(async ({ req, user, params }) => {
  await getOwnedProject(user.id, params.id);
  const { label } = await readJson(req, Post, 2048);
  const v = await snapshot(params.id, "checkpoint", { label, summary: "Named checkpoint" });
  return { versionId: v.id };
});
