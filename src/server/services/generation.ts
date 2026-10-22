import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db/client";
import { HttpError } from "@/server/http/errors";
import { getTextProvider } from "@/server/ai/provider";
import { AIError, type TextModelProvider } from "@/server/ai/types";
import { createDeferredJob } from "@/server/jobs/runner";
import type { DeckJobInput } from "@/server/jobs/deferred";

export type GenerationRequest = {
  prompt: string;
  mode: "auto" | "repair";
  conversationId?: string | null;
  runtimeErrors?: string[];
};

export function textProviderOrThrow(): TextModelProvider {
  try {
    return getTextProvider();
  } catch (err) {
    if (err instanceof AIError && err.code === "NOT_CONFIGURED") throw new HttpError(503, err.message, "AI_NOT_CONFIGURED");
    throw err;
  }
}

/**
 * Record the user's message and a deferred deck-generation job. The job runs
 * when the client calls /api/jobs/[id]/run (see createDeferredJob).
 * Independent writes run in parallel: on a remote database each one is a
 * network round trip.
 */
export async function startDeckGeneration(input: {
  userId: string;
  projectId: string;
  provider: TextModelProvider;
  request: GenerationRequest;
  /** The project has no files yet (skips a count query for new presentations). */
  isNew?: boolean;
}): Promise<{ jobId: string; conversationId: string; userMessageId: string }> {
  const { userId, projectId, provider, request } = input;
  const [conversationFound, fileCount] = await Promise.all([
    request.conversationId
      ? db.conversation.findFirst({ where: { id: request.conversationId, userId, projectId }, select: { id: true } })
      : input.isNew
        ? null
        : db.conversation.findFirst({ where: { userId, projectId }, orderBy: { updatedAt: "desc" }, select: { id: true } }),
    input.isNew ? 0 : db.projectFile.count({ where: { projectId } }),
  ]);
  const conversation = conversationFound ?? (await db.conversation.create({ data: { userId, projectId, title: request.prompt.slice(0, 80) }, select: { id: true } }));

  const kind = request.mode === "repair" ? "project-repair" : fileCount ? "project-edit" : "project-generate";
  const jobInput: DeckJobInput = {
    runner: "deck",
    prompt: request.prompt,
    mode: request.mode,
    conversationId: conversation.id,
    runtimeErrors: request.runtimeErrors,
    startedAt: new Date().toISOString(),
  };
  // The job id is chosen up front so the message and the job are written in parallel.
  const jobId = randomUUID().replace(/-/g, "");
  const content = request.mode === "repair" ? `Fix the preview errors:\n${(request.runtimeErrors ?? []).slice(0, 5).join("\n")}`.slice(0, 4000) : request.prompt;
  const [message] = await Promise.all([
    db.chatMessage.create({ data: { conversationId: conversation.id, role: "user", content, meta: { mode: request.mode, jobId } }, select: { id: true } }),
    createDeferredJob({ id: jobId, userId, projectId, kind, provider: provider.name, model: provider.model, input: jobInput }),
  ]);
  return { jobId, conversationId: conversation.id, userMessageId: message.id };
}
