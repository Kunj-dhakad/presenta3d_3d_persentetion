import { createHash } from "node:crypto";

/** Stable content digest of a file set (order independent). */
export function filesDigest(files: { path: string; content: string }[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path);
    h.update("\u0000");
    h.update(f.content);
    h.update("\u0001");
  }
  return h.digest("hex");
}
