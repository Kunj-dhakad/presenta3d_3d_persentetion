import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "@/server/env";
import { AIError, type StructuredRequest, type StructuredResult, type TextModelProvider, type Usage } from "./types";
import { estimateCost, recordUsage } from "./usage";

let client: OpenAI | null = null;

/** Shared, lazily created SDK client. Throws NOT_CONFIGURED if the key is missing. */
export function openaiClient(): OpenAI {
  const e = env();
  if (!e.OPENAI_API_KEY) throw new AIError("NOT_CONFIGURED", "OpenAI is not configured. Set OPENAI_API_KEY on the server.");
  if (!client) {
    client = new OpenAI({
      apiKey: e.OPENAI_API_KEY,
      baseURL: e.OPENAI_BASE_URL,
      timeout: e.OPENAI_TIMEOUT_MS,
      maxRetries: 2, // SDK retries 408/409/429/5xx and connection errors with backoff
    });
  }
  return client;
}

export function resetOpenAIClient() {
  client = null;
}

/** Map SDK errors to provider-neutral errors without leaking request payloads. */
export function mapOpenAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new AIError("CANCELLED", "Request cancelled");
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new AIError("TIMEOUT", "OpenAI request timed out", true);
  if (err instanceof OpenAI.APIConnectionError) return new AIError("UPSTREAM", "Could not reach OpenAI", true);
  if (err instanceof OpenAI.RateLimitError) {
    const quota = /quota/i.test(err.message);
    return new AIError("RATE_LIMITED", quota ? "OpenAI quota exceeded for this API key" : "OpenAI rate limit reached; try again shortly", !quota, err.requestID ?? null);
  }
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
    return new AIError("AUTH", "OpenAI rejected the API key or the key lacks access to this model", false, err.requestID ?? null);
  }
  if (err instanceof OpenAI.NotFoundError) return new AIError("BAD_REQUEST", "The configured OpenAI model was not found or is not available to this key", false, err.requestID ?? null);
  if (err instanceof OpenAI.BadRequestError) return new AIError("BAD_REQUEST", `OpenAI rejected the request: ${err.message.slice(0, 300)}`, false, err.requestID ?? null);
  if (err instanceof OpenAI.APIError) return new AIError("UPSTREAM", `OpenAI error (${err.status ?? "?"})`, (err.status ?? 500) >= 500, err.requestID ?? null);
  if (err instanceof Error && err.name === "AbortError") return new AIError("CANCELLED", "Request cancelled");
  return new AIError("UPSTREAM", err instanceof Error ? err.message.slice(0, 300) : "Unknown OpenAI error");
}

export class OpenAITextProvider implements TextModelProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly client: OpenAI | null;

  /** `client` is injectable for tests; production uses the shared configured client. */
  constructor(model?: string, client?: OpenAI) {
    const m = model ?? env().OPENAI_MODEL;
    if (!m) throw new AIError("NOT_CONFIGURED", "OPENAI_MODEL is not set on the server.");
    this.model = m;
    this.client = client ?? null;
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
    const started = Date.now();
    const usage: Usage = {
      provider: this.name,
      model: this.model,
      requestId: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      latencyMs: 0,
      estimatedCostUsd: null,
    };
    try {
      const stream = (this.client ?? openaiClient()).responses.stream(
        {
          model: this.model,
          instructions: req.system,
          input: req.input,
          max_output_tokens: req.maxOutputTokens ?? 32_000,
          text: { format: zodTextFormat(req.schema, req.schemaName) },
          store: false,
        },
        { signal: req.signal },
      );
      let chars = 0;
      let lastEmit = 0;
      for await (const event of stream) {
        if (event.type === "response.created") usage.requestId = event.response.id;
        else if (event.type === "response.output_text.delta") {
          chars += event.delta.length;
          if (req.onProgress && chars - lastEmit > 400) {
            lastEmit = chars;
            req.onProgress(chars);
          }
        }
      }
      const response = await stream.finalResponse();
      usage.requestId = usage.requestId ?? response.id;
      usage.inputTokens = response.usage?.input_tokens ?? null;
      usage.outputTokens = response.usage?.output_tokens ?? null;
      usage.totalTokens = response.usage?.total_tokens ?? null;
      usage.latencyMs = Date.now() - started;
      usage.estimatedCostUsd = estimateCost(usage.inputTokens, usage.outputTokens);

      if (response.status === "incomplete") {
        const reason = response.incomplete_details?.reason ?? "unknown";
        throw new AIError(reason === "max_output_tokens" ? "TRUNCATED" : "INVALID_OUTPUT", `Model output was incomplete (${reason})`, true, usage.requestId);
      }
      for (const item of response.output) {
        if (item.type === "message") {
          for (const c of item.content) if (c.type === "refusal") throw new AIError("REFUSED", `The model declined: ${c.refusal.slice(0, 300)}`, false, usage.requestId);
        }
      }
      // Validate again with our own schema; never trust parsed output blindly.
      const checked = req.schema.safeParse(response.output_parsed);
      if (!checked.success) {
        const first = checked.error.issues[0];
        throw new AIError("INVALID_OUTPUT", `Model output failed validation at ${first?.path.join(".") || "root"}: ${first?.message ?? ""}`, true, usage.requestId);
      }
      await recordUsage({ userId: req.userId, jobId: req.jobId, operation: req.operation, usage, success: true });
      return { data: checked.data, usage };
    } catch (err) {
      const mapped = err instanceof AIError ? err : mapOpenAIError(err);
      usage.latencyMs = Date.now() - started;
      await recordUsage({ userId: req.userId, jobId: req.jobId, operation: req.operation, usage, success: false, errorCode: mapped.code });
      throw mapped;
    }
  }
}
