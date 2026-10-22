import { z } from "zod";
import { db } from "@/server/db/client";
import { api, HttpError, readJson } from "@/server/http/api";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";

const Body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) });

// A real hash used to keep timing similar when the email is unknown.
let decoyHash: Promise<string> | null = null;

export const POST = api(
  async ({ req, ip }) => {
    const body = await readJson(req, Body, 4096);
    const user = await db.user.findUnique({ where: { email: body.email } });
    decoyHash ??= hashPassword("decoy-password-for-timing");
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await decoyHash));
    if (!user || !ok) {
      await audit(user?.id ?? null, "auth.login_failed", undefined, undefined, ip);
      throw new HttpError(401, "Incorrect email or password", "INVALID_CREDENTIALS");
    }
    const s = await createSession(user.id, req.headers.get("user-agent"));
    await setSessionCookie(s.token, s.expiresAt);
    await audit(user.id, "auth.login", { type: "user", id: user.id }, undefined, ip);
    return { user: { id: user.id, email: user.email, name: user.name } };
  },
  { auth: false, rateLimit: { bucket: "auth", perMinute: 10 } },
);
