import { describe, expect, it, vi } from "vitest";

// On the live server a job step is cut off after about a minute. Images start in a step with
// enough time; one that is cut off by the step's end is painted again in the next step.
const painted: { quality: string; round: number }[] = [];
let round = 0;
vi.mock("@/server/deck/cine-images", () => ({
  DEFAULT_IMAGE_MODEL: "gpt-image-2",
  ImagePainter: class {
    model = "fake-image-model";
    constructor(private projectId: string) {}
    async paint(prompt: string, quality: string, signal: AbortSignal) {
      painted.push({ quality, round });
      // Round 1: longer than the step (cut off); round 2: finishes.
      if (round === 1) {
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      return `/deckmedia/${this.projectId}/image${painted.length}abcdefgh.webp`;
    }
  },
}));

const { db } = await import("@/server/db/client");
const { createDeferredJob } = await import("@/server/jobs/runner");
const { startDeferredJob } = await import("@/server/jobs/deferred");
const { createProject, getFiles } = await import("@/server/services/projects");
const { createUser } = await import("../support/helpers");

describe("cinematic images across job steps", () => {
  it("starts every image at once in a fresh step, and paints one cut off by the step again in the next", async () => {
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
    const step = async () => {
      const run = await startDeferredJob(await db.generationJob.findUniqueOrThrow({ where: { id: jobId } }), { budgetMs: 20_000 });
      await run!.done;
      return db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    };

    // Step 1: the slides are written and shown; images wait for a step with enough time.
    expect((await step()).status).not.toBe("succeeded");
    expect(painted).toHaveLength(0);

    // Step 2: both images start together, but the step ends before they finish.
    round = 1;
    expect((await step()).status).not.toBe("succeeded");
    expect(painted).toEqual([{ quality: "medium", round: 1 }, { quality: "medium", round: 1 }]);

    // Step 3: painted again, both at once, and finished.
    round = 2;
    const job = await step();
    expect({ status: job.status, error: job.error }).toEqual({ status: "succeeded", error: null });
    expect(painted.slice(2)).toEqual([{ quality: "medium", round: 2 }, { quality: "medium", round: 2 }]);

    const deck = JSON.parse((await getFiles(project.id)).find((f) => f.path === "deck.json")!.content);
    const images = deck.slides.map((s: { cine: { image: string } }) => s.cine.image).filter(Boolean);
    expect(images).toHaveLength(2);
  }, 120_000);
});
