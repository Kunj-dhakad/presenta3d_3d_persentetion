import "server-only";
import { env } from "@/server/env";
import type { TextModelProvider } from "./types";
import { OpenAITextProvider } from "./openai-provider";
import { MockTextProvider } from "./mock-provider";

/**
 * Provider selection. Callers depend on TextModelProvider only. To add a
 * provider, implement the interface and register it here.
 */
export function getTextProvider(): TextModelProvider {
  if (env().AI_PROVIDER === "mock") return new MockTextProvider();
  return new OpenAITextProvider();
}
