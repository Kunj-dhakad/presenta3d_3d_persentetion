import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { db } from "@/server/db/client";
import { startJob } from "@/server/jobs/runner";
import { runProjectPipeline, type PipelineResult } from "@/server/pipeline/generate";
import { MockTextProvider } from "@/server/ai/mock-provider";
import { createProject, getFiles } from "@/server/services/projects";
import { previewBuildDir } from "@/server/build/builder";
import { AIError, type TextModelProvider } from "@/server/ai/types";
import type { JobEvent } from "@/lib/jobs";
import { createUser, waitForJob } from "../support/helpers";

async function run(provider: TextModelProvider, userId: string, projectId: string, prompt: string, mode: "auto" | "repair" = "auto", runtimeErrors?: string[]) {
  const conv = await db.conversation.create({ data: { userId, projectId, title: prompt } });
  await db.chatMessage.create({ data: { conversationId: conv.id, role: "user", content: prompt } });
  const jobId = await startJob({ userId, projectId, kind: "project-generate", provider: provider.name, input: {} }, (ctx) =>
    runProjectPipeline(ctx, provider, { userId, projectId, conversationId: conv.id, prompt, mode, runtimeErrors }),
  );
  const job = await waitForJob(jobId, 120_000);
  return { job, result: job.output as unknown as PipelineResult, events: (job.events ?? []) as unknown as JobEvent[] };
}

describe("project generation pipeline (offline test provider + real build worker)", () => {
  it("generates a validated multi-file project, builds it and checkpoints it", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Untitled project", category: "website", framework: "vanilla" });
    const { job, result, events } = await run(new MockTextProvider(), u.id, p.id, "Build a solar system scene with orbiting planets");
    expect(job.status).toBe("succeeded");
    expect(result.buildStatus).toBe("succeeded");
    expect(result.changedFiles.sort()).toEqual(["index.html", "main.js", "style.css"]);
    const files = await getFiles(p.id);
    expect(files.find((f) => f.path === "main.js")?.content).toContain('from "three"');
    // Real build output exists on disk and the version is marked as the last working one.
    expect(fs.existsSync(`${previewBuildDir(result.buildId!)}/index.html`)).toBe(true);
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(project.framework).toBe("three");
    expect(project.lastWorkingVersionId).toBe(result.postVersionId);
    // Progress is reported from real events, in order.
    const stages = events.filter((e) => e.type === "stage" && e.state === "done").map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(["understand", "plan", "generate", "review", "build", "finalize"]);
    expect(events.some((e) => e.type === "task")).toBe(true);
    const msg = await db.chatMessage.findFirstOrThrow({ where: { id: result.assistantMessageId } });
    expect(msg.role).toBe("assistant");
  });

  it("edits an existing project with a targeted patch and keeps a pre-change checkpoint", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Untitled project", category: "website", framework: "vanilla" });
    await run(new MockTextProvider(), u.id, p.id, "A simple landing page");
    const before = await getFiles(p.id);
    const { result } = await run(new MockTextProvider(), u.id, p.id, 'Change the heading text to "Hello Strata"');
    expect(result.changedFiles).toEqual(["index.html"]);
    const after = await getFiles(p.id);
    expect(after.find((f) => f.path === "index.html")?.content).toContain('<h1 id="title">Hello Strata</h1>');
    // Untouched files are byte-identical.
    expect(after.find((f) => f.path === "app.js")).toEqual(before.find((f) => f.path === "app.js"));
    const pre = await db.projectVersion.findUniqueOrThrow({ where: { id: result.preVersionId! } });
    expect(JSON.stringify(pre.files)).not.toContain("Hello Strata");
  });

  it("repairs a failing build automatically (bounded) and reports it honestly", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Untitled project", category: "website", framework: "vanilla" });
    const { result, events } = await run(new MockTextProvider(), u.id, p.id, "A landing page [simulate-build-error]");
    const builds = events.filter((e) => e.type === "build") as Extract<JobEvent, { type: "build" }>[];
    expect(builds.map((b) => b.status)).toEqual(["failed", "succeeded"]);
    expect(builds[0].errors[0].message).toMatch(/left-pad/);
    expect(result.buildStatus).toBe("succeeded");
    expect(result.summary).toMatch(/1 repair pass/);
    expect((await getFiles(p.id)).find((f) => f.path === "app.js")?.content).not.toContain("left-pad");
  });

  it("keeps the last working build when repairs cannot fix the project", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Untitled project", category: "website", framework: "vanilla" });
    const first = await run(new MockTextProvider(), u.id, p.id, "A landing page");
    const workingBuild = first.result.buildId;
    // A provider whose edits always break the build and whose repairs change nothing.
    const breaking: TextModelProvider = {
      name: "test-breaking",
      model: "x",
      async structured(req) {
        const out =
          req.schemaName === "edit_plan"
            ? { understanding: "u", summary: "break it", targets: [{ path: "app.js", action: "modify", instructions: "x" }], packages: [] }
            : req.schemaName === "edit_operations"
              ? { operations: [{ path: "app.js", operation: "replace", content: 'import x from "not-allowed-pkg";\n', patches: [], explanation: "" }], dependencies: [], validation: [], complete: true }
              : { operations: [], dependencies: [], validation: [], complete: true };
        return { data: req.schema.parse(out), usage: { provider: "t", model: "x", requestId: null, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: 0, estimatedCostUsd: null } };
      },
    };
    const { result } = await run(breaking, u.id, p.id, "break the app");
    expect(result.buildStatus).toBe("failed");
    expect(result.summary).toMatch(/still fails after 2 repair attempts/);
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(project.lastWorkingBuildId).toBe(workingBuild);
    expect(project.lastWorkingVersionId).toBe(first.result.postVersionId);
    expect(result.preVersionId).toBeTruthy();
  });

  it("fails the job with the provider's error and records it", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Untitled project", category: "website", framework: "vanilla" });
    const failing: TextModelProvider = {
      name: "test-failing",
      model: "x",
      async structured() {
        throw new AIError("RATE_LIMITED", "OpenAI quota exceeded for this API key");
      },
    };
    const { job } = await run(failing, u.id, p.id, "anything");
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/quota exceeded/);
    expect(await getFiles(p.id)).toEqual([]);
  });

  it("repairs runtime errors reported by the preview", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Untitled project", category: "website", framework: "vanilla" });
    await run(new MockTextProvider(), u.id, p.id, "A landing page");
    const { result, events } = await run(new MockTextProvider(), u.id, p.id, "fix", "repair", ["runtime-error: x is not defined (app.js:3)"]);
    expect(events.some((e) => e.type === "stage" && e.stage === "repair")).toBe(true);
    expect(result.buildStatus).toBe("succeeded");
  });
});
