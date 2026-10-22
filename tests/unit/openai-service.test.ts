import { afterEach, beforeAll, describe, expect, it } from "vitest";
import OpenAI from "openai";
import { z } from "zod";
import { OpenAITextProvider, mapOpenAIError, openaiClient, resetOpenAIClient } from "@/server/ai/openai-provider";
import { AIError } from "@/server/ai/types";
import { db } from "@/server/db/client";
import { resetEnvCache } from "@/server/env";

/**
 * The real OpenAI SDK is used with a scripted `fetch`, so request building,
 * SSE parsing, structured-output parsing, retries and error classes are all
 * exercised. No network access and no API key are needed.
 */

const Schema = z.object({ title: z.string(), count: z.number() });
let userId = "";

function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((e, i) => `event: ${e.type}\ndata: ${JSON.stringify({ ...e, sequence_number: i })}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": "req_test_123" } });
}

function responseEvents(text: string, opts: { status?: "completed" | "incomplete"; refusal?: string } = {}) {
  const base = { id: "resp_test_1", object: "response", created_at: 1, model: "test-model", parallel_tool_calls: true, tool_choice: "auto", tools: [], incomplete_details: null, error: null, instructions: null, metadata: {}, temperature: 1, top_p: 1, output_text: "" };
  const part = opts.refusal ? { type: "refusal", refusal: opts.refusal } : { type: "output_text", text, annotations: [] };
  const message = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [part] };
  const final = {
    ...base,
    status: opts.status ?? "completed",
    incomplete_details: opts.status === "incomplete" ? { reason: "max_output_tokens" } : null,
    output: [message],
    usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 150 },
  };
  return [
    { type: "response.created", response: { ...base, status: "in_progress", output: [], usage: null } },
    { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
    { type: "response.content_part.added", item_id: "msg_1", output_index: 0, content_index: 0, part: opts.refusal ? { type: "refusal", refusal: "" } : { type: "output_text", text: "", annotations: [] } },
    ...(opts.refusal
      ? [{ type: "response.refusal.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: opts.refusal }, { type: "response.refusal.done", item_id: "msg_1", output_index: 0, content_index: 0, refusal: opts.refusal }]
      : [
          { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: text, logprobs: [] },
          { type: "response.output_text.done", item_id: "msg_1", output_index: 0, content_index: 0, text, logprobs: [] },
        ]),
    { type: "response.content_part.done", item_id: "msg_1", output_index: 0, content_index: 0, part },
    { type: "response.output_item.done", output_index: 0, item: message },
    { type: opts.status === "incomplete" ? "response.incomplete" : "response.completed", response: final },
  ];
}

function clientWith(handler: (url: string, body: Record<string, unknown>) => Response | Promise<Response>, calls?: Record<string, unknown>[]) {
  return new OpenAI({
    apiKey: "sk-test",
    maxRetries: 2,
    fetch: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      calls?.push(body);
      return handler(String(url), body);
    }) as unknown as typeof fetch,
  });
}

const req = (over: Partial<Parameters<OpenAITextProvider["structured"]>[0]> = {}) => ({
  operation: "test.op",
  schema: Schema,
  schemaName: "test_schema",
  system: "system prompt",
  input: "user input",
  userId,
  ...over,
});

beforeAll(async () => {
  userId = (await db.user.create({ data: { email: `oa${Date.now()}@t.local`, name: "T", passwordHash: "x" } })).id;
});
afterEach(() => {
  resetOpenAIClient();
  resetEnvCache();
});

describe("OpenAI service (Responses API)", () => {
  it("sends a strict JSON-schema request and returns validated, typed output with usage", async () => {
    const calls: Record<string, unknown>[] = [];
    const progress: number[] = [];
    const p = new OpenAITextProvider("test-model", clientWith(() => sse(responseEvents(JSON.stringify({ title: "Solar", count: 8 }) + " ".repeat(500))), calls));
    const r = await p.structured(req({ onProgress: (c) => progress.push(c) }));
    expect(r.data).toEqual({ title: "Solar", count: 8 });
    expect(r.usage).toMatchObject({ provider: "openai", model: "test-model", requestId: "resp_test_1", inputTokens: 120, outputTokens: 30, totalTokens: 150 });
    expect(progress.length).toBeGreaterThan(0);
    const body = calls[0] as { model: string; instructions: string; stream: boolean; store: boolean; text: { format: { type: string; strict: boolean; name: string } } };
    expect(body).toMatchObject({ model: "test-model", instructions: "system prompt", stream: true, store: false });
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true, name: "test_schema" });
    const rec = await db.usageRecord.findFirst({ where: { userId, operation: "test.op", success: true } });
    expect(rec).toMatchObject({ requestId: "resp_test_1", inputTokens: 120, outputTokens: 30 });
  });

  it("estimates cost when pricing is configured", async () => {
    process.env.OPENAI_PRICE_INPUT_PER_1M = "2";
    process.env.OPENAI_PRICE_OUTPUT_PER_1M = "8";
    resetEnvCache();
    const p = new OpenAITextProvider("test-model", clientWith(() => sse(responseEvents(JSON.stringify({ title: "x", count: 1 })))));
    const r = await p.structured(req());
    expect(r.usage.estimatedCostUsd).toBeCloseTo((120 / 1e6) * 2 + (30 / 1e6) * 8, 10);
    delete process.env.OPENAI_PRICE_INPUT_PER_1M;
    delete process.env.OPENAI_PRICE_OUTPUT_PER_1M;
  });

  it("rejects output that fails schema validation", async () => {
    const p = new OpenAITextProvider("test-model", clientWith(() => sse(responseEvents(JSON.stringify({ title: "x", count: "many" })))));
    await expect(p.structured(req())).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_OUTPUT|UPSTREAM/) });
    const rec = await db.usageRecord.findFirst({ where: { userId, success: false }, orderBy: { createdAt: "desc" } });
    expect(rec?.success).toBe(false);
  });

  it("reports truncated (incomplete) output as TRUNCATED", async () => {
    const p = new OpenAITextProvider("test-model", clientWith(() => sse(responseEvents('{"title":"x","co', { status: "incomplete" }))));
    await expect(p.structured(req())).rejects.toMatchObject({ code: "TRUNCATED" });
  });

  it("reports refusals", async () => {
    const p = new OpenAITextProvider("test-model", clientWith(() => sse(responseEvents("", { refusal: "I can't help with that." }))));
    await expect(p.structured(req())).rejects.toMatchObject({ code: "REFUSED" });
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    let n = 0;
    const p = new OpenAITextProvider(
      "test-model",
      clientWith(() => {
        n++;
        if (n === 1) return new Response(JSON.stringify({ error: { message: "Rate limit reached", type: "rate_limit" } }), { status: 429, headers: { "retry-after-ms": "10", "content-type": "application/json" } });
        if (n === 2) return new Response(JSON.stringify({ error: { message: "server error" } }), { status: 500, headers: { "retry-after-ms": "10", "content-type": "application/json" } });
        return sse(responseEvents(JSON.stringify({ title: "ok", count: 2 })));
      }),
    );
    const r = (await p.structured(req())) as { data: z.infer<typeof Schema> };
    expect(r.data.title).toBe("ok");
    expect(n).toBe(3);
  });

  it("maps authentication, quota and bad-request failures to safe errors", async () => {
    const fail = (status: number, message: string) =>
      new OpenAITextProvider("test-model", clientWith(() => new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json", "retry-after-ms": "1" } })));
    await expect(fail(401, "Incorrect API key provided: sk-abc").structured(req())).rejects.toMatchObject({ code: "AUTH", retryable: false });
    const auth = (await fail(401, "Incorrect API key provided: sk-abc").structured(req()).catch((e: unknown) => e)) as AIError;
    expect(auth.message).not.toContain("sk-abc");
    await expect(fail(429, "You exceeded your current quota").structured(req())).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: false });
    await expect(fail(400, "Invalid schema").structured(req())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(fail(404, "model not found").structured(req())).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps timeouts and cancellation", () => {
    expect(mapOpenAIError(new OpenAI.APIConnectionTimeoutError()).code).toBe("TIMEOUT");
    expect(mapOpenAIError(new OpenAI.APIUserAbortError()).code).toBe("CANCELLED");
  });

  it("refuses to run without configuration", () => {
    process.env.OPENAI_API_KEY = "";
    process.env.OPENAI_MODEL = "";
    resetEnvCache();
    expect(() => new OpenAITextProvider()).toThrow(/OPENAI_MODEL/);
    expect(() => openaiClient()).toThrow(/OPENAI_API_KEY/);
  });
});
