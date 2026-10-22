import { api } from "@/server/http/api";
import { getFiles, getOwnedProject, markWorkingVersion, snapshot } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import type { Framework } from "@/lib/schemas/project";

/** Build the project's current files in the isolated worker and return diagnostics. */
export const POST = api<{ id: string }>(
  async ({ user, params }) => {
    const p = await getOwnedProject(user.id, params.id);
    const files = await getFiles(p.id);
    if (!files.length) return { build: null, message: "Project has no files yet" };
    const build = await buildProject({ projectId: p.id, framework: p.framework as Framework, files });
    if (build.status === "succeeded") {
      const v = await snapshot(p.id, "auto", { summary: "Successful build", files });
      await markWorkingVersion(p.id, v.id);
    }
    return { build };
  },
  { rateLimit: { bucket: "build", perMinute: 30 } },
);
