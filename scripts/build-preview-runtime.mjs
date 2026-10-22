// Prebuilds the allowlisted preview vendor runtime (react, three, gsap, …) at
// `npm run build` time into preview-runtime-dist/<hash>/ and records the hash
// in preview-runtime-dist/current.json.
//
// Serverless hosts (AWS Amplify, Lambda) have a read-only app directory and no
// node_modules at runtime, so the runtime cannot be bundled on first request.
// Shipping it with the deployment also removes a slow cold-start step.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PREBUILT_RUNTIME_DIR, runtimeHash } from "../preview-runner/runtime-hash.mjs";

const root = process.cwd();
const hash = runtimeHash(root);
const distRoot = path.join(root, PREBUILT_RUNTIME_DIR);
const outDir = path.join(distRoot, hash);

if (existsSync(path.join(outDir, "manifest.json"))) {
  console.log(`[preview-runtime] ${hash} is up to date`);
} else {
  const t0 = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=2048", path.join(root, "preview-runner", "build-worker.mjs")], {
      cwd: root,
      stdio: ["pipe", "pipe", "inherit"],
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error(`runtime build worker exited with code ${code}`));
      }
    });
    child.stdin.end(JSON.stringify({ mode: "runtime", outDir }));
  });
  if (!result.ok) {
    console.error("[preview-runtime] build failed:", result.errors?.[0]?.message ?? "unknown error");
    process.exit(1);
  }
  console.log(`[preview-runtime] built ${hash} (${result.entries} entries) in ${Date.now() - t0} ms`);
}

// Keep only the current runtime so the deployment stays small.
mkdirSync(distRoot, { recursive: true });
for (const entry of readdirSync(distRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== hash) rmSync(path.join(distRoot, entry.name), { recursive: true, force: true });
}
writeFileSync(path.join(distRoot, "current.json"), JSON.stringify({ hash }) + "\n");
