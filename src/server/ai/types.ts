import type { z } from "zod";

/**
 * Provider-neutral interface for text/structured generation. UI code never
 * imports a provider; pipelines depend on this interface only, so other
 * providers can be added without touching callers.
 */
export type StructuredRequest<T extends z.ZodType> = {
  operation: string;
  schema: T;
  schemaName: string;
  system: string;
  input: string;
  maxOutputTokens?: number;
  /** Reasoning effort for reasoning models (ignored by models without reasoning). Lower is faster. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  signal?: AbortSignal;
  /** Called as output streams in, with the number of characters received so far. */
  onProgress?: (receivedChars: number) => void;
  /** Called as output streams in, with all output text received so far (partial JSON). */
  onText?: (textSoFar: string) => void;
  /** Usage attribution. */
  userId: string;
  jobId?: string;
};

export type Usage = {
  provider: string;
  model: string;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  estimatedCostUsd: number | null;
};

export type StructuredResult<T> = { data: T; usage: Usage };

export interface TextModelProvider {
  readonly name: string;
  readonly model: string;
  structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>>;
}

export type AIErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "TRUNCATED"
  | "REFUSED"
  | "INVALID_OUTPUT"
  | "BAD_REQUEST"
  | "UPSTREAM"
  | "CANCELLED";

const BUSY = "Our servers are busy right now. Please try again in a few minutes. If this keeps happening, contact support.";

/**
 * The words a presenter may see for a failure. An AIError's own message names the AI company, its billing,
 * keys and models: that is for the server log only. Anything else is the app's own wording and is kept,
 * unless it names a provider or a key.
 */
export function publicMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof AIError) {
    switch (err.code) {
      case "CANCELLED":
        return "Cancelled";
      case "TIMEOUT":
        return "This took too long. Please try again.";
      case "REFUSED":
        return "This request could not be completed. Please change your prompt and try again.";
      case "TRUNCATED":
      case "INVALID_OUTPUT":
        return "The AI could not finish this. Please try again.";
      default:
        return BUSY; // no credits, rate limit, key, model, configuration, provider down
    }
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!message) return fallback;
  if (/open\s?ai|meshy|elevenlabs|api[ _-]?key|_API_|billing|quota|credits?\b|\bsk-/i.test(message)) return BUSY;
  return message;
}

export class AIError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly retryable = false,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "AIError";
  }
}
