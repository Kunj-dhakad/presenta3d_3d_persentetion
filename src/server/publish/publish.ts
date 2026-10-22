import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { dataPath } from "@/server/storage/paths";
import { ensureRuntime, previewBuildDir, runtimeDir } from "@/server/build/builder";
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

async function walk(dir: string, base = ""): Promise<{ path: string; abs: string }[]> {
  const out: { path: string; abs: string }[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(abs, rel)));
    else out.push({ path: rel, abs });
  }
  return out;
}

/** Collect a build plus the runtime into a deployable file list, rewriting runtime URLs to `runtimePrefix`. */
export async function bundleForPublish(buildId: string, runtimePrefix: string): Promise<{ path: string; data: Buffer }[]> {
  const runtime = await ensureRuntime();
  const files: { path: string; data: Buffer }[] = [];
  for (const f of await walk(previewBuildDir(buildId))) {
    let data = await fs.readFile(f.abs);
    if (/\.html?$/.test(f.path)) {
      const html = data
        .toString("utf8")
        .split(`${runtime.base}/`)
        .join(runtimePrefix)
        .replace(/<script data-strata-shim>[\s\S]*?<\/script>\n?/, "");
      data = Buffer.from(html, "utf8");
    }
    files.push({ path: f.path, data });
  }
  for (const f of await walk(runtimeDir(runtime.hash))) {
    if (f.path === "manifest.json") continue;
    files.push({ path: `_runtime/${f.path}`, data: await fs.readFile(f.abs) });
  }
  return files;
}

/**
 * Rename a freshly written directory into place. On Windows, antivirus and
 * search indexing briefly lock new files, so renames fail with EPERM/EBUSY;
 * retry with backoff and fall back to copy + delete.
 */
async function moveDir(from: string, to: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw err;
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
  await fs.cp(from, to, { recursive: true });
  await fs.rm(from, { recursive: true, force: true }).catch(() => {});
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
    const dir = siteDir(slug);
    const tmp = `${dir}.tmp-${randomBytes(4).toString("hex")}`;
    await fs.mkdir(tmp, { recursive: true });
    try {
      for (const f of files) {
        const target = path.resolve(tmp, ...f.path.split("/"));
        if (!target.startsWith(path.resolve(tmp) + path.sep)) throw new Error("publish path escaped site directory");
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, f.data);
      }
      // Swap atomically-ish so a re-publish never serves a half-written site.
      await fs.rm(dir, { recursive: true, force: true });
      await moveDir(tmp, dir);
    } finally {
      // Never leave a half-written temp directory behind.
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
    const origin = env().APP_ORIGIN?.replace(/\/$/, "") ?? "";
    return { url: `${origin}/sites/${slug}/`, externalId: null };
  }
  async undeploy({ slug }: { slug: string | null }) {
    if (slug) await fs.rm(siteDir(slug), { recursive: true, force: true });
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
  try {
    const prefix = provider.id === "local" ? `/sites/${slug}/_runtime/` : "/_runtime/";
    const files = await bundleForPublish(project.lastWorkingBuildId, prefix);
    const r = await provider.deploy({ slug, name: project.name, files });
    if (existing && existing.provider !== "local" && existing.externalId && existing.externalId !== r.externalId) {
      await provider.undeploy({ slug: null, externalId: existing.externalId }).catch(() => {});
    }
    if (existing) await db.deployment.update({ where: { id: existing.id }, data: { status: "superseded" } });
    return db.deployment.update({ where: { id: dep.id }, data: { status: "ready", url: r.url, externalId: r.externalId } });
  } catch (err) {
    return db.deployment.update({ where: { id: dep.id }, data: { status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "deployment failed" } });
  }
}

export async function unpublishProject(projectId: string) {
  const deps = await db.deployment.findMany({ where: { projectId, status: "ready" } });
  const provider = deploymentProvider();
  for (const d of deps) {
    if (d.provider === "local") await new LocalDeploymentProvider().undeploy({ slug: d.slug });
    else if (d.provider === provider.id) await provider.undeploy({ slug: d.slug, externalId: d.externalId });
    await db.deployment.update({ where: { id: d.id }, data: { status: "unpublished" } });
  }
  return deps.length;
}
