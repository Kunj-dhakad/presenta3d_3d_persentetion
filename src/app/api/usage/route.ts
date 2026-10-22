import { db } from "@/server/db/client";
import { api } from "@/server/http/api";

export const GET = api(async ({ user }) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const records = await db.usageRecord.findMany({ where: { userId: user.id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 500 });
  const totals = { requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costKnown: false, latencyMs: 0 };
  for (const r of records) {
    totals.requests++;
    if (!r.success) totals.failures++;
    totals.inputTokens += r.inputTokens ?? 0;
    totals.outputTokens += r.outputTokens ?? 0;
    if (r.estimatedCostUsd !== null) {
      totals.estimatedCostUsd += r.estimatedCostUsd;
      totals.costKnown = true;
    }
    totals.latencyMs += r.latencyMs;
  }
  return {
    totals: { ...totals, avgLatencyMs: totals.requests ? Math.round(totals.latencyMs / totals.requests) : 0 },
    records: records.slice(0, 50).map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      provider: r.provider,
      model: r.model,
      operation: r.operation,
      requestId: r.requestId,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      latencyMs: r.latencyMs,
      estimatedCostUsd: r.estimatedCostUsd,
      success: r.success,
      errorCode: r.errorCode,
    })),
  };
});
