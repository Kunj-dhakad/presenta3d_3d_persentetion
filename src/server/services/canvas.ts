import "server-only";
import { db } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import type { Prisma } from "@/generated/prisma/client";

export async function getOwnedCanvas(userId: string, id: string) {
  const c = await db.canvasDocument.findFirst({ where: { id, ownerId: userId } });
  if (!c) throw notFound("Canvas");
  return c;
}

/** Bounded automatic version history; named versions are kept. */
export async function snapshotCanvas(canvasId: string, data: Prisma.InputJsonValue, revision: number, label: string | null) {
  const last = await db.canvasVersion.findFirst({ where: { canvasId }, orderBy: { createdAt: "desc" }, select: { data: true, createdAt: true } });
  // Autosave snapshots at most every 2 minutes and only when content changed.
  if (!label && last && Date.now() - last.createdAt.getTime() < 120_000) return null;
  if (!label && last && JSON.stringify(last.data) === JSON.stringify(data)) return null;
  const v = await db.canvasVersion.create({ data: { canvasId, data, revision, label } });
  const old = await db.canvasVersion.findMany({ where: { canvasId, label: null }, orderBy: { createdAt: "desc" }, skip: 50, select: { id: true } });
  if (old.length) await db.canvasVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return v;
}

/**
 * Save with optimistic concurrency: succeeds only if `revision` is the stored
 * revision, then increments it. Returns the new revision, or null on conflict.
 */
export async function saveCanvas(userId: string, id: string, data: Prisma.InputJsonValue, revision: number): Promise<number | null> {
  const updated = await db.canvasDocument.updateMany({ where: { id, ownerId: userId, revision }, data: { data, revision: { increment: 1 } } });
  if (updated.count === 0) return null;
  await snapshotCanvas(id, data, revision + 1, null);
  return revision + 1;
}
