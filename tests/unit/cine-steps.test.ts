import { describe, expect, it, vi } from "vitest";

// On the live server a job step is cut off after about a minute while an image can take longer.
// Images still being painted when a step ends must be collected by the next step, never started again.
const started: string[] = [];
let ready = false; // set between the steps: OpenAI has finished painting
vi.mock("@/server/deck/cine-images", () => ({
  DEFAULT_IMAGE_MODEL: "gpt-image-1",
  ImagePainter: class {
    model = "fake-image-model";
    constructor(private projectId: string) {}
    async start(prompt: string) {
      started.push(prompt);
      return `resp_${started.length}`;
    }
    async check(id: string) {
      return ready ? { state: "done", url: `/deckmedia/${this.projectId}/image${id.replace(/\W/g, "")}abcdef.webp` } : { state: "pending" };
    }
    async cancel() {}
  },
}));

const { db } = await import("@/server/db/client");
const { createDeferredJob } = await import("@/server/jobs/runner");
const { startDeferredJob } = await import("@/server/jobs/deferred");
const { createProject, getFiles } = await import("@/server/services/projects");
const { createUser } = await import("../support/helpers");

describe("cinematic images across job steps", () => {
  it("collects images that finish after a step ended, without starting them again", async () => {
    const user = await createUser();
    const project = await createProject(user.id, { name: "Untitled presentation", category: "presentation", framework: "cinematic" });
    const conversation = await db.conversation.create({ data: { userId: user.id, projectId: project.id, title: "t" } });
    const jobId = await createDeferredJob({
      userId: user.id,
      projectId: project.id,
      kind: "project-generate",
      provider: "mock",
      input: { runner: "deck", prompt: "Climate change", mode: "auto", conversationId: conversation.id, startedAt: new Date().toISOString() },
    });

    // Step 1: slides written, both images started at once, still being painted when the step runs out of time.
    const step1 = await startDeferredJob(await db.generationJob.findUniqueOrThrow({ where: { id: jobId } }), { budgetMs: 20_000 });
    await step1!.done;
    expect(started).toHaveLength(2);
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: jobId } })).status).not.toBe("succeeded");

    // Step 2: OpenAI has finished; the next step only collects them.
    ready = true;
    const step2 = await startDeferredJob(await db.generationJob.findUniqueOrThrow({ where: { id: jobId } }), { budgetMs: 20_000 });
    await step2!.done;
    const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    expect({ status: job.status, error: job.error }).toEqual({ status: "succeeded", error: null });
    expect(started).toHaveLength(2); // nothing was started twice

    const deck = JSON.parse((await getFiles(project.id)).find((f) => f.path === "deck.json")!.content);
    const images = deck.slides.map((s: { cine: { image: string } }) => s.cine.image).filter(Boolean);
    expect(images).toEqual([`/deckmedia/${project.id}/imageresp_1abcdef.webp`, `/deckmedia/${project.id}/imageresp_2abcdef.webp`]);
  }, 90_000);
});
