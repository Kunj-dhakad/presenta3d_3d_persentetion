import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { db } from "@/server/db/client";
import { authMode, env, sessionSecret } from "@/server/env";
import { localModeUser } from "./local-user";
export { localModeUser };

export const SESSION_COOKIE = "deck3d_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; email: string; name: string };

export function hashToken(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export async function createSession(userId: string, userAgent: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), userAgent: userAgent?.slice(0, 200) ?? null, expiresAt } });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function userFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

/** Current user for Server Components and Route Handlers. In local mode every request is the local user. */
export async function currentUser(): Promise<SessionUser | null> {
  // Session validity depends on the current time: always resolve at request time, never in a prefetch prerender.
  await connection();
  const jar = await cookies();
  if (authMode() === "local") return localModeUser();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
