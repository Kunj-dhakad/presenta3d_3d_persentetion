import "server-only";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import type { Usage } from "./types";

export function estimateCost(inputTokens: number | null, outputTokens: number | null): number | null {
  const e = env();
  if (e.OPENAI_PRICE_INPUT_PER_1M === undefined || e.OPENAI_PRICE_OUTPUT_PER_1M === undefined) return null;
  if (inputTokens === null || outputTokens === null) return null;
  return (inputTokens / 1e6) * e.OPENAI_PRICE_INPUT_PER_1M + (outputTokens / 1e6) * e.OPENAI_PRICE_OUTPUT_PER_1M;
}

export async function recordUsage(input: {
  userId: string;
  jobId?: string;
  operation: string;
  usage: Usage;
  success: boolean;
  errorCode?: string;
}) {
  try {
    await db.usageRecord.create({
      data: {
        userId: input.userId,
        jobId: input.jobId ?? null,
        provider: input.usage.provider,
        model: input.usage.model,
        operation: input.operation,
        requestId: input.usage.requestId,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        totalTokens: input.usage.totalTokens,
        latencyMs: input.usage.latencyMs,
        estimatedCostUsd: input.usage.estimatedCostUsd,
        success: input.success,
        errorCode: input.errorCode ?? null,
      },
    });
  } catch (err) {
    console.error("[usage] failed to record usage", err instanceof Error ? err.message : "");
  }
}
