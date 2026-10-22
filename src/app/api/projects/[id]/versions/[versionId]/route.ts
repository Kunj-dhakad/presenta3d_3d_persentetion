import { api } from "@/server/http/api";
import { getOwnedProject, getVersion } from "@/server/services/projects";

/** Full file contents of one version (for compare / diff views). */
export const GET = api<{ id: string; versionId: string }>(async ({ user, params }) => {
  await getOwnedProject(user.id, params.id);
  const v = await getVersion(params.id, params.versionId);
  return { version: { id: v.id, kind: v.kind, label: v.label, summary: v.summary, createdAt: v.createdAt, isWorking: v.isWorking, files: v.files } };
});
