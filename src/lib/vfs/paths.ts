/**
 * Project path rules. Every path that enters the virtual filesystem (from the
 * editor, the AI, an import, or a template) goes through `validateProjectPath`.
 * Paths are relative POSIX paths confined to the project root.
 */

export const VFS_LIMITS = {
  maxPathLength: 200,
  maxDepth: 10,
  maxFileBytes: 256 * 1024,
  maxProjectBytes: 3 * 1024 * 1024,
  maxFiles: 200,
} as const;

export const ALLOWED_EXTENSIONS = [
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "mjs",
  "ts",
  "tsx",
  "json",
  "md",
  "txt",
  "svg",
  "glsl",
  "vert",
  "frag",
  "csv",
  "xml",
  "webmanifest",
] as const;

const RESERVED_SEGMENTS = new Set(["node_modules", ".git", ".env", ".next", "__proto__", "prototype", "constructor"]);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const SEGMENT = /^[A-Za-z0-9_@+\-][A-Za-z0-9_@+.\-]*$/;

export type PathResult = { ok: true; path: string } | { ok: false; error: string };

export function validateProjectPath(input: unknown): PathResult {
  if (typeof input !== "string") return { ok: false, error: "path must be a string" };
  const p = input.trim();
  if (p.length === 0) return { ok: false, error: "path is empty" };
  if (p.length > VFS_LIMITS.maxPathLength) return { ok: false, error: `path longer than ${VFS_LIMITS.maxPathLength} characters` };
  if (/[\u0000-\u001f\u007f]/.test(p)) return { ok: false, error: "path contains control characters" };
  if (p.includes("\\")) return { ok: false, error: "use forward slashes in paths" };
  if (p.startsWith("/")) return { ok: false, error: "path must be relative to the project root" };
  if (/^[a-zA-Z]:/.test(p)) return { ok: false, error: "drive letters are not allowed" };
  if (p.includes("//")) return { ok: false, error: "empty path segment" };
  if (p.endsWith("/")) return { ok: false, error: "path must name a file" };
  const segments = p.split("/");
  if (segments.length > VFS_LIMITS.maxDepth) return { ok: false, error: `path deeper than ${VFS_LIMITS.maxDepth} levels` };
  for (const seg of segments) {
    if (seg === "." || seg === "..") return { ok: false, error: "relative segments (. and ..) are not allowed" };
    if (RESERVED_SEGMENTS.has(seg.toLowerCase())) return { ok: false, error: `"${seg}" is a reserved name` };
    if (WINDOWS_RESERVED.test(seg)) return { ok: false, error: `"${seg}" is a reserved device name` };
    if (!SEGMENT.test(seg)) return { ok: false, error: `invalid characters in "${seg}" (allowed: letters, digits, _ - . @ +)` };
  }
  const last = segments[segments.length - 1];
  const dot = last.lastIndexOf(".");
  const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: `file type ".${ext || "(none)"}" is not supported in projects` };
  }
  return { ok: true, path: p };
}

export function assertProjectPath(input: unknown): string {
  const r = validateProjectPath(input);
  if (!r.ok) throw new PathError(r.error);
  return r.path;
}

export class PathError extends Error {
  readonly code = "INVALID_PATH";
}

export function extname(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Resolve a relative import specifier ("./x", "../y") against an importing file. Returns null if it escapes the root. */
export function resolveRelative(fromFile: string, spec: string): string | null {
  const parts = dirname(fromFile).split("/").filter(Boolean);
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function languageForPath(path: string): string {
  switch (extname(path)) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "json":
    case "webmanifest":
      return "json";
    case "md":
      return "markdown";
    case "svg":
    case "xml":
      return "xml";
    default:
      return "plaintext";
  }
}
