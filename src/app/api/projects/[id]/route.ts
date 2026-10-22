import { z } from "zod";
import { db } from "@/server/db/client";
import { api, readJson } from "@/server/http/api";
import { deleteProject, getOwnedProject } from "@/server/services/projects";
import { serializeProject } from "@/server/services/serialize";
import { ProjectCategory } from "@/lib/schemas/project";
import { audit } from "@/server/audit";
import { siteUrl, unpublishProject } from "@/server/publish/publish";
import { previewUrlFor } from "@/server/build/urls";
import { ensureDeckEngineCurrent } from "@/server/deck/upgrade";

type P = { id: string };

export const GET = api<P>(async ({ user, params }) => {
  const owned = await getOwnedProject(user.id, params.id);
  const p = (await ensureDeckEngineCurrent(owned.id)) ? await getOwnedProject(user.id, owned.id) : owned;
  const [fileCount, lastBuild, deployment] = await Promise.all([
    db.projectFile.count({ where: { projectId: p.id } }),
    p.lastBuildId ? db.build.findUnique({ where: { id: p.lastBuildId } }) : null,
    db.deployment.findFirst({ where: { projectId: p.id, status: { in: ["ready", "building", "failed"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    project: { ...serializeProject(p), fileCount },
    spec: p.spec,
    lastBuild: lastBuild
      ? {
          buildId: lastBuild.id,
          status: lastBuild.status,
          errors: lastBuild.errors ?? [],
          warnings: lastBuild.warnings ?? [],
          durationMs: lastBuild.durationMs,
          previewUrl: lastBuild.status === "succeeded" ? previewUrlFor(lastBuild.id) : null,
          createdAt: lastBuild.createdAt,
        }
      : null,
    deployment: deployment ? { id: deployment.id, status: deployment.status, url: siteUrl(deployment), provider: deployment.provider, isPublic: deployment.isPublic, error: deployment.error, updatedAt: deployment.updatedAt } : null,
  };
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  category: ProjectCategory.optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const PATCH = api<P>(async ({ req, user, params, ip }) => {
  await getOwnedProject(user.id, params.id);
  const body = await readJson(req, Patch, 8192);
  const p = await db.project.update({ where: { id: params.id }, data: body });
  if (body.status) await audit(user.id, body.status === "archived" ? "project.archive" : "project.unarchive", { type: "project", id: p.id }, undefined, ip);
  return { project: serializeProject(p) };
});

export const DELETE = api<P>(async ({ user, params, ip }) => {
  await getOwnedProject(user.id, params.id);
  await unpublishProject(params.id).catch(() => 0);
  await deleteProject(user.id, params.id);
  await audit(user.id, "project.delete", { type: "project", id: params.id }, undefined, ip);
  return { ok: true };
});
