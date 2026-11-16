import { describe, expect, it } from "vitest";
import { TEXT_MODELS, modelLabel } from "@/lib/ai-models";
import { isAllowedTextModel } from "@/server/ai/provider";
import { textProviderOrThrow } from "@/server/services/generation";

describe("AI model dropdown", () => {
  it("offers the twelve models, by name, in the order given", () => {
    expect(TEXT_MODELS.map((m) => m.label)).toEqual(["GPT-5.2 Pro", "GPT-5.2", "GPT-5.4 Mini", "GPT-5.4 Pro", "GPT-5.4", "GPT-5.5", "GPT-5.6 Sol", "GPT-6 Sol", "GPT-6 Luna", "GPT-6.1 Terra", "GPT-6.1 Sol", "GPT-6 Astra"]);
    expect(modelLabel("gpt-5.4-mini")).toBe("GPT-5.4 Mini");
    expect(modelLabel("custom-model")).toBe("CUSTOM-MODEL");
  });

  it("accepts only the listed models, so a request cannot pick any other", () => {
    for (const m of TEXT_MODELS) expect(isAllowedTextModel(m.id)).toBe(true);
    expect(isAllowedTextModel("o1-pro")).toBe(false);
    expect(() => textProviderOrThrow("o1-pro")).toThrow(/not available/);
  });

  it("is for show only: every request runs on the server's default model", () => {
    for (const m of TEXT_MODELS) expect(textProviderOrThrow(m.id).model).toBe(textProviderOrThrow(null).model);
  });
});
