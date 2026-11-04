import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { createDeferredJob } from "@/server/jobs/runner";
import { startDeferredJob } from "@/server/jobs/deferred";
import { createProject, getFiles } from "@/server/services/projects";
import { storage } from "@/server/storage/storage";
import type { DeckSpec } from "@/lib/schemas/deck";
import { createUser } from "../support/helpers";

const configured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
/** The live server's step budget (JOB_STEP_BUDGET_MS default): every step is cut off like there. */
const STEP_MS = 45_000;

describe.skipIf(!configured)("live cinematic generation (uses your API key, paints real images)", () => {
  it("writes the slides and paints every image, in production-sized job steps", async () => {
    const user = await createUser();
    const project = await createProject(user.id, { name: "Untitled presentation", category: "presentation", framework: "cinematic" });
    const conversation = await db.conversation.create({ data: { userId: user.id, projectId: project.id, title: "live" } });
    const prompt = "Use 4 slides. Tone: friendly.\n\nOnboarding guide for new employees";
    const jobId = await createDeferredJob({
      userId: user.id,
      projectId: project.id,
      kind: "project-generate",
      provider: "openai",
      input: { runner: "deck", prompt, mode: "auto", conversationId: conversation.id, startedAt: new Date().toISOString() },
    });

    const t0 = Date.now();
    let seen = 0;
    const show = (events: { type: string; message?: string; level?: string; stage?: string; state?: string; detail?: string }[]) => {
      for (const e of events.slice(seen)) {
        if (e.type === "log") console.log(`   ${e.level === "warn" ? "⚠ " : "  "}${e.message}`);
        if (e.type === "stage") console.log(`   ▸ ${e.stage} ${e.state}${e.detail ? ` · ${e.detail}` : ""}`);
      }
      seen = events.length;
    };
    let job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    for (let step = 1; !["succeeded", "failed", "cancelled"].includes(job.status); step++) {
      if (step > 10) throw new Error(`still ${job.status} after 10 steps`);
      console.log(`\n── step ${step} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      const run = await startDeferredJob(job, { budgetMs: STEP_MS });
      expect(run, "the step should be claimed").not.toBeNull();
      const outcome = await run!.done;
      job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      show((job.events as typeof events) ?? []);
      console.log(`   → ${outcome} · job ${job.status}${job.error ? ` · ${job.error}` : ""}`);
    }
    const events = (job.events as { type: string }[]) ?? [];
    void events;

    expect({ status: job.status, error: job.error }).toEqual({ status: "succeeded", error: null });
    const deck = JSON.parse((await getFiles(project.id)).find((f) => f.path === "deck.json")!.content) as DeckSpec;
    expect(deck.style).toBe("cinematic");
    const wanted = deck.slides.filter((s) => s.cine?.imagePrompt).length;
    const images = deck.slides.map((s) => s.cine!.image).filter(Boolean);
    console.log(`\n${images.length}/${wanted} images painted in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const url of images) {
      const bytes = await storage().get(url.slice(1));
      console.log(`   ${url} · ${bytes ? `${(bytes.byteLength / 1024).toFixed(0)} KB` : "MISSING"}`);
      expect(bytes?.byteLength ?? 0).toBeGreaterThan(10_000);
    }
    expect(images.length).toBe(wanted);
    const reply = await db.chatMessage.findFirst({ where: { conversationId: conversation.id, role: "assistant" }, orderBy: { createdAt: "desc" } });
    console.log(`   reply: ${reply?.content}`);
  }, 600_000);
});
