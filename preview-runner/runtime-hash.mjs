// Content hash of the preview vendor runtime: the allowlist plus the installed
// versions of the packages it bundles. Shared by the build-time prebuild script
// (scripts/build-preview-runtime.mjs) and the server fallback in builder.ts.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const RUNTIME_HASH_PACKAGES = ["react", "react-dom", "three", "@react-three/fiber", "@react-three/drei", "gsap", "motion", "zustand", "lucide-react", "d3"];

/** Directory (relative to the app root) holding the runtime prebuilt by `npm run build`. */
export const PREBUILT_RUNTIME_DIR = "preview-runtime-dist";

export function runtimeHash(root) {
  const h = createHash("sha256");
  h.update(readFileSync(path.join(root, "preview-runner", "registry.mjs")));
  for (const pkg of RUNTIME_HASH_PACKAGES) {
    try {
      const pj = JSON.parse(readFileSync(path.join(root, "node_modules", pkg, "package.json"), "utf8"));
      h.update(`${pkg}@${pj.version};`);
    } catch {
      h.update(`${pkg}@missing;`);
    }
  }
  return h.digest("hex").slice(0, 16);
}
