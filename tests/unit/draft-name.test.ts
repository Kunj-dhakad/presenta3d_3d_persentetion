import { describe, expect, it } from "vitest";
import { draftNameFrom } from "@/lib/draft-name";

describe("draftNameFrom", () => {
  it("takes the topic after the wishes line", () => {
    expect(draftNameFrom("Use 8 slides. Tone: friendly.\n\nProduct launch for a fitness app")).toBe("Product launch for a fitness app");
  });
  it("capitalises a plain topic", () => {
    expect(draftNameFrom("investor pitch for a fintech startup")).toBe("Investor pitch for a fintech startup");
  });
  it("cuts long topics at a word", () => {
    const name = draftNameFrom("A very long description of a presentation about renewable energy sources and how cities can switch to them");
    expect(name.length).toBeLessThanOrEqual(61);
    expect(name.endsWith("…")).toBe(true);
    expect(name).not.toMatch(/\s…$/);
  });
  it("falls back when empty", () => {
    expect(draftNameFrom("   \n\n  ")).toBe("Untitled presentation");
  });
});
