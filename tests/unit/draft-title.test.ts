import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { aiDraftTitle, cleanTitle } from "@/server/deck/draft-title";
import type { TextModelProvider } from "@/server/ai/types";

const provider = (title: string | Error): TextModelProvider => ({
  name: "test",
  model: "test",
  structured: (async () => {
    if (title instanceof Error) throw title;
    return { data: { title }, usage: { provider: "test", model: "test", requestId: null, inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: 1, estimatedCostUsd: null } };
  }) as TextModelProvider["structured"],
});

describe("aiDraftTitle", () => {
  it("uses the AI's short title instead of the prompt", async () => {
    expect(await aiDraftTitle(provider("Brand Launch Marketing Playbook"), "Use 16 slides.\n\nMarketing strategy for a new brand", "u1")).toBe("Brand Launch Marketing Playbook");
  });
  it("falls back to the prompt's topic when the AI fails", async () => {
    expect(await aiDraftTitle(provider(new Error("down")), "Use 8 slides.\n\nmarketing strategy for a new brand", "u1")).toBe("Marketing strategy for a new brand");
  });
  it("falls back when the AI returns nothing", async () => {
    expect(await aiDraftTitle(provider("  "), "Data science learning roadmap", "u1")).toBe("Data science learning roadmap");
  });
});

describe("cleanTitle", () => {
  it("drops quotes and a final full stop", () => {
    expect(cleanTitle('"The Future of Learning."')).toBe("The Future of Learning");
  });
  it("keeps it to one line of at most 80 characters", () => {
    const t = cleanTitle("word ".repeat(40));
    expect(t.length).toBeLessThanOrEqual(81);
    expect(t.includes("\n")).toBe(false);
  });
});
