import { z } from "zod";
import { db } from "@/server/db/client";
import { api, readJson } from "@/server/http/api";
import { emptyCanvas } from "@/lib/schemas/canvas";

export const GET = api(async ({ user }) => {
  const canvases = await db.canvasDocument.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, createdAt: true, updatedAt: true, revision: true },
  });
  return { canvases };
});

const Body = z.object({ name: z.string().trim().min(1).max(120).default("Untitled canvas") });

export const POST = api(async ({ req, user }) => {
  const { name } = await readJson(req, Body, 2048);
  const c = await db.canvasDocument.create({ data: { ownerId: user.id, name, data: emptyCanvas() } });
  return { canvas: { id: c.id, name: c.name, revision: c.revision } };
});
