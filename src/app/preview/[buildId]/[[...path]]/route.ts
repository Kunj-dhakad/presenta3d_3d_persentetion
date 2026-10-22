import { serveStoredFile } from "@/server/http/static";

/**
 * Serves generated project builds. Build ids are 144-bit random capability
 * tokens; every response carries the untrusted-document CSP sandbox.
 */
export async function GET(_req: Request, ctx: RouteContext<"/preview/[buildId]/[[...path]]">) {
  const { buildId, path } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(buildId)) return new Response("Not found", { status: 404 });
  return serveStoredFile(`previews/${buildId}`, path ?? [], { untrusted: true });
}
