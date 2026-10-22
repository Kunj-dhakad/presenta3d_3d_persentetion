import { z } from "zod";
import { api, readJson, badRequest } from "@/server/http/api";
import { getFiles, getOwnedProject, getVersion, restoreVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { audit } from "@/server/audit";
import { assertProjectPath } from "@/lib/vfs/paths";

type P = { id: string; versionId: string };

const Body = z.object({
  /** Restore only these files from the version (individual file revert). Omit to restore the whole project. */
  paths: z.array(z.string().max(200)).max(200).optional(),
});

export const POST = api<P>(async ({ req, user, params, ip }) => {
  await getOwnedProject(user.id, params.id);
  const body = await readJson(req, Body, 64 * 1024);
  if (!body.paths) {
    const r = await restoreVersion(params.id, params.versionId);
    await audit(user.id, "project.restore", { type: "project", id: params.id }, { versionId: params.versionId }, ip);
    return { files: r.files, versionId: r.versionId };
  }
  const version = await getVersion(params.id, params.versionId);
  const current = new Map((await getFiles(params.id)).map((f) => [f.path, f.content]));
  const fromVersion = new Map(version.files.map((f) => [f.path, f.content]));
  await snapshot(params.id, "auto", { summary: "Before file revert" });
  for (const raw of body.paths) {
    const path = assertProjectPath(raw);
    if (fromVersion.has(path)) current.set(path, fromVersion.get(path)!);
    else if (current.has(path)) current.delete(path); // file did not exist in that version
    else throw badRequest(`${path} exists in neither version`);
  }
  const files = [...current.entries()].map(([path, content]) => ({ path, content }));
  await writeFileSet(params.id, files);
  const v = await snapshot(params.id, "restore", { summary: `Reverted ${body.paths.length} file(s)`, files });
  await audit(user.id, "project.revert_files", { type: "project", id: params.id }, { versionId: params.versionId, count: body.paths.length }, ip);
  return { files, versionId: v.id };
});
