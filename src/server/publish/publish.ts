import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { dataPath } from "@/server/storage/paths";
import { storage } from "@/server/storage/storage";
import { contentTypeFor } from "@/server/http/static";
import { ensureRuntime, prebuiltRuntime } from "@/server/build/builder";
import { HttpError } from "@/server/http/errors";
import { ensureDeckEngineCurrent } from "@/server/deck/upgrade";

/**
 * Publishing adapters. A deployment is created from the project's last
 * successful build. The published bundle is self-contained: the preview
 * runtime is copied in and the import map rewritten, so it works on any host.
 */
export interface DeploymentProvider {
  readonly id: string;
  /** True only if the result is reachable on the public internet. */
  readonly isPublic: boolean;
  configured(): { ok: boolean; reason: string | null };
  deploy(input: { slug: string; name: string; files: { path: string; data: Buffer }[] }): Promise<{ url: string; externalId: string | null }>;
  undeploy(dep: { slug: string | null; externalId: string | null }): Promise<void>;
}

/** Files of the vendor runtime, from the prebuilt copy shipped with the deployment or from storage. */
async function runtimeFiles(hash: string): Promise<{ path: string; data: Buffer }[]> {
  const files: { path: string; data: Buffer }[] = [];
  const prebuilt = prebuiltRuntime();
  if (prebuilt?.hash === hash) {
    for (const filePath of await listFiles(prebuilt.dir)) {
      files.push({ path: filePath, data: await fs.readFile(path.join(/*turbopackIgnore: true*/ prebuilt.dir, ...filePath.split("/"))) });
    }
    return files;
  }
  for (const key of await storage().list(`runtime/${hash}/`)) {
    const filePath = key.slice(`runtime/${hash}/`.length);
    const data = await storage().get(key);
    if (!data) throw new Error(`preview runtime artifact is missing: ${filePath}`);
    files.push({ path: filePath, data: Buffer.from(data) });
  }
  return files;
}

const persisted = new Map<string, Promise<void>>();
/**
 * Make sure the runtime with this hash is kept in storage, where
 * /preview-runtime/<hash>/ can still serve it after a redeploy ships a newer
 * runtime. Uploaded once per hash (manifest last, so a partial upload retries).
 */
export function persistRuntime(hash: string): Promise<void> {
  let p = persisted.get(hash);
  if (!p) {
    p = (async () => {
      if (await storage().get(`runtime/${hash}/manifest.json`)) return;
      const files = await runtimeFiles(hash);
      const manifest = files.find((f) => f.path === "manifest.json");
      if (!manifest) throw new Error("preview runtime manifest is missing");
      await forEachLimit(files.filter((f) => f !== manifest), 8, (f) => storage().put(`runtime/${hash}/${f.path}`, f.data, contentTypeFor(f.path)));
      await storage().put(`runtime/${hash}/manifest.json`, manifest.data, "application/json");
    })().catch((err) => {
      persisted.delete(hash);
      throw err;
    });
    persisted.set(hash, p);
  }
  return p;
}

/**
 * Collect a build into a deployable file list.
 * - `runtimePrefix` given: the runtime is copied in under that prefix (self-contained bundle for external hosts).
 * - `runtimePrefix` null: the site keeps loading the shared runtime from /preview-runtime/<hash>/ (built-in hosting);
 *   only the presentation's own few files are uploaded, which keeps publishing fast.
 */
export async function bundleForPublish(buildId: string, runtimePrefix: string | null): Promise<{ path: string; data: Buffer }[]> {
  const runtime = await ensureRuntime();
  const keys = await storage().list(`previews/${buildId}/`);
  const files: { path: string; data: Buffer }[] = await Promise.all(
    keys.map(async (key) => {
      const filePath = key.slice(`previews/${buildId}/`.length);
      let data = await storage().get(key);
      if (!data) throw new Error(`build artifact is missing: ${filePath}`);
      if (/\.html?$/.test(filePath)) {
        let html = Buffer.from(data).toString("utf8").replace(/<script data-strata-shim>[\s\S]*?<\/script>\n?/, "");
        if (runtimePrefix !== null) html = html.split(`${runtime.base}/`).join(runtimePrefix);
        data = Buffer.from(html, "utf8");
      }
      return { path: filePath, data: Buffer.from(data) };
    }),
  );
  if (runtimePrefix === null) return files;
  for (const f of await runtimeFiles(runtime.hash)) {
    if (f.path !== "manifest.json") files.push({ path: `_runtime/${f.path}`, data: f.data });
  }
  return files;
}

async function listFiles(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(path.join(/*turbopackIgnore: true*/ dir, entry.name), rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** Run `fn` over `items` with bounded concurrency (object-store uploads are network round trips). */
async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export function siteDir(slug: string) {
  if (!/^[a-z0-9-]{3,64}$/.test(slug)) throw new Error("invalid site slug");
  return dataPath("sites", slug);
}

class LocalDeploymentProvider implements DeploymentProvider {
  readonly id = "local";
  readonly isPublic = false;
  configured() {
    return { ok: true, reason: null };
  }
  async deploy({ slug, files }: { slug: string; files: { path: string; data: Buffer }[] }) {
    const version = randomBytes(12).toString("hex");
    const prefix = `sites/${slug}/${version}/`;
    try {
      for (const f of files) {
        const rel = f.path.split("/");
        if (rel.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) throw new Error("publish path escaped site directory");
      }
      await forEachLimit(files, 8, (f) => storage().put(`${prefix}${f.path}`, f.data, contentTypeFor(f.path)));
    } catch (error) {
      await storage().deletePrefix(prefix).catch(() => {});
      throw error;
    }
    // Stored as a path; the client shows it on whatever domain the app is served from
    // (an APP_ORIGIN copied from a local .env would otherwise point Amplify links at localhost).
    return { url: `/sites/${slug}/`, externalId: version };
  }
  async undeploy({ slug, externalId }: { slug: string | null; externalId: string | null }) {
    if (!slug) return;
    if (externalId && !/^[a-f0-9]{24}$/.test(externalId)) throw new Error("invalid site version");
    await storage().deletePrefix(externalId ? `sites/${slug}/${externalId}/` : `sites/${slug}/`);
  }
}

class VercelDeploymentProvider implements DeploymentProvider {
  readonly id = "vercel";
  readonly isPublic = true;
  configured() {
    return env().VERCEL_TOKEN ? { ok: true, reason: null } : { ok: false, reason: "Set VERCEL_TOKEN to publish publicly with Vercel." };
  }
  private headers() {
    return { Authorization: `Bearer ${env().VERCEL_TOKEN}`, "Content-Type": "application/json" };
  }
  private q() {
    const team = env().VERCEL_TEAM_ID;
    return team ? `?teamId=${encodeURIComponent(team)}` : "";
  }
  async deploy({ slug, name, files }: { slug: string; name: string; files: { path: string; data: Buffer }[] }) {
    const body = {
      name: `strata-${slug}`.slice(0, 90),
      target: "production",
      projectSettings: { framework: null },
      meta: { source: "strata", title: name.slice(0, 100) },
      files: files.map((f) => ({ file: f.path, data: f.data.toString("base64"), encoding: "base64" })),
    };
    const r = await fetch(`https://api.vercel.com/v13/deployments${this.q()}`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    const json = (await r.json().catch(() => ({}))) as { id?: string; url?: string; readyState?: string; error?: { message?: string } };
    if (!r.ok || !json.id) throw new Error(`Vercel deployment failed: ${json.error?.message ?? r.status}`);
    let state = json.readyState;
    const deadline = Date.now() + 5 * 60_000;
    while (state !== "READY") {
      if (state === "ERROR" || state === "CANCELED") throw new Error(`Vercel deployment ${state.toLowerCase()}`);
      if (Date.now() > deadline) throw new Error("Vercel deployment did not become ready within 5 minutes");
      await new Promise((res) => setTimeout(res, 3000));
      const s = await fetch(`https://api.vercel.com/v13/deployments/${json.id}${this.q()}`, { headers: this.headers() });
      state = ((await s.json()) as { readyState?: string }).readyState;
    }
    return { url: `https://${json.url}`, externalId: json.id };
  }
  async undeploy({ externalId }: { externalId: string | null }) {
    if (!externalId) return;
    const r = await fetch(`https://api.vercel.com/v13/deployments/${externalId}${this.q()}`, { method: "DELETE", headers: this.headers() });
    if (!r.ok && r.status !== 404) throw new Error(`Vercel undeploy failed (${r.status})`);
  }
}

/** Built-in hosting links are paths on this app (older rows stored an absolute, possibly localhost, URL). */
export function siteUrl(d: { provider: string; slug: string | null; url: string | null }): string | null {
  return d.provider === "local" && d.slug ? `/sites/${d.slug}/` : d.url;
}

export function deploymentProvider(): DeploymentProvider {
  return env().PUBLISH_PROVIDER === "vercel" ? new VercelDeploymentProvider() : new LocalDeploymentProvider();
}

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "site";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export async function publishProject(projectId: string) {
  await ensureDeckEngineCurrent(projectId);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!project.lastWorkingBuildId) throw new HttpError(409, "There is no successful build to publish yet. Build the project first.", "NO_BUILD");
  const provider = deploymentProvider();
  const cfg = provider.configured();
  if (!cfg.ok) throw new HttpError(409, cfg.reason ?? "Publishing is not configured", "NOT_CONFIGURED");
  const existing = await db.deployment.findFirst({ where: { projectId, status: { in: ["ready", "building"] } }, orderBy: { createdAt: "desc" } });
  const slug = existing?.slug ?? slugify(project.name);
  const dep = await db.deployment.create({
    data: { projectId, provider: provider.id, status: "building", slug, buildId: project.lastWorkingBuildId, isPublic: provider.isPublic },
  });
  let deployedExternalId: string | null = null;
  try {
    let files: { path: string; data: Buffer }[];
    if (provider.id === "local") {
      // Built-in hosting shares one stored copy of the runtime between all sites.
      await persistRuntime((await ensureRuntime()).hash);
      files = await bundleForPublish(project.lastWorkingBuildId, null);
    } else files = await bundleForPublish(project.lastWorkingBuildId, "/_runtime/");
    const r = await provider.deploy({ slug, name: project.name, files });
    deployedExternalId = r.externalId;
    if (existing && existing.provider !== "local" && existing.externalId && existing.externalId !== r.externalId) {
      await provider.undeploy({ slug: null, externalId: existing.externalId }).catch(() => {});
    }
    const ready = await db.deployment.update({ where: { id: dep.id }, data: { status: "ready", url: r.url, externalId: r.externalId } });
    if (provider.id === "local" && r.externalId) {
      await storage().put(`sites/${slug}/current.json`, Buffer.from(JSON.stringify({ version: r.externalId })), "application/json");
    }
    if (existing) await db.deployment.update({ where: { id: existing.id }, data: { status: "superseded" } });
    if (existing?.provider === "local" && existing.externalId) {
      await new LocalDeploymentProvider().undeploy({ slug: existing.slug, externalId: existing.externalId }).catch(() => {});
    }
    return ready;
  } catch (err) {
    if (provider.id === "local" && deployedExternalId) await provider.undeploy({ slug, externalId: deployedExternalId }).catch(() => {});
    return db.deployment.update({ where: { id: dep.id }, data: { status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "deployment failed" } });
  }
}

export async function unpublishProject(projectId: string) {
  const deps = await db.deployment.findMany({ where: { projectId, status: "ready" } });
  const provider = deploymentProvider();
  for (const d of deps) {
    if (d.provider === "local") await new LocalDeploymentProvider().undeploy({ slug: d.slug, externalId: d.externalId });
    else if (d.provider === provider.id) await provider.undeploy({ slug: d.slug, externalId: d.externalId });
    await db.deployment.update({ where: { id: d.id }, data: { status: "unpublished" } });
    if (d.provider === "local" && d.slug) await storage().delete(`sites/${d.slug}/current.json`);
  }
  return deps.length;
}
