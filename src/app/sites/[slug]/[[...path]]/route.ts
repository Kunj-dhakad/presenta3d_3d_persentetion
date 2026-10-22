import { db } from "@/server/db/client";
import { storage } from "@/server/storage/storage";
import { serveStoredFile } from "@/server/http/static";

/** Locally published sites. Untrusted generated code, so the CSP sandbox applies here too. */
export async function GET(_req: Request, ctx: RouteContext<"/sites/[slug]/[[...path]]">) {
  const { slug, path } = await ctx.params;
  if (!/^[a-z0-9-]{3,64}$/.test(slug)) return new Response("Not found", { status: 404 });
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
  return serveStoredFile(prefix, path ?? [], { untrusted: true, fallbackIndex: true });
}
