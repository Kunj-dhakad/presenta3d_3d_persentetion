import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { getFiles, getOwnedProject, snapshot, writeFileSet } from "@/server/services/projects";
import { ProjectFileSchema } from "@/lib/schemas/project";
import { VFS_LIMITS } from "@/lib/vfs/paths";

type P = { id: string };

export const GET = api<P>(async ({ user, params }) => {
  await getOwnedProject(user.id, params.id);
  return { files: await getFiles(params.id) };
});

const Put = z.object({
  files: z.array(ProjectFileSchema).max(VFS_LIMITS.maxFiles),
  /** Create an automatic snapshot after saving (debounced client-side; skipped if unchanged). */
  snapshot: z.boolean().default(false),
});

/** Save the full file set (editor save/autosave, create, rename, delete). Paths are validated server-side. */
export const PUT = api<P>(async ({ req, user, params }) => {
  await getOwnedProject(user.id, params.id);
  const body = await readJson(req, Put, VFS_LIMITS.maxProjectBytes + 512 * 1024);
  await writeFileSet(params.id, body.files);
  const version = body.snapshot ? await snapshot(params.id, "auto", { summary: "Editor changes" }) : null;
  return { ok: true, versionId: version?.id ?? null };
});
