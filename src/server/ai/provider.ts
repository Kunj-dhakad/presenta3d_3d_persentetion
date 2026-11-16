import "server-only";
import { env } from "@/server/env";
import type { TextModelProvider } from "./types";
import { OpenAITextProvider } from "./openai-provider";
import { MockTextProvider } from "./mock-provider";
import { TEXT_MODELS } from "@/lib/ai-models";

/** A model the presenter may choose (lib/ai-models.ts), or the server's own OPENAI_MODEL. */
export function isAllowedTextModel(model: string): boolean {
  return TEXT_MODELS.some((m) => m.id === model) || model === env().OPENAI_MODEL;
}

/**
 * Provider selection. Callers depend on TextModelProvider only. To add a
 * provider, implement the interface and register it here. `model`: the
 * presenter's choice in the dropdown, which is for show only: every request
 * runs on the server's OPENAI_MODEL, whatever is chosen.
 */
export function getTextProvider(model?: string | null): TextModelProvider {
  void model; // shown in the dropdown, not used
  if (env().AI_PROVIDER === "mock") return new MockTextProvider();
  return new OpenAITextProvider();
}
