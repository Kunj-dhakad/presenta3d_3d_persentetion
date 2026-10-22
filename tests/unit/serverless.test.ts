import { describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { buildProject, isGeneratedDeck, prebuiltRuntime } from "@/server/build/builder";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { createDeferredJob, reconcileOrphanedJob } from "@/server/jobs/runner";
import { startDeferredJob, type DeckJobInput } from "@/server/jobs/deferred";
import { createProject } from "@/server/services/projects";
import { storage } from "@/server/storage/storage";
import { sampleDeck } from "@/lib/schemas/deck";
import { createUser } from "../support/helpers";

// Serverless hosts (AWS Amplify compute) cannot always spawn the esbuild worker;
// presentation builds must never depend on it.
vi.mock("@/server/build/worker-process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/build/worker-process")>();
  return { ...actual, runWorker: vi.fn(async () => Promise.reject(new actual.WorkerError("worker unavailable in this test", "CRASH"))) };
});

describe("serverless deployment", () => {
  it("uses the runtime prebuilt by npm run build", () => {
    const prebuilt = prebuiltRuntime();
    expect(prebuilt?.hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("builds presentations in-process, without the esbuild worker", async () => {
    const user = await createUser();
    const files = deckToProjectFiles(sampleDeck("Ocean currents"));
    const project = await createProject(user.id, { name: "Deck", category: "presentation", framework: "three", files });
    expect(isGeneratedDeck(files)).toBe(true);

    const build = await buildProject({ projectId: project.id, framework: "three", files });
    expect(build.status).toBe("succeeded");
    const html = Buffer.from((await storage().get(`previews/${build.buildId}/index.html`))!).toString("utf8");
    expect(html).toContain('<script type="importmap">');
    expect(html).toContain(`/preview-runtime/${prebuiltRuntime()!.hash}/three.js`);
    expect(html).toContain("data-strata-shim");
    expect(await storage().get(`previews/${build.buildId}/main.js`)).toBeTruthy();
  });

  it("does not treat edited engine code as a generated deck", () => {
    const files = deckToProjectFiles(sampleDeck("Edited"));
    const tampered = files.map((f) => (f.path === "main.js" ? { ...f, content: `${f.content}\nconsole.log("x")` } : f));
    expect(isGeneratedDeck(tampered)).toBe(false);
    expect(isGeneratedDeck(files.filter((f) => f.path !== "deck.json"))).toBe(false);
  });

  it("runs a deferred generation job exactly once, in the request that claims it", async () => {
    const user = await createUser();
    const project = await createProject(user.id, { name: "Untitled presentation", category: "presentation", framework: "three" });
    const conversation = await db.conversation.create({ data: { userId: user.id, projectId: project.id, title: "t" } });
    const input: DeckJobInput = { runner: "deck", prompt: "A deck about volcanoes", mode: "auto", conversationId: conversation.id, startedAt: new Date().toISOString() };
    const jobId = await createDeferredJob({ userId: user.id, projectId: project.id, kind: "project-generate", provider: "mock", input });

    // Nothing runs until the event stream claims it.
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("queued");

    const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const [first, second] = await Promise.all([startDeferredJob(job), startDeferredJob(job)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    await (first ?? second)!.done;

    const done = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(done.status).toBe("succeeded");
    const p = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(p.lastBuildStatus).toBe("succeeded");
    // A finished job is never claimed again.
    expect(await startDeferredJob(done)).toBeNull();
  });

  it("leaves fresh jobs from other instances alone and fails stale ones", async () => {
    const user = await createUser();
    const fresh = await db.generationJob.create({ data: { userId: user.id, kind: "project-generate", provider: "mock", input: {}, status: "running" } });
    expect((await reconcileOrphanedJob(fresh)).status).toBe("running");

    const stale = await db.generationJob.create({
      data: { userId: user.id, kind: "project-generate", provider: "mock", input: {}, status: "running", updatedAt: new Date(Date.now() - 10 * 60_000) },
    });
    const r = await reconcileOrphanedJob(stale);
    expect(r.status).toBe("failed");
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("failed");
  });
});
