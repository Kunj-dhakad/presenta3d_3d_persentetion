import { db } from "@/server/db/client";
import { storage } from "@/server/storage/storage";
import { serveStoredFile } from "@/server/http/static";
import { deckAccess } from "@/server/services/deck-access";

/**
 * Locally published sites. Untrusted generated code, so the CSP sandbox applies here too.
 * A password-protected presentation is served only under /sites/<slug>/_access/<token>/, with a
 * token the PHP app gave the visitor who entered the password (src/server/services/deck-access.ts).
 */
export async function GET(_req: Request, ctx: RouteContext<"/sites/[slug]/[[...path]]">) {
  const { slug } = await ctx.params;
  let path = (await ctx.params).path ?? [];
  if (!/^[a-z0-9-]{3,64}$/.test(slug)) return new Response("Not found", { status: 404 });
  let token: string | null = null;
  if (path[0] === "_access") {
    token = path[1] ?? "";
    path = path.slice(2);
  }
  const access = await deckAccess(slug, token);
  if (access === "denied") {
    return new Response("This presentation is password protected. Open it from its link and enter the password.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }
  const pointer = await storage().get(`sites/${slug}/current.json`);
  let prefix: string;
  if (pointer) {
    try {
      const { version } = JSON.parse(Buffer.from(pointer).toString("utf8")) as { version?: string };
      if (!version || !/^[a-f0-9]{24}$/.test(version)) return new Response("Not found", { status: 404 });
      prefix = `sites/${slug}/${version}`;
    } catch {
      return new Response("Not found", { status: 404 });
    }
  } else {
    // Support local deployments created before site artifacts moved to object storage.
    const previous = await db.deployment.findFirst({
      where: { slug, provider: "local", status: "ready" },
      orderBy: { updatedAt: "desc" },
      select: { externalId: true },
    });
    if (!previous) return new Response("Not found", { status: 404 });
    prefix = previous.externalId && /^[a-f0-9]{24}$/.test(previous.externalId)
      ? `sites/${slug}/${previous.externalId}`
      : `sites/${slug}`;
  }
  const res = await serveStoredFile(prefix, path, { untrusted: true, fallbackIndex: true });
  if (access === "allowed") {
    res.headers.set("Cache-Control", "private, no-store");
    res.headers.set("X-Robots-Tag", "noindex");
  }
  return res;
}
