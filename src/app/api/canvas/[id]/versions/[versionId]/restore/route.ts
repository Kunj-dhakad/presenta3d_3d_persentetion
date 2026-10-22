import { db } from "@/server/db/client";
import { api, notFound } from "@/server/http/api";
import { getOwnedCanvas, snapshotCanvas } from "@/server/services/canvas";
import type { Prisma } from "@/generated/prisma/client";

/** Restore a canvas version. The current document is kept as a named version first. */
export const POST = api<{ id: string; versionId: string }>(async ({ user, params }) => {
  const c = await getOwnedCanvas(user.id, params.id);
  const v = await db.canvasVersion.findFirst({ where: { id: params.versionId, canvasId: c.id } });
  if (!v) throw notFound("Version");
  await snapshotCanvas(c.id, c.data as Prisma.InputJsonValue, c.revision, "Before restore");
  const updated = await db.canvasDocument.update({ where: { id: c.id }, data: { data: v.data as Prisma.InputJsonValue, revision: { increment: 1 } } });
  return { data: updated.data, revision: updated.revision };
});
