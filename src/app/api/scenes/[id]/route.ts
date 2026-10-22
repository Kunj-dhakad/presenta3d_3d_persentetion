import { z } from "zod";
import { db } from "@/server/db/client";
import { api, notFound, readJson } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { serializeProject } from "@/server/services/serialize";
import { validateScene } from "@/lib/schemas/scene";

type P = { id: string };

async function getOwnedScene(userId: string, id: string) {
  const p = await getOwnedProject(userId, id);
  if (p.sceneSpec === null) throw notFound("Scene");
  return p;
}

export const GET = api<P>(async ({ user, params }) => {
  const p = await getOwnedScene(user.id, params.id);
  const v = validateScene(p.sceneSpec);
  return { project: serializeProject(p), scene: v.ok ? v.scene : p.sceneSpec, valid: v.ok, errors: v.ok ? [] : v.errors };
});

const Put = z.object({ scene: z.unknown(), name: z.string().trim().min(1).max(120).optional() });

/** Save a scene. Every save is validated against the SceneSpec schema and referential rules. */
export const PUT = api<P>(async ({ req, user, params }) => {
  await getOwnedScene(user.id, params.id);
  const body = await readJson(req, Put, 2 * 1024 * 1024);
  const v = validateScene(body.scene);
  if (!v.ok) return Response.json({ error: { message: "Invalid scene", code: "INVALID_SCENE", details: v.errors } }, { status: 400 });
  const p = await db.project.update({
    where: { id: params.id },
    data: { sceneSpec: v.scene as never, ...(body.name ? { name: body.name } : {}), description: v.scene.description },
  });
  return { project: serializeProject(p) };
});
