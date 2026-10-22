import { serveFile } from "@/server/http/static";
import { runtimeDir } from "@/server/build/builder";

/** Serves the allowlisted vendor runtime (React, three.js, …) bundled from this app's node_modules. */
export async function GET(_req: Request, ctx: RouteContext<"/preview-runtime/[hash]/[...path]">) {
  const { hash, path } = await ctx.params;
  if (!/^[a-f0-9]{16}$/.test(hash)) return new Response("Not found", { status: 404 });
  return serveFile(runtimeDir(hash), path, { untrusted: true, immutable: true });
}
