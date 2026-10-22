import { serveFile } from "@/server/http/static";
import { previewBuildDir } from "@/server/build/builder";

/**
 * Serves generated project builds. Build ids are 144-bit random capability
 * tokens; every response carries the untrusted-document CSP sandbox.
 */
export async function GET(_req: Request, ctx: RouteContext<"/preview/[buildId]/[[...path]]">) {
  const { buildId, path } = await ctx.params;
  let root: string;
  try {
    root = previewBuildDir(buildId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return serveFile(root, path ?? [], { untrusted: true });
}
