import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { SESSION_COOKIE, userFromToken, type SessionUser } from "@/server/auth/session";
import { localModeUser } from "@/server/auth/local-user";
import { rateLimit } from "./rate-limit";
import { authMode, env } from "@/server/env";
import { PathError } from "@/lib/vfs/paths";

import { HttpError, badRequest } from "./errors";
export { HttpError, notFound, badRequest } from "./errors";

type Ctx<P> = { req: Request; user: SessionUser; params: P; requestId: string; ip: string };
type PublicCtx<P> = Omit<Ctx<P>, "user"> & { user: SessionUser | null };

type Options = {
  /** Require a signed-in user (default true). */
  auth?: boolean;
  /** Per-user (or per-IP) limit within one minute. */
  rateLimit?: { bucket: string; perMinute: number | (() => number) };
};

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local").slice(0, 64);
}

/**
 * CSRF defence for state-changing requests: the browser-supplied Origin (or
 * Sec-Fetch-Site) must show the request came from this app. Sandboxed preview
 * documents have an opaque "null" origin and are therefore rejected too.
 */
export function checkOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (origin) {
    if (origin === "null") return false;
    const allowed = new Set<string>();
    const host = req.headers.get("host");
    if (host) {
      allowed.add(`http://${host}`);
      allowed.add(`https://${host}`);
    }
    const appOrigin = env().APP_ORIGIN;
    if (appOrigin) allowed.add(appOrigin.replace(/\/$/, ""));
    return allowed.has(origin);
  }
  if (site) return site === "same-origin" || site === "none";
  // Non-browser clients (curl, tests) send neither header; they cannot carry a victim's cookies.
  return true;
}

function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: { message: err.message, code: err.code, details: err.details ?? null }, requestId }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return Response.json(
      { error: { message: "Invalid request", code: "VALIDATION", details: err.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) }, requestId },
      { status: 400 },
    );
  }
  if (err instanceof PathError) {
    return Response.json({ error: { message: err.message, code: err.code }, requestId }, { status: 400 });
  }
  // Unknown errors: log server-side without request bodies, return a generic message.
  console.error(`[api ${requestId}]`, err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");
  return Response.json({ error: { message: "Internal server error", code: "INTERNAL" }, requestId }, { status: 500 });
}

async function resolveUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  if (authMode() === "local") return localModeUser();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

export function api<P = Record<string, never>>(
  handler: (ctx: Ctx<P>) => Promise<Response | unknown>,
  opts?: Options & { auth?: true },
): (req: Request, routeCtx: { params: Promise<P> }) => Promise<Response>;
export function api<P = Record<string, never>>(
  handler: (ctx: PublicCtx<P>) => Promise<Response | unknown>,
  opts: Options & { auth: false },
): (req: Request, routeCtx: { params: Promise<P> }) => Promise<Response>;
export function api<P>(handler: (ctx: Ctx<P>) => Promise<Response | unknown>, opts: Options = {}) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    // API responses are always request-time (never prerendered at build).
    await connection();
    const requestId = randomUUID();
    try {
      if (!checkOrigin(req)) throw new HttpError(403, "Cross-origin request rejected", "CSRF");
      const user = await resolveUser();
      if (opts.auth !== false && !user) throw new HttpError(401, "Sign in required", "UNAUTHENTICATED");
      const ip = clientIp(req);
      if (opts.rateLimit) {
        const key = `${opts.rateLimit.bucket}:${user?.id ?? ip}`;
        const per = typeof opts.rateLimit.perMinute === "function" ? opts.rateLimit.perMinute() : opts.rateLimit.perMinute;
        const r = rateLimit(key, per, 60_000);
        if (!r.ok) {
          return Response.json(
            { error: { message: "Too many requests, please slow down", code: "RATE_LIMITED" }, requestId },
            { status: 429, headers: { "Retry-After": String(Math.ceil(r.retryAfterMs / 1000)) } },
          );
        }
      }
      const params = (routeCtx?.params ? await routeCtx.params : {}) as P;
      const result = await handler({ req, user: user as SessionUser, params, requestId, ip });
      if (result instanceof Response) {
        result.headers.set("X-Request-Id", requestId);
        return result;
      }
      return Response.json(result ?? { ok: true }, { headers: { "X-Request-Id": requestId, "Cache-Control": "no-store" } });
    } catch (err) {
      unstable_rethrow(err); // let Next.js internal control-flow errors propagate
      return errorResponse(err, requestId);
    }
  };
}

const DEFAULT_MAX_BODY = 1024 * 1024;

/** Read and validate a JSON body with a hard size limit. */
export async function readJson<T extends z.ZodType>(req: Request, schema: T, maxBytes = DEFAULT_MAX_BODY): Promise<z.infer<T>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, `Request body larger than ${Math.round(maxBytes / 1024)} KB`, "PAYLOAD_TOO_LARGE");
  const reader = req.body?.getReader();
  if (!reader) throw badRequest("Missing request body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, `Request body larger than ${Math.round(maxBytes / 1024)} KB`, "PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("Body must be valid JSON");
  }
  return schema.parse(json);
}
