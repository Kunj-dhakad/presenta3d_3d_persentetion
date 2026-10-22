import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OpenAITextProvider } from "@/server/ai/openai-provider";
import { db } from "@/server/db/client";
import { startJob } from "@/server/jobs/runner";
import { runProjectPipeline, type PipelineResult } from "@/server/pipeline/generate";
import { createProject, getFiles } from "@/server/services/projects";
import { createUser, waitForJob } from "../support/helpers";

const configured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);

describe.skipIf(!configured)("live OpenAI integration (uses your API key)", () => {
  it("returns schema-valid structured output with usage", async () => {
    const u = await createUser();
    const p = new OpenAITextProvider();
    const r = await p.structured({
      operation: "live.smoke",
      schema: z.object({ answer: z.number(), unit: z.string() }),
      schemaName: "smoke",
      system: "Answer precisely.",
      input: "How many sides does a hexagon have? unit should be 'sides'.",
      maxOutputTokens: 2000,
      userId: u.id,
    });
    expect(r.data.answer).toBe(6);
    expect(r.usage.requestId).toBeTruthy();
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });

  it("generates, builds and edits a real project end to end", async () => {
    const u = await createUser();
    const project = await createProject(u.id, { name: "Untitled project", category: "website", framework: "vanilla" });
    const provider = new OpenAITextProvider();
    const go = async (prompt: string) => {
      const conv = await db.conversation.create({ data: { userId: u.id, projectId: project.id, title: prompt } });
      const id = await startJob({ userId: u.id, projectId: project.id, kind: "project-generate", provider: "openai", input: {} }, (ctx) =>
        runProjectPipeline(ctx, provider, { userId: u.id, projectId: project.id, conversationId: conv.id, prompt, mode: "auto" }),
      );
      const job = await waitForJob(id, 290_000);
      expect(job.error).toBeNull();
      return job.output as unknown as PipelineResult;
    };
    const first = await go("Build a small interactive three.js scene with a rotating glowing torus knot, orbit controls and a title overlay.");
    expect(first.buildStatus).toBe("succeeded");
    expect((await getFiles(project.id)).length).toBeGreaterThanOrEqual(2);
    const second = await go("Change the title overlay text to 'Strata Live Test'.");
    expect(second.buildStatus).toBe("succeeded");
    expect((await getFiles(project.id)).some((f) => f.content.includes("Strata Live Test"))).toBe(true);
  });
});
