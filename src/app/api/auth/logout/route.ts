import { cookies } from "next/headers";
import { api } from "@/server/http/api";
import { SESSION_COOKIE, clearSessionCookie, destroySession } from "@/server/auth/session";
import { audit } from "@/server/audit";

export const POST = api(
  async ({ user, ip }) => {
    const jar = await cookies();
    await destroySession(jar.get(SESSION_COOKIE)?.value);
    await clearSessionCookie();
    if (user) await audit(user.id, "auth.logout", { type: "user", id: user.id }, undefined, ip);
    return { ok: true };
  },
  { auth: false },
);
