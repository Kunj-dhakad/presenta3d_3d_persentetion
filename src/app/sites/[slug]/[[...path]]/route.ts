import { serveFile } from "@/server/http/static";
import { siteDir } from "@/server/publish/publish";

/** Locally published sites. Untrusted generated code, so the CSP sandbox applies here too. */
export async function GET(_req: Request, ctx: RouteContext<"/sites/[slug]/[[...path]]">) {
  const { slug, path } = await ctx.params;
  let root: string;
  try {
    root = siteDir(slug);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return serveFile(root, path ?? [], { untrusted: true, fallbackIndex: true });
}
