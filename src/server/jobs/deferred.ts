import "server-only";
import { z } from "zod";
import { db } from "@/server/db/client";
import { getTextProvider } from "@/server/ai/provider";
import { runDeckPipeline } from "@/server/deck/pipeline";
import { runCinePipeline } from "@/server/deck/cine-pipeline";
import { claimJob, type RunOutcome } from "./runner";

/** Everything a deferred deck job needs, persisted in GenerationJob.input. */
export const DeckJobInput = z.object({
  runner: z.literal("deck"),
  prompt: z.string(),
  mode: z.enum(["auto", "repair"]),
  conversationId: z.string(),
  runtimeErrors: z.array(z.string()).optional(),
  draftName: z.string().optional(),
  /** The OpenAI model chosen in the chat (missing: OPENAI_MODEL). */
  model: z.string().optional(),
  startedAt: z.string(),
});
export type DeckJobInput = z.infer<typeof DeckJobInput>;

type JobRow = { id: string; userId: string; projectId: string | null; status: string; input: unknown };

/**
 * Claim the next step of an unfinished deferred job (queued, between steps, or
 * whose step was cut off) and run it in this process. Returns `{ done }`
 * (resolves to "continue" when more steps are needed) when this call started
 * a step, otherwise null.
 */
export async function startDeferredJob(job: JobRow, opts: { budgetMs?: number } = {}): Promise<{ done: Promise<RunOutcome> } | null> {
  if ((job.status !== "queued" && job.status !== "running") || !job.projectId) return null;
  const parsed = DeckJobInput.safeParse(job.input);
  if (!parsed.success) return null;
  const input = parsed.data;
  const projectId = job.projectId;
  return claimJob(job.id, async (ctx) => {
    const provider = getTextProvider(input.model);
    // Cinematic presentations (framework "cinematic", set when they are created) have their own pipeline.
    const project = await db.project.findUnique({ where: { id: projectId }, select: { framework: true } });
    const run = project?.framework === "cinematic" ? runCinePipeline : runDeckPipeline;
    return run(ctx, provider, {
      userId: job.userId,
      projectId,
      conversationId: input.conversationId,
      prompt: input.prompt,
      mode: input.mode,
      runtimeErrors: input.runtimeErrors,
      draftName: input.draftName,
    }).catch(async (err) => {
      // Cancelled, or taken over by another step after this instance was frozen: nothing to report here.
      if (ctx.signal.aborted) throw err;
      // Record the failure in the conversation so it is visible after reload.
      const message = err instanceof Error ? err.message : "Generation failed";
      const pre = await db.projectVersion.findFirst({
        where: { projectId, kind: "pre-ai", createdAt: { gte: new Date(input.startedAt) } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      await db.chatMessage
        .create({ data: { conversationId: input.conversationId, role: "assistant", content: `Generation failed: ${message}`, meta: { jobId: ctx.jobId, error: true, preVersionId: pre?.id ?? null } } })
        .catch(() => {});
      throw err;
    });
  }, opts);
}
