import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { startMediaJob } from "@/server/services/media";
import { mediaProviderStatus } from "@/server/media/providers";
import { storage } from "@/server/storage/storage";
import { createProject } from "@/server/services/projects";
import { buildProject, ensureRuntime } from "@/server/build/builder";
import { bundleForPublish, publishProject, unpublishProject } from "@/server/publish/publish";
import { GET as previewGET } from "@/app/preview/[buildId]/[[...path]]/route";
import { GET as sitesGET } from "@/app/sites/[slug]/[[...path]]/route";
import { EXAMPLE_PROJECTS } from "@/server/examples";
import type { MediaJobOutput } from "@/server/services/media";
import { createUser, waitForJob } from "../support/helpers";

describe("asset generation jobs", () => {
  it("runs queued → running → succeeded and stores real output", async () => {
    const u = await createUser();
    const jobId = await startMediaJob(u.id, { kind: "image", providerId: "test-fixture", prompt: "a test image", options: {} });
    const job = await waitForJob(jobId);
    expect(job.status).toBe("succeeded");
    expect(job.startedAt).toBeTruthy();
    expect(job.finishedAt).toBeTruthy();
    const out = job.output as unknown as MediaJobOutput;
    expect(out.mimeType).toBe("image/png");
    const bytes = await storage().get(out.storageKey);
    expect(Buffer.from(bytes!).subarray(1, 4).toString()).toBe("PNG");
    const statuses = (job.events as { type: string; status?: string }[]).filter((e) => e.type === "status").map((e) => e.status);
    expect(statuses).toEqual(["running", "succeeded"]);
  });

  it("marks provider failures as failed without producing an asset", async () => {
    const u = await createUser();
    const job = await waitForJob(await startMediaJob(u.id, { kind: "image", providerId: "test-fixture", prompt: "x [simulate-failure]", options: {} }));
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/Simulated provider failure/);
    expect(job.output).toBeNull();
  });

  it("refuses unconfigured or unsupported providers instead of pretending", async () => {
    const u = await createUser();
    await expect(startMediaJob(u.id, { kind: "model3d", providerId: "meshy", prompt: "a chest", options: {} })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/MESHY_API_KEY/) });
    await expect(startMediaJob(u.id, { kind: "sfx", providerId: "openai", prompt: "boom", options: {} })).rejects.toMatchObject({ status: 400 });
    await expect(startMediaJob(u.id, { kind: "image", providerId: "openai", prompt: "an image", options: {} })).rejects.toMatchObject({ status: 409 });
    const status = mediaProviderStatus();
    expect(status.model3d[0]).toMatchObject({ id: "meshy", availableForKind: false });
    expect(status.sfx[0]).toMatchObject({ id: "elevenlabs", availableForKind: false });
    expect(status.video[0].availableForKind).toBe(false);
  });
});

describe("preview serving and publishing", () => {
  it("serves builds with a CSP sandbox and rejects traversal", async () => {
    const u = await createUser();
    const ex = EXAMPLE_PROJECTS.find((e) => e.id === "neon-dodge")!;
    const p = await createProject(u.id, { name: ex.name, category: ex.category, framework: ex.framework, files: ex.files() });
    const b = await buildProject({ projectId: p.id, framework: ex.framework, files: ex.files() });
    expect(b.status).toBe("succeeded");
    const res = await previewGET(new Request("http://x/"), { params: Promise.resolve({ buildId: b.buildId, path: ["index.html"] }) });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/^sandbox allow-scripts/);
    expect(csp).not.toMatch(/allow-same-origin/);
    expect(csp).toMatch(/connect-src 'self'/);
    expect(await res.text()).toContain('type="importmap"');
    const trav = await previewGET(new Request("http://x/"), { params: Promise.resolve({ buildId: b.buildId, path: ["..", "..", "deck3d.db"] }) });
    expect(trav.status).toBe(400);
    const badId = await previewGET(new Request("http://x/"), { params: Promise.resolve({ buildId: "../../x", path: [] }) });
    expect(badId.status).toBe(404);
  }, 120_000);

  it("publishes a site locally on the shared runtime, re-publishes, and unpublishes", async () => {
    const u = await createUser();
    const ex = EXAMPLE_PROJECTS.find((e) => e.id === "saas-landing")!;
    const p = await createProject(u.id, { name: "Pub Test", category: ex.category, framework: ex.framework, files: ex.files() });
    await expect(publishProject(p.id)).rejects.toMatchObject({ status: 409 }); // no successful build yet
    await buildProject({ projectId: p.id, framework: ex.framework, files: ex.files() });
    const d = await publishProject(p.id);
    expect(d).toMatchObject({ status: "ready", provider: "local", isPublic: false });
    expect(d.externalId).toMatch(/^[a-f0-9]{24}$/);
    const sitePrefix = `sites/${d.slug}/${d.externalId}`;
    const htmlBytes = await storage().get(`${sitePrefix}/index.html`);
    const html = Buffer.from(htmlBytes!).toString("utf8");
    // Built-in hosting loads the shared runtime, kept in storage so it outlives redeploys.
    const { hash } = await ensureRuntime();
    expect(html).toContain(`/preview-runtime/${hash}/react.js`);
    expect(html).not.toContain("data-deck3d-shim");
    expect(await storage().get(`${sitePrefix}/_runtime/react.js`)).toBeNull();
    expect(await storage().get(`runtime/${hash}/react.js`)).toBeTruthy();
    expect(await storage().get(`runtime/${hash}/manifest.json`)).toBeTruthy();
    // A self-contained bundle (external hosts) still carries the runtime.
    const bundle = await bundleForPublish(d.buildId!, "/_runtime/");
    expect(bundle.some((f) => f.path === "_runtime/react.js")).toBe(true);
    expect(Buffer.from(bundle.find((f) => f.path === "index.html")!.data).toString("utf8")).toContain("/_runtime/react.js");
    const res = await sitesGET(new Request("http://x/"), { params: Promise.resolve({ slug: d.slug!, path: ["pricing"] }) });
    expect(res.status).toBe(200); // SPA fallback to index.html
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox/);
    const again = await publishProject(p.id);
    expect(again.slug).toBe(d.slug);
    expect(again.externalId).not.toBe(d.externalId);
    expect(await storage().get(`${sitePrefix}/index.html`)).toBeNull();
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("superseded");
    expect(await unpublishProject(p.id)).toBe(1);
    expect(await storage().get(`sites/${d.slug}/current.json`)).toBeNull();
  }, 120_000);
});
