import { api } from "@/server/http/api";
import { duplicateProject } from "@/server/services/projects";
import { serializeProject } from "@/server/services/serialize";
import { audit } from "@/server/audit";

export const POST = api<{ id: string }>(async ({ user, params, ip }) => {
  const p = await duplicateProject(user.id, params.id);
  await audit(user.id, "project.duplicate", { type: "project", id: p.id }, { from: params.id }, ip);
  return { project: serializeProject(p) };
});
