import { describe, expect, it } from "vitest";
import { TEXT_MODELS, modelLabel } from "@/lib/ai-models";
import { isAllowedTextModel } from "@/server/ai/provider";
import { textProviderOrThrow } from "@/server/services/generation";

describe("AI model dropdown", () => {
  it("offers GPT-5.4, GPT-5.4 mini and GPT-5.5, by name", () => {
    expect(TEXT_MODELS.map((m) => m.label)).toEqual(["GPT-5.4", "GPT-5.4 mini", "GPT-5.5"]);
    expect(modelLabel("gpt-5.4-mini")).toBe("GPT-5.4 mini");
    expect(modelLabel("custom-model")).toBe("CUSTOM-MODEL");
  });

  it("accepts only the listed models, so a request cannot pick any other", () => {
    for (const m of TEXT_MODELS) expect(isAllowedTextModel(m.id)).toBe(true);
    expect(isAllowedTextModel("o1-pro")).toBe(false);
    expect(() => textProviderOrThrow("o1-pro")).toThrow(/not available/);
  });
});
