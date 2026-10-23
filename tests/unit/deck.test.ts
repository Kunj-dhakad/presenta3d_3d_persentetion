import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { startJob } from "@/server/jobs/runner";
import { runDeckPipeline } from "@/server/deck/pipeline";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { MockTextProvider } from "@/server/ai/mock-provider";
import { createProject, getFiles } from "@/server/services/projects";
import { runWorker } from "@/server/build/worker-process";
import { sampleDeck, type DeckSpec } from "@/lib/schemas/deck";
import type { PipelineResult } from "@/server/pipeline/generate";
import type { BuildDiagnostic } from "@/lib/build-types";
import { createUser, waitForJob } from "../support/helpers";

async function run(userId: string, projectId: string, prompt: string) {
  const conv = await db.conversation.findFirst({ where: { projectId } }) ?? (await db.conversation.create({ data: { userId, projectId, title: prompt } }));
  await db.chatMessage.create({ data: { conversationId: conv.id, role: "user", content: prompt } });
  const provider = new MockTextProvider();
  const jobId = await startJob({ userId, projectId, kind: "project-generate", provider: provider.name, input: {} }, (ctx) =>
    runDeckPipeline(ctx, provider, { userId, projectId, conversationId: conv.id, prompt, mode: "auto" }),
  );
  const job = await waitForJob(jobId, 120_000);
  return { job, result: job.output as unknown as PipelineResult };
}

describe("3D presentation generation", () => {
  it("produces a project that builds in the isolated worker with no errors", async () => {
    const files = deckToProjectFiles(sampleDeck("Build check"));
    expect(files.map((f) => f.path)).toEqual(["index.html", "style.css", "deck.json", "main.js"]);
    const r = await runWorker<{ ok: boolean; errors: BuildDiagnostic[] }>({ mode: "project", framework: "three", files, runtimeBase: "/preview-runtime/test" }, { timeoutMs: 60_000 });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("escapes the deck title in HTML", () => {
    const html = deckToProjectFiles({ ...sampleDeck(), title: `<script>alert(1)</script>` })[0].content;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("creates a deck from chat, then edits only what was asked", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Untitled presentation", category: "presentation", framework: "three" });
    const first = await run(u.id, p.id, "Ocean conservation for a school assembly");
    expect(first.job.status).toBe("succeeded");
    expect(first.result.buildStatus).toBe("succeeded");
    // The presentation is shown as soon as its text is ready, then rebuilt with the custom scenes.
    const events = first.job.events as { type: string; status?: string }[];
    expect(events.filter((e) => e.type === "build" && e.status === "succeeded")).toHaveLength(2);
    expect((await getFiles(p.id)).some((f) => f.path === "scenes/slide-1.js")).toBe(true);
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(project.name).toContain("Ocean conservation");
    expect(project.category).toBe("presentation");
    expect(project.lastWorkingVersionId).toBe(first.result.postVersionId);
    const deck1 = JSON.parse((await getFiles(p.id)).find((f) => f.path === "deck.json")!.content) as DeckSpec;

    const second = await run(u.id, p.id, 'Change the title of slide 2 to "Why the ocean matters"');
    expect(second.result.buildStatus).toBe("succeeded");
    expect(second.result.changedFiles).toEqual(["deck.json"]);
    const deck2 = JSON.parse((await getFiles(p.id)).find((f) => f.path === "deck.json")!.content) as DeckSpec;
    expect(deck2.slides[1].title).toBe("Why the ocean matters");
    expect(deck2.slides.filter((_, i) => i !== 1)).toEqual(deck1.slides.filter((_, i) => i !== 1));
    // The pre-edit checkpoint still holds the original title, so the edit can be undone.
    const pre = await db.projectVersion.findUniqueOrThrow({ where: { id: second.result.preVersionId! } });
    expect(JSON.stringify(pre.files)).toContain(deck1.slides[1].title);
  });
});
