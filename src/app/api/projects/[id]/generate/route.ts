import { z } from "zod";
import { db } from "@/server/db/client";
import { api, HttpError, readJson } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { getTextProvider } from "@/server/ai/provider";
import { AIError } from "@/server/ai/types";
import { activeProjectJob, startJob } from "@/server/jobs/runner";
// Presentation mode: chat generates 3D presentations (DeckSpec → presentation engine).
// The general code-generation pipeline (`runProjectPipeline` in @/server/pipeline/generate)
// is kept in the codebase but not wired to the UI in this simplified product.
import { runDeckPipeline } from "@/server/deck/pipeline";
import { env } from "@/server/env";

const Body = z.object({
  prompt: z.string().trim().min(1, "Describe what you want to build").max(8000, "Keep requests under 8,000 characters"),
  conversationId: z.string().max(40).nullable().optional(),
  mode: z.enum(["auto", "repair"]).default("auto"),
  runtimeErrors: z.array(z.string().max(2000)).max(20).optional(),
});

/**
 * Start a generation job for a project (create, edit, or repair). Returns
 * immediately with a job id; progress streams from /api/jobs/[id]/events.
 */
export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const project = await getOwnedProject(user.id, params.id);
    const body = await readJson(req, Body, 64 * 1024);

    let provider;
    try {
      provider = getTextProvider();
    } catch (err) {
      if (err instanceof AIError && err.code === "NOT_CONFIGURED") throw new HttpError(503, err.message, "AI_NOT_CONFIGURED");
      throw err;
    }
    if (await activeProjectJob(project.id)) throw new HttpError(409, "A generation is already running for this project", "JOB_RUNNING");

    let conversation = body.conversationId
      ? await db.conversation.findFirst({ where: { id: body.conversationId, userId: user.id, projectId: project.id } })
      : await db.conversation.findFirst({ where: { userId: user.id, projectId: project.id }, orderBy: { updatedAt: "desc" } });
    if (!conversation) {
      conversation = await db.conversation.create({ data: { userId: user.id, projectId: project.id, title: body.prompt.slice(0, 80) } });
    }
    const userMessage = await db.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: body.mode === "repair" ? `Fix the preview errors:\n${(body.runtimeErrors ?? []).slice(0, 5).join("\n")}`.slice(0, 4000) : body.prompt,
        meta: { mode: body.mode },
      },
    });

    const fileCount = await db.projectFile.count({ where: { projectId: project.id } });
    const kind = body.mode === "repair" ? "project-repair" : fileCount ? "project-edit" : "project-generate";
    const conversationId = conversation.id;
    const startedAt = new Date();
    const jobId = await startJob(
      { userId: user.id, projectId: project.id, kind, provider: provider.name, model: provider.model, input: { prompt: body.prompt.slice(0, 2000), mode: body.mode, conversationId } },
      (ctx) =>
        runDeckPipeline(ctx, provider, {
          userId: user.id,
          projectId: project.id,
          conversationId,
          prompt: body.prompt,
          mode: body.mode,
          runtimeErrors: body.runtimeErrors,
        }).catch(async (err) => {
          // Record the failure in the conversation so it is visible after reload.
          const message = err instanceof Error ? err.message : "Generation failed";
          const pre = await db.projectVersion.findFirst({
            where: { projectId: project.id, kind: "pre-ai", createdAt: { gte: startedAt } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          await db.chatMessage
            .create({ data: { conversationId, role: "assistant", content: `Generation failed: ${message}`, meta: { jobId: ctx.jobId, error: true, preVersionId: pre?.id ?? null } } })
            .catch(() => {});
          throw err;
        }),
    );
    await db.chatMessage.update({ where: { id: userMessage.id }, data: { meta: { mode: body.mode, jobId } } });
    return { jobId, conversationId, userMessageId: userMessage.id };
  },
  { rateLimit: { bucket: "generate", perMinute: () => env().GENERATION_RATE_LIMIT_PER_MIN } },
);
