import { db } from "@/server/db/client";
import { api, notFound } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { audit } from "@/server/audit";

/** Revoke a share link. Revoked links stop working immediately. */
export const DELETE = api<{ id: string; linkId: string }>(async ({ user, params, ip }) => {
  await getOwnedProject(user.id, params.id);
  const link = await db.shareLink.findFirst({ where: { id: params.linkId, projectId: params.id } });
  if (!link) throw notFound("Share link");
  await db.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
  await audit(user.id, "share.revoke", { type: "project", id: params.id }, { linkId: link.id }, ip);
  return { ok: true };
});
