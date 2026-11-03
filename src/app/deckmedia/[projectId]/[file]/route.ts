import { serveStoredFile } from "@/server/http/static";

/**
 * Slide images of cinematic presentations (deckmedia/<projectId>/<random>.<ext>,
 * written by server/deck/cine-images.ts). Public like the presentations that
 * show them; names are random and never change, so they are cached for good.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string; file: string }> }) {
  const { projectId, file } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(projectId) || !/^[A-Za-z0-9_-]{8,64}\.(?:webp|png|jpe?g)$/.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  return serveStoredFile(`deckmedia/${projectId}`, [file], { untrusted: false, immutable: true });
}
