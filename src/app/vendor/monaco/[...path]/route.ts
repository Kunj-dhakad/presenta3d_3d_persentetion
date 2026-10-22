import path from "node:path";
import { serveFile } from "@/server/http/static";

/** Self-hosted Monaco editor assets (no CDN dependency). */
const ROOT = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "monaco-editor", "min");

export async function GET(_req: Request, ctx: RouteContext<"/vendor/monaco/[...path]">) {
  const { path: segments } = await ctx.params;
  return serveFile(ROOT, segments, { untrusted: false, immutable: true });
}
