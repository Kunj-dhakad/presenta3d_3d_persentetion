import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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
import { importMap } from "../../../preview-runner/registry.mjs";
import { PREBUILT_RUNTIME_DIR, runtimeHash } from "../../../preview-runner/runtime-hash.mjs";
import { validateDeck } from "@/lib/schemas/deck";
import { deckToProjectFiles } from "@/server/deck/codegen";

// ─── Preview runtime (allowlisted vendor packages) ───────────────────────

let runtimePromise: Promise<{ hash: string; base: string }> | null = null;

const appRoot = () => /*turbopackIgnore: true*/ process.cwd();

/**
 * The runtime prebuilt by `npm run build` (scripts/build-preview-runtime.mjs)
 * and shipped with the deployment. Serverless hosts have no writable app
 * directory and no node_modules at runtime, so this is the production path.
 */
export function prebuiltRuntime(): { hash: string; dir: string } | null {
  try {
    const { hash } = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ appRoot(), PREBUILT_RUNTIME_DIR, "current.json"), "utf8")) as { hash: string };
    if (!/^[a-f0-9]{16}$/.test(hash)) return null;
    const dir = path.join(/*turbopackIgnore: true*/ appRoot(), PREBUILT_RUNTIME_DIR, hash);
    return existsSync(path.join(/*turbopackIgnore: true*/ dir, "manifest.json")) ? { hash, dir } : null;
  } catch {
    return null;
  }
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
      const prebuilt = prebuiltRuntime();
      if (prebuilt) return { hash: prebuilt.hash, base: `/preview-runtime/${prebuilt.hash}` };
      // Development fallback: bundle the runtime once and keep it in storage.
      const hash = runtimeHash(appRoot());
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

// ─── Presentation builds (in-process) ────────────────────────────────────

let shimCache: string | null = null;
function shim() {
  return (shimCache ??= readFileSync(path.join(/*turbopackIgnore: true*/ appRoot(), "preview-runner", "shim.js"), "utf8"));
}

/** Same head injection as preview-runner/build-worker.mjs. */
function injectHead(html: string, runtimeBase: string) {
  const injection =
    `<meta charset="utf-8">\n` +
    `<script type="importmap">${JSON.stringify(importMap(runtimeBase))}</script>\n` +
    `<script data-deck3d-shim>${shim()}</script>\n`;
  html = html.replace(/<script[^>]*type=["']importmap["'][^>]*>[\s\S]*?<\/script>/gi, "");
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${injection}`);
  return `<!doctype html>\n<html><head>\n${injection}</head><body>\n${html}\n</body></html>`;
}

/**
 * True when the file set is exactly what the presentation engine generates
 * from its deck.json. Such projects contain no model-written code, so they
 * need no bundling or validation and are built in-process in a few ms
 * (no esbuild child process, which serverless hosts cannot always spawn).
 */
export function isGeneratedDeck(files: { path: string; content: string }[]): boolean {
  const deckFile = files.find((f) => f.path === "deck.json");
  if (!deckFile) return false;
  try {
    const v = validateDeck(JSON.parse(deckFile.content));
    if (!v.ok) return false;
    const expected = deckToProjectFiles(v.deck);
    const current = new Map(files.map((f) => [f.path, f.content]));
    return (
      expected.length === files.length &&
      expected.every((f) => (f.path === "deck.json" ? current.has("deck.json") : current.get(f.path) === f.content))
    );
  } catch {
    return false;
  }
}

async function buildDeckInProcess(files: { path: string; content: string }[], runtimeBase: string): Promise<WorkerResult> {
  const t0 = Date.now();
  const out = files.map((f) => (/\.html?$/.test(f.path) ? { path: f.path, content: injectHead(f.content, runtimeBase) } : f));
  return { ok: true, errors: [], warnings: [], files: out, durationMs: Date.now() - t0 };
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
  // The build row is written while the build runs (each query is a network round trip).
  const created = db.build.create({ data: { id: buildId, projectId: input.projectId, status: "building", versionDigest: digest } });
  created.catch(() => {}); // awaited below

  let result: WorkerResult;
  try {
    const runtime = await ensureRuntime();
    result = isGeneratedDeck(input.files)
      ? await buildDeckInProcess(input.files, runtime.base)
      : await runWorker<WorkerResult>({ mode: "project", framework: input.framework, files: input.files, runtimeBase: runtime.base }, { timeoutMs: 45_000 });
  } catch (err) {
    const message = err instanceof WorkerError || err instanceof Error ? err.message : "build failed";
    result = { ok: false, errors: [{ severity: "error", file: "", line: 0, column: 0, message, source: "worker" }], warnings: [], files: [], durationMs: 0 };
  }

  if (result.ok) {
    try {
      // Upload in parallel: with S3 each put is a network round trip.
      await Promise.all(
        result.files.map((f) => {
          const rel = assertProjectPath(f.path);
          return storage().put(`previews/${buildId}/${rel}`, Buffer.from(f.content, "utf8"), contentTypeFor(rel));
        }),
      );
    } catch (err) {
      result = {
        ...result,
        ok: false,
        errors: [{ severity: "error", file: "", line: 0, column: 0, message: `could not store build output: ${(err as Error).message}`, source: "worker" }],
      };
    }
  }

  const status = result.ok ? "succeeded" : "failed";
  await created;
  await Promise.all([
    db.build.update({
      where: { id: buildId },
      data: { status, errors: result.errors, warnings: result.warnings, durationMs: result.durationMs },
    }),
    db.project.update({
      where: { id: input.projectId },
      data: { lastBuildId: buildId, lastBuildStatus: status, ...(result.ok ? { lastWorkingBuildId: buildId } : {}) },
    }),
  ]);
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
