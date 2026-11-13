import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/server/db/client";

/**
 * Password-protected presentations. When publishing, the owner chooses in the PHP app (CI_Core)
 * "Public" or "Password protected" (its assets/js/p3-access.js). PHP keeps the choice in
 * p3d_presentation_access and, when a visitor enters the right password, writes an access token to
 * p3d_deck_access (only the token's SHA-256, with an expiry). Its player then loads the deck from
 * /sites/<slug>/_access/<token>/, so the deck's own relative requests (deck.json, main.js, scenes)
 * carry the token too (application/helpers/p3d_helper.php: p3d_source_unlocked).
 *
 * Both tables belong to the PHP app and only exist once it has made them. Times are compared with
 * UTC_TIMESTAMP() on both sides, since the two apps' connections may use different time zones.
 */

export type DeckAccess = "open" | "allowed" | "denied";

const NO_TABLE = /doesn't exist|ER_NO_SUCH_TABLE|\b1146\b/i;
/** Whether a slug is protected, remembered briefly: every file of a deck asks. */
const MEMO_MS = 15_000;
const memo = new Map<string, { projectId: string | null; protected: boolean; at: number }>();

async function protection(slug: string): Promise<{ projectId: string | null; protected: boolean }> {
  const hit = memo.get(slug);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit;
  const dep = await db.deployment.findFirst({ where: { slug }, orderBy: { createdAt: "desc" }, select: { projectId: true } });
  let isProtected = false;
  if (dep) {
    try {
      const rows = await db.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM p3d_presentation_access WHERE project_id = ${dep.projectId} AND mode = 'password' AND password_hash <> ''`;
      isProtected = Number(rows[0]?.n ?? 0) > 0;
    } catch (err) {
      // No table yet: no presentation has been protected.
      if (!NO_TABLE.test(err instanceof Error ? err.message : String(err))) throw err;
    }
  }
  const value = { projectId: dep?.projectId ?? null, protected: isProtected, at: Date.now() };
  if (memo.size > 2000) memo.clear();
  memo.set(slug, value);
  return value;
}

/** "open": not protected; "allowed": protected and the token is valid; "denied": protected, no valid token. */
export async function deckAccess(slug: string, token: string | null): Promise<DeckAccess> {
  const p = await protection(slug);
  if (!p.protected || !p.projectId) return "open";
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return "denied";
  const hash = createHash("sha256").update(token).digest("hex");
  try {
    const rows = await db.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM p3d_deck_access WHERE token_hash = ${hash} AND project_id = ${p.projectId} AND expires_at > UTC_TIMESTAMP()`;
    return Number(rows[0]?.n ?? 0) > 0 ? "allowed" : "denied";
  } catch {
    return "denied";
  }
}
