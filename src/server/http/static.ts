import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  glsl: "text/plain; charset=utf-8",
  vert: "text/plain; charset=utf-8",
  frag: "text/plain; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
};

export function contentTypeFor(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

/**
 * Content-Security-Policy for untrusted generated documents. `sandbox` without
 * `allow-same-origin` gives the document an opaque origin even when opened
 * directly in a tab, so it cannot read this app's cookies, storage or
 * credentialed API responses. Network access is limited to this server's
 * preview files and runtime (connect-src 'self'), plus images/media/fonts.
 */
export const UNTRUSTED_DOCUMENT_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads",
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Resolve `segments` under `root`, refusing traversal. Returns null for invalid paths. */
export function safeJoin(root: string, segments: string[]): string | null {
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes("\\") || s.includes("\0"))) return null;
  const abs = path.resolve(root, ...segments);
  if (!abs.startsWith(path.resolve(root) + path.sep)) return null;
  return abs;
}

export async function serveFile(
  root: string,
  segments: string[],
  opts: { untrusted: boolean; immutable?: boolean; fallbackIndex?: boolean },
): Promise<Response> {
  let rel = segments.length ? segments : ["index.html"];
  let abs = safeJoin(root, rel);
  if (!abs) return new Response("Bad path", { status: 400 });
  let stat = await fs.stat(/*turbopackIgnore: true*/ abs).catch(() => null);
  if (stat?.isDirectory()) {
    rel = [...rel, "index.html"];
    abs = safeJoin(root, rel);
    stat = abs ? await fs.stat(/*turbopackIgnore: true*/ abs).catch(() => null) : null;
  }
  if ((!stat || !stat.isFile()) && opts.fallbackIndex && !/\.[a-z0-9]+$/i.test(rel[rel.length - 1] ?? "")) {
    // SPA fallback for client-side routes in published sites.
    rel = ["index.html"];
    abs = safeJoin(root, rel);
    stat = abs ? await fs.stat(/*turbopackIgnore: true*/ abs).catch(() => null) : null;
  }
  if (!abs || !stat || !stat.isFile()) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  const body = await fs.readFile(/*turbopackIgnore: true*/ abs);
  const headers = new Headers({
    "Content-Type": contentTypeFor(abs),
    "X-Content-Type-Options": "nosniff",
    // Module scripts from an opaque-origin document are CORS requests; these files hold no user secrets.
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": opts.immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "Referrer-Policy": "no-referrer",
  });
  if (opts.untrusted) {
    headers.set("Content-Security-Policy", UNTRUSTED_DOCUMENT_CSP);
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), payment=()");
  }
  return new Response(new Uint8Array(body), { status: 200, headers });
}
