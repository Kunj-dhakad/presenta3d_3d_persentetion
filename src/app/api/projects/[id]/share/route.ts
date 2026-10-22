import { z } from "zod";
import { db } from "@/server/db/client";
import { api, readJson } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { createShareLink } from "@/server/services/share";
import { audit } from "@/server/audit";

type P = { id: string };

export const GET = api<P>(async ({ user, params }) => {
  await getOwnedProject(user.id, params.id);
  const links = await db.shareLink.findMany({ where: { projectId: params.id }, orderBy: { createdAt: "desc" } });
  return {
    links: links.map((l) => ({
      id: l.id,
      tokenPrefix: l.tokenPrefix,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      active: !l.revokedAt && (!l.expiresAt || l.expiresAt.getTime() > Date.now()),
    })),
  };
});

const Body = z.object({ expiresInDays: z.number().int().min(1).max(365).nullable().default(30) });

/** Create a read-only share link. The full token is returned only in this response. */
export const POST = api<P>(async ({ req, user, params, ip }) => {
  await getOwnedProject(user.id, params.id);
  const body = await readJson(req, Body, 1024);
  const { link, token } = await createShareLink(params.id, user.id, body.expiresInDays);
  await audit(user.id, "share.create", { type: "project", id: params.id }, { linkId: link.id, expiresInDays: body.expiresInDays }, ip);
  return { link: { id: link.id, expiresAt: link.expiresAt }, path: `/share/${token}` };
});
