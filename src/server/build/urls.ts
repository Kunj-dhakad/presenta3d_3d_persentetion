import "server-only";
import { env } from "@/server/env";

/**
 * Preview URLs. When PREVIEW_ORIGIN is configured (recommended in production),
 * previews are linked on that separate origin; otherwise they are served by
 * this server under /preview with a CSP sandbox that forces an opaque origin.
 */
export function previewUrlFor(buildId: string, file = "index.html"): string {
  const origin = env().PREVIEW_ORIGIN?.replace(/\/$/, "") ?? "";
  return `${origin}/preview/${buildId}/${file}`;
}
