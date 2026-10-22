import { z } from "zod";
import { db } from "@/server/db/client";
import { api, readJson } from "@/server/http/api";
import { getOwnedCanvas, snapshotCanvas } from "@/server/services/canvas";
import type { Prisma } from "@/generated/mysql-prisma/client";

type P = { id: string };

export const GET = api<P>(async ({ user, params }) => {
  await getOwnedCanvas(user.id, params.id);
  const versions = await db.canvasVersion.findMany({ where: { canvasId: params.id }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, label: true, revision: true, createdAt: true } });
  return { versions };
});

const Body = z.object({ label: z.string().trim().min(1).max(80) });

/** Named version of the currently saved document. */
export const POST = api<P>(async ({ req, user, params }) => {
  const c = await getOwnedCanvas(user.id, params.id);
  const { label } = await readJson(req, Body, 1024);
  const v = await snapshotCanvas(c.id, c.data as Prisma.InputJsonValue, c.revision, label);
  return { versionId: v?.id ?? null };
});
