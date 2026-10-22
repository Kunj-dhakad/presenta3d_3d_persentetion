import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db/client";

/**
 * Read-only share links. The token is shown once at creation; only its
 * SHA-256 hash is stored, so a database leak does not reveal working links.
 */
export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createShareLink(projectId: string, userId: string, expiresInDays: number | null) {
  const token = randomBytes(24).toString("base64url");
  const link = await db.shareLink.create({
    data: {
      projectId,
      createdById: userId,
      tokenHash: hashShareToken(token),
      tokenPrefix: token.slice(0, 6),
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    },
  });
  return { link, token };
}

/** Resolve a share token to its project, or null if unknown, revoked or expired. */
export async function resolveShareToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const link = await db.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) }, include: { project: true } });
  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;
  return link;
}
