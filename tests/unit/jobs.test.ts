import { describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { createProject, getFiles } from "@/server/services/projects";
import { activeProjectJob, createDeferredJob, reconcileOrphanedJob, startJob, subscribe } from "@/server/jobs/runner";
import { startDeferredJob, type DeckJobInput } from "@/server/jobs/deferred";
import { storage } from "@/server/storage/storage";
import { MockTextProvider } from "@/server/ai/mock-provider";
import type { JobEvent } from "@/lib/jobs";
import { createUser, waitForJob } from "../support/helpers";

async function deckJob(prompt = "A deck about volcanoes") {
  const u = await createUser();
  const p = await createProject(u.id, { name: "Untitled presentation", category: "presentation", framework: "three" });
  const conversation = await db.conversation.create({ data: { userId: u.id, projectId: p.id, title: "t" } });
  await db.chatMessage.create({ data: { conversationId: conversation.id, role: "user", content: prompt } });
  const input: DeckJobInput = { runner: "deck", prompt, mode: "auto", conversationId: conversation.id, startedAt: new Date().toISOString() };
  const jobId = await createDeferredJob({ userId: u.id, projectId: p.id, kind: "project-generate", provider: "mock", input });
  return { userId: u.id, projectId: p.id, jobId };
}

const row = (id: string) => db.generationJob.findUniqueOrThrow({ where: { id } });

describe("job runner", () => {
  it("saves the final status before announcing it, so a follow-up prompt is not refused", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "deck", category: "presentation", framework: "three" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const jobId = await startJob({ userId: u.id, projectId: p.id, kind: "project-generate", provider: "mock", input: {} }, async () => {
      await gate;
      return { ok: true };
    });

    const seen = new Promise<{ status: string | undefined; active: unknown }>((resolve) => {
      subscribe(jobId, (e: JobEvent) => {
        if (e.type === "status" && e.status === "succeeded") {
          // What a client sending its next prompt at this moment would find.
          void Promise.all([db.generationJob.findUnique({ where: { id: jobId } }), activeProjectJob(p.id)]).then(([r, active]) => resolve({ status: r?.status, active }));
        }
      });
    });
    expect(await activeProjectJob(p.id)).toMatchObject({ id: jobId });
    // A remote database (RDS): every write takes a while.
    const updateMany = db.generationJob.updateMany.bind(db.generationJob);
    const slow = vi.spyOn(db.generationJob, "updateMany").mockImplementation(((args: Parameters<typeof updateMany>[0]) =>
      new Promise((r) => setTimeout(r, 150)).then(() => updateMany(args))) as never);
    try {
      release();
      expect(await seen).toEqual({ status: "succeeded", active: null });
      await waitForJob(jobId);
    } finally {
      slow.mockRestore();
    }
  });

  it("gives up a job nobody has worked on for minutes, and frees the project", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "deck", category: "presentation", framework: "three" });
    const job = await db.generationJob.create({
      data: { userId: u.id, projectId: p.id, kind: "project-generate", provider: "mock", input: {}, status: "running", events: [] },
    });
    // Worked on recently (a step running elsewhere, or between steps): still alive.
    expect(await activeProjectJob(p.id)).toMatchObject({ id: job.id });
    // Silent for four minutes: no step ran and none was requested.
    await db.generationJob.update({ where: { id: job.id }, data: { updatedAt: new Date(Date.now() - 4 * 60_000) } });
    expect(await activeProjectJob(p.id)).toBeNull();
    const after = await reconcileOrphanedJob(await row(job.id));
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/Interrupted/);
  });
});

describe("deck jobs in steps (serverless requests are cut off after about a minute)", () => {
  it("saves a checkpoint when a step runs out of time, and the next step finishes the job from it", async () => {
    const { jobId, projectId } = await deckJob();
    // 3D scenes take a while to write (25-50 s with a real model).
    const structured = MockTextProvider.prototype.structured;
    const slow = vi.spyOn(MockTextProvider.prototype, "structured").mockImplementation(async function (this: MockTextProvider, req) {
      if (req.operation === "deck.scene") await new Promise((r) => setTimeout(r, 400));
      return structured.call(this, req);
    } as typeof structured);

    // Step 1: the step ends before the scenes are written.
    const step1 = await startDeferredJob(await row(jobId), { budgetMs: 2_100 });
    expect(await step1!.done).toBe("continue");
    const between = await row(jobId);
    expect(between.status).toBe("running");
    expect(between.externalId).toBeNull(); // lease released: the next step can start at once
    expect(await storage().get(`jobs/${jobId}/checkpoint.json`)).toBeTruthy();
    // The first preview is already saved and built.
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).lastBuildStatus).toBe("succeeded");
    const eventsAfterStep1 = (between.events as JobEvent[]).length;

    // Step 2 resumes from the checkpoint (the slides are not written again), writes the scenes and finishes.
    const step2 = await startDeferredJob(await row(jobId), { budgetMs: 60_000 });
    expect(await step2!.done).toBe("finished");
    slow.mockRestore();
    const done = await row(jobId);
    expect({ status: done.status, error: done.error }).toEqual({ status: "succeeded", error: null });
    const events = done.events as JobEvent[];
    expect(events.length).toBeGreaterThan(eventsAfterStep1);
    expect(events.filter((e) => e.type === "log" && /Asking/.test(e.message))).toHaveLength(1);
    expect(events.some((e) => e.type === "log" && /Resuming/.test(e.message))).toBe(true);
    expect(events.filter((e) => e.type === "status" && e.status === "running")).toHaveLength(1);
    // One assistant reply, the checkpoint is cleaned up, and the project has the final deck.
    const conv = await db.conversation.findFirstOrThrow({ where: { projectId } });
    expect(await db.chatMessage.count({ where: { conversationId: conv.id, role: "assistant" } })).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(await storage().get(`jobs/${jobId}/checkpoint.json`)).toBeNull();
    // Every slide got its custom 3D scene in the end.
    const deck = JSON.parse((await getFiles(projectId)).find((f) => f.path === "deck.json")!.content) as { slides: { scene: { code?: string; pending?: boolean } }[] };
    expect(deck.slides.every((s) => s.scene.code && !s.scene.pending)).toBe(true);
  });

  it("always finishes, even when every step is shorter than the time a phase asks for", async () => {
    const { jobId } = await deckJob();
    // A slow start (remote database, cold instance) can use up most of a step before it begins.
    const outcomes: string[] = [];
    for (let i = 0; i < 8 && outcomes.at(-1) !== "finished"; i++) {
      const step = await startDeferredJob(await row(jobId), { budgetMs: 5_000 });
      outcomes.push(await step!.done);
    }
    expect(outcomes.at(-1)).toBe("finished");
    expect(outcomes.length).toBeLessThanOrEqual(4);
    expect((await row(jobId)).status).toBe("succeeded");
  });

  it("takes over a step whose instance was frozen, once its lease has gone silent", async () => {
    const { jobId } = await deckJob();
    // A step started on an instance that was then frozen: it holds the lease but stopped heartbeating.
    await db.generationJob.update({ where: { id: jobId }, data: { status: "running", externalId: "lease:frozen", updatedAt: new Date() } });
    expect(await startDeferredJob(await row(jobId))).toBeNull(); // lease still fresh: wait
    await db.generationJob.update({ where: { id: jobId }, data: { updatedAt: new Date(Date.now() - 40_000) } });
    const takeover = await startDeferredJob(await row(jobId), { budgetMs: 120_000 });
    expect(takeover).not.toBeNull();
    expect(await takeover!.done).toBe("finished");
    expect((await row(jobId)).status).toBe("succeeded");
  });

  it("a frozen step that wakes up after another step took over changes nothing", async () => {
    const { jobId, projectId } = await deckJob();
    let wake!: () => void;
    const frozen = new Promise<void>((r) => (wake = r));
    // The first step's instance is frozen in the middle of writing the slides (as Lambda does).
    const structured = MockTextProvider.prototype.structured;
    let deckCalls = 0;
    const spy = vi.spyOn(MockTextProvider.prototype, "structured").mockImplementation(async function (this: MockTextProvider, req) {
      if (req.operation === "deck.generate" && deckCalls++ === 0) await frozen;
      return structured.call(this, req);
    } as typeof structured);
    try {
      const step1 = await startDeferredJob(await row(jobId), { budgetMs: 120_000 });
      expect(step1).not.toBeNull();
      await vi.waitFor(() => expect(deckCalls).toBe(1));
      // Its lease goes silent; another request takes the job over and finishes it.
      await db.generationJob.update({ where: { id: jobId }, data: { updatedAt: new Date(Date.now() - 40_000) } });
      const step2 = await startDeferredJob(await row(jobId), { budgetMs: 120_000 });
      expect(step2).not.toBeNull();
      expect(await step2!.done).toBe("finished");
      const finished = await row(jobId);
      expect(finished.status).toBe("succeeded");
      const files = await getFiles(projectId);

      // The frozen step wakes up: it notices it lost the job before writing anything.
      wake();
      expect(await step1!.done).toBe("continue");
      const after = await row(jobId);
      expect(after.status).toBe("succeeded");
      expect(after.events).toEqual(finished.events);
      expect(await getFiles(projectId)).toEqual(files);
      const conv = await db.conversation.findFirstOrThrow({ where: { projectId } });
      expect(await db.chatMessage.count({ where: { conversationId: conv.id, role: "assistant" } })).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
