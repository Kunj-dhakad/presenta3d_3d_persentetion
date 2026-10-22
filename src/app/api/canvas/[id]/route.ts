import { z } from "zod";
import { db } from "@/server/db/client";
import { api, HttpError, readJson } from "@/server/http/api";
import { CanvasDocSchema } from "@/lib/schemas/canvas";
import { getOwnedCanvas, saveCanvas } from "@/server/services/canvas";

type P = { id: string };

export const GET = api<P>(async ({ user, params }) => {
  const c = await getOwnedCanvas(user.id, params.id);
  return { canvas: { id: c.id, name: c.name, data: c.data, revision: c.revision, updatedAt: c.updatedAt } };
});

const Put = z.object({ data: CanvasDocSchema, revision: z.number().int().min(0) });

/**
 * Save the document with optimistic concurrency: the client sends the revision
 * it edited; a stale revision (e.g. another tab saved first) returns 409.
 */
export const PUT = api<P>(async ({ req, user, params }) => {
  await getOwnedCanvas(user.id, params.id);
  const body = await readJson(req, Put, 4 * 1024 * 1024);
  const revision = await saveCanvas(user.id, params.id, body.data, body.revision);
  if (revision === null) {
    const current = await getOwnedCanvas(user.id, params.id);
    throw new HttpError(409, "This canvas was changed elsewhere. Reload to get the latest version.", "REVISION_CONFLICT", { revision: current.revision });
  }
  return { revision };
});

const Patch = z.object({ name: z.string().trim().min(1).max(120) });

export const PATCH = api<P>(async ({ req, user, params }) => {
  await getOwnedCanvas(user.id, params.id);
  const { name } = await readJson(req, Patch, 1024);
  await db.canvasDocument.update({ where: { id: params.id }, data: { name } });
  return { ok: true };
});

export const DELETE = api<P>(async ({ user, params }) => {
  await getOwnedCanvas(user.id, params.id);
  await db.canvasDocument.delete({ where: { id: params.id } });
  return { ok: true };
});
