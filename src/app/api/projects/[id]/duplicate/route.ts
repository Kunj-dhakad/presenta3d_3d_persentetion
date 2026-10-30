import { api } from "@/server/http/api";
import { duplicateProject, getFiles, markWorkingVersion, snapshot } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { serializeProject } from "@/server/services/serialize";
import { audit } from "@/server/audit";
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
      }
    }
    return { project: serializeProject(p) };
  },
  { rateLimit: { bucket: "build", perMinute: 30 } },
);
