import "server-only";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/server/db/client";
import { dataPath } from "@/server/storage/paths";
import { storage } from "@/server/storage/storage";
import { contentTypeFor } from "@/server/http/static";
import { runWorker, WorkerError } from "./worker-process";
import type { BuildDiagnostic, BuildSummary } from "@/lib/build-types";
import type { Framework } from "@/lib/schemas/project";
import { assertProjectPath } from "@/lib/vfs/paths";
import { filesDigest } from "@/server/vfs/digest";
import { previewUrlFor } from "./urls";

// ─── Preview runtime (allowlisted vendor packages) ───────────────────────

let runtimePromise: Promise<{ hash: string; base: string }> | null = null;

function runtimeHash(): string {
  const h = createHash("sha256");
  h.update(readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "preview-runner", "registry.mjs")));
  for (const pkg of ["react", "react-dom", "three", "@react-three/fiber", "@react-three/drei", "gsap", "motion", "zustand", "lucide-react", "d3"]) {
    try {
      const pj = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", pkg, "package.json"), "utf8")) as { version: string };
      h.update(`${pkg}@${pj.version};`);
    } catch {
      h.update(`${pkg}@missing;`);
    }
  }
  return h.digest("hex").slice(0, 16);
}

export function runtimeDir(hash: string) {
  return dataPath("runtime", hash);
}

async function walkFiles(dir: string, base = ""): Promise<{ path: string; abs: string }[]> {
  const out: { path: string; abs: string }[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(abs, rel)));
    else if (entry.isFile()) out.push({ path: rel, abs });
  }
  return out;
}

export async function ensureRuntime(): Promise<{ hash: string; base: string }> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const hash = runtimeHash();
      const prefix = `runtime/${hash}/`;
      if (!(await storage().get(`${prefix}manifest.json`))) {
        const outDir = dataPath("work", `runtime-${hash}-${randomBytes(5).toString("hex")}`);
        try {
          const r = await runWorker<{ ok: boolean; errors?: BuildDiagnostic[] }>({ mode: "runtime", outDir }, { timeoutMs: 180_000, maxHeapMb: 2048 });
          if (!r.ok) throw new Error(`preview runtime build failed: ${r.errors?.[0]?.message ?? "unknown error"}`);
          for (const file of await walkFiles(outDir)) {
            const key = `${prefix}${file.path}`;
            await storage().put(key, await fs.readFile(file.abs), contentTypeFor(file.path));
          }
        } finally {
          await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
        }
        if (!(await storage().get(`${prefix}manifest.json`))) throw new Error("preview runtime output was not stored");
      }
      return { hash, base: `/preview-runtime/${hash}` };
    })().catch((err) => {
      runtimePromise = null;
      throw err;
    });
  }
  return runtimePromise;
}

// ─── Project builds ──────────────────────────────────────────────────────

type WorkerResult = {
  ok: boolean;
  fatal?: boolean;
  errors: BuildDiagnostic[];
  warnings: BuildDiagnostic[];
  files: { path: string; content: string }[];
  durationMs: number;
};

export function previewBuildDir(buildId: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(buildId)) throw new Error("invalid build id");
  return dataPath("previews", buildId);
}

export async function buildProject(input: {
  projectId: string;
  framework: Framework;
  files: { path: string; content: string }[];
}): Promise<BuildSummary> {
  const buildId = randomBytes(18).toString("base64url");
  const digest = filesDigest(input.files);
  await db.build.create({ data: { id: buildId, projectId: input.projectId, status: "building", versionDigest: digest } });

  let result: WorkerResult;
  try {
    const runtime = await ensureRuntime();
    result = await runWorker<WorkerResult>({ mode: "project", framework: input.framework, files: input.files, runtimeBase: runtime.base }, { timeoutMs: 45_000 });
  } catch (err) {
    const message = err instanceof WorkerError || err instanceof Error ? err.message : "build failed";
    result = { ok: false, errors: [{ severity: "error", file: "", line: 0, column: 0, message, source: "worker" }], warnings: [], files: [], durationMs: 0 };
  }

  if (result.ok) {
    try {
      for (const f of result.files) {
        const rel = assertProjectPath(f.path);
        await storage().put(`previews/${buildId}/${rel}`, Buffer.from(f.content, "utf8"), contentTypeFor(rel));
      }
    } catch (err) {
      result = {
        ...result,
        ok: false,
        errors: [{ severity: "error", file: "", line: 0, column: 0, message: `could not store build output: ${(err as Error).message}`, source: "worker" }],
      };
    }
  }

  const status = result.ok ? "succeeded" : "failed";
  await db.build.update({
    where: { id: buildId },
    data: { status, errors: result.errors, warnings: result.warnings, durationMs: result.durationMs },
  });
  await db.project.update({
    where: { id: input.projectId },
    data: { lastBuildId: buildId, lastBuildStatus: status, ...(result.ok ? { lastWorkingBuildId: buildId } : {}) },
  });
  if (result.ok) void pruneBuilds(input.projectId).catch(() => {});

  return {
    buildId,
    status,
    errors: result.errors,
    warnings: result.warnings,
    durationMs: result.durationMs,
    previewUrl: result.ok ? previewUrlFor(buildId) : null,
  };
}

/** Keep the newest successful builds on disk plus the project's last working build. */
async function pruneBuilds(projectId: string, keep = 4) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { lastWorkingBuildId: true } });
  const builds = await db.build.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
  const keepIds = new Set(builds.filter((b) => b.status === "succeeded").slice(0, keep).map((b) => b.id));
  if (project?.lastWorkingBuildId) keepIds.add(project.lastWorkingBuildId);
  // Builds that back a live deployment are kept as well.
  const deps = await db.deployment.findMany({ where: { projectId, status: "ready" }, select: { buildId: true } });
  for (const d of deps) if (d.buildId) keepIds.add(d.buildId);
  for (const b of builds) {
    if (keepIds.has(b.id)) continue;
    await storage().deletePrefix(`previews/${b.id}/`);
  }
  const stale = builds.slice(30).filter((b) => !keepIds.has(b.id)).map((b) => b.id);
  if (stale.length) await db.build.deleteMany({ where: { id: { in: stale } } });
}

export async function removeProjectBuilds(projectId: string) {
  const builds = await db.build.findMany({ where: { projectId }, select: { id: true } });
  for (const b of builds) await storage().deletePrefix(`previews/${b.id}/`);
}
