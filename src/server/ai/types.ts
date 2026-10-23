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
