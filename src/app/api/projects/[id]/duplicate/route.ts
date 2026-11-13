import { api } from "@/server/http/api";
import { duplicateProject, getFiles, markWorkingVersion, snapshot } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { serializeProject } from "@/server/services/serialize";
import { audit } from "@/server/audit";
import { db } from "@/server/db/client";
import { storage } from "@/server/storage/storage";
import type { Framework } from "@/lib/schemas/project";

export const POST = api<{ id: string }>(
  async ({ user, params, ip }) => {
    const p = await duplicateProject(user.id, params.id);
    await audit(user.id, "project.duplicate", { type: "project", id: p.id }, { from: params.id }, ip);
    // Build the copy at once, so it can be presented and published like the original.
    const files = await getFiles(p.id);
    if (files.length) {
      const build = await buildProject({ projectId: p.id, framework: p.framework as Framework, files });
      if (build.status === "succeeded") {
        const v = await snapshot(p.id, "auto", { summary: "Copy", files });
        await markWorkingVersion(p.id, v.id);
        // The listing shows deckmedia/<project>/thumb-<build>.jpg, which the editor makes when a build
        // is first shown. A copy has the same first slide, so it takes the original's picture now
        // (it showed the placeholder until it was opened in the editor).
        try {
          const src = await db.project.findUnique({ where: { id: params.id }, select: { lastWorkingBuildId: true } });
          const thumb = src?.lastWorkingBuildId ? await storage().get(`deckmedia/${params.id}/thumb-${src.lastWorkingBuildId}.jpg`) : null;
          if (thumb) await storage().put(`deckmedia/${p.id}/thumb-${build.buildId}.jpg`, thumb, "image/jpeg");
        } catch {
          // No picture is not a failed copy: the editor makes one when the copy is opened.
        }
      }
    }
    return { project: serializeProject(p) };
  },
  { rateLimit: { bucket: "build", perMinute: 30 } },
);
