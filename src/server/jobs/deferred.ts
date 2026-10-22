import "server-only";
import { z } from "zod";
import { db } from "@/server/db/client";
import { getTextProvider } from "@/server/ai/provider";
import { runDeckPipeline } from "@/server/deck/pipeline";
import { claimJob } from "./runner";

/** Everything a deferred deck job needs, persisted in GenerationJob.input. */
export const DeckJobInput = z.object({
  runner: z.literal("deck"),
  prompt: z.string(),
  mode: z.enum(["auto", "repair"]),
  conversationId: z.string(),
  runtimeErrors: z.array(z.string()).optional(),
  startedAt: z.string(),
});
export type DeckJobInput = z.infer<typeof DeckJobInput>;

type JobRow = { id: string; userId: string; projectId: string | null; status: string; input: unknown };

/**
 * If `job` is a queued deferred job, claim it and run it in this process.
 * Returns `{ done }` when this call started it, otherwise null.
 */
export async function startDeferredJob(job: JobRow): Promise<{ done: Promise<void> } | null> {
  if (job.status !== "queued" || !job.projectId) return null;
  const parsed = DeckJobInput.safeParse(job.input);
  if (!parsed.success) return null;
  const input = parsed.data;
  const projectId = job.projectId;
  return claimJob(job.id, async (ctx) => {
    const provider = getTextProvider();
    return runDeckPipeline(ctx, provider, {
      userId: job.userId,
      projectId,
      conversationId: input.conversationId,
      prompt: input.prompt,
      mode: input.mode,
      runtimeErrors: input.runtimeErrors,
    }).catch(async (err) => {
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
  });
}
