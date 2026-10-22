import { z } from "zod";
import { db } from "@/server/db/client";
import { api, HttpError, readJson } from "@/server/http/api";
import { hashPassword } from "@/server/auth/password";
import { createSession, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export const POST = api(
  async ({ req, ip }) => {
    const body = await readJson(req, Body, 4096);
    const exists = await db.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (exists) throw new HttpError(409, "An account with this email already exists", "EMAIL_TAKEN");
    const user = await db.user.create({ data: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) } });
    const s = await createSession(user.id, req.headers.get("user-agent"));
    await setSessionCookie(s.token, s.expiresAt);
    await audit(user.id, "auth.signup", { type: "user", id: user.id }, undefined, ip);
    return { user: { id: user.id, email: user.email, name: user.name } };
  },
  { auth: false, rateLimit: { bucket: "auth", perMinute: 10 } },
);
