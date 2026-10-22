import { z } from "zod";
import { db } from "@/server/db/client";
import { api, readJson } from "@/server/http/api";
import { createProject } from "@/server/services/projects";
import { serializeProject } from "@/server/services/serialize";
import { Framework, ProjectCategory } from "@/lib/schemas/project";
import { EXAMPLE_PROJECTS, starterFiles } from "@/server/examples";
import { audit } from "@/server/audit";
import type { Prisma } from "@/generated/mysql-prisma/client";

export const GET = api(async ({ req, user }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status") === "archived" ? "archived" : "active";
  const kind = url.searchParams.get("kind"); // "code" | "scene" | null
  const where: Prisma.ProjectWhereInput = { ownerId: user.id, status };
  if (q) where.OR = [{ name: { contains: q } }, { description: { contains: q } }];
  if (category && ProjectCategory.safeParse(category).success) where.category = category;
  const projects = await db.project.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200, include: { _count: { select: { files: true } } } });
  const list = projects.map(serializeProject).filter((p) => (kind === "scene" ? p.isScene : kind === "code" ? !p.isScene : true));
  return { projects: list };
});

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120).default("Untitled project"),
  description: z.string().max(2000).optional(),
  category: ProjectCategory.default("website"),
  framework: Framework.default("vanilla"),
  /** "blank" = empty project for AI generation; "starter" = minimal runnable files; or an example id */
  template: z.string().max(60).default("blank"),
});

export const POST = api(async ({ req, user, ip }) => {
  const body = await readJson(req, CreateBody, 8192);
  let input: Parameters<typeof createProject>[1] = { name: body.name, description: body.description, category: body.category, framework: body.framework, files: [] };
  if (body.template === "starter") input.files = starterFiles(body.framework);
  else if (body.template !== "blank") {
    const ex = EXAMPLE_PROJECTS.find((e) => e.id === body.template);
    if (ex) input = { name: ex.name, description: ex.description, category: ex.category, framework: ex.framework, files: ex.files() };
  }
  const project = await createProject(user.id, input);
  await audit(user.id, "project.create", { type: "project", id: project.id }, { template: body.template }, ip);
  return { project: serializeProject(project) };
});
