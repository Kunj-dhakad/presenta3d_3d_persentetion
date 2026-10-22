import { z } from "zod";
import { db } from "@/server/db/client";
import { api, readJson } from "@/server/http/api";
import { createProject } from "@/server/services/projects";
import { serializeProject } from "@/server/services/serialize";
import { SCENE_TEMPLATES } from "@/lib/scene/templates";
import { emptyScene, validateScene } from "@/lib/schemas/scene";

export const GET = api(async ({ user }) => {
  const projects = await db.project.findMany({ where: { ownerId: user.id, category: "scene3d", status: "active" }, orderBy: { updatedAt: "desc" }, take: 200 });
  return { scenes: projects.filter((p) => p.sceneSpec !== null).map(serializeProject) };
});

const Body = z.object({ name: z.string().trim().max(120).optional(), template: z.string().max(60).optional(), scene: z.unknown().optional() });

export const POST = api(async ({ req, user }) => {
  const body = await readJson(req, Body, 512 * 1024);
  const tpl = SCENE_TEMPLATES.find((t) => t.id === body.template);
  const candidate = body.scene ?? (tpl ? tpl.build() : emptyScene(body.name || "Untitled scene"));
  const v = validateScene(candidate);
  if (!v.ok) return Response.json({ error: { message: "Invalid scene", code: "INVALID_SCENE", details: v.errors } }, { status: 400 });
  const project = await createProject(user.id, {
    name: body.name || v.scene.title,
    description: v.scene.description,
    category: "scene3d",
    framework: "three",
    sceneSpec: v.scene,
  });
  return { scene: serializeProject(project) };
});
