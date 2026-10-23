import { describe, expect, it } from "vitest";
import { SCENE_PRESETS, PRESET_NAMES, closestUnusedPreset } from "@/lib/deck-presets";
import { DeckSpecSchema, diversifyDeck, sampleDeck, validateDeck, type DeckSpec } from "@/lib/schemas/deck";

function deckWith(presets: string[]): DeckSpec {
  const raw = {
    ...sampleDeck("Presets"),
    slides: presets.map((preset, i) => ({
      ...sampleDeck().slides[1],
      title: `Slide ${i + 1}`,
      scene: { preset, primary: "#8b9cff", secondary: "#ff7ad9", speed: 1, density: 0.7, values: [] },
    })),
  };
  const v = validateDeck(raw);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return v.deck;
}

describe("scene presets", () => {
  it("has a large catalog of uniquely named presets that all validate", () => {
    expect(SCENE_PRESETS.length).toBeGreaterThanOrEqual(140);
    expect(new Set(PRESET_NAMES).size).toBe(PRESET_NAMES.length);
    const deck = deckWith(PRESET_NAMES.slice(0, 20));
    expect(deck.slides.every((s) => s.scene.kind)).toBe(true);
    for (const name of PRESET_NAMES) expect(validateDeck(deckWith([name])).ok).toBe(true);
  });

  it("expands a preset into the engine's scene description", () => {
    const [slide] = deckWith(["dna-helix"]).slides;
    expect(slide.scene).toMatchObject({ kind: "composed", preset: "dna-helix", compose: { shape: "sphere", arrangement: "helix", motion: "rotate", material: "glow" } });
    const [classic] = deckWith(["connected-globe"]).slides;
    expect(classic.scene.kind).toBe("globe");
    expect(classic.scene.compose).toBeUndefined();
  });

  it("is what the model must choose from", () => {
    const ai = { ...sampleDeck(), slides: [{ ...sampleDeck().slides[0], scene: { preset: "dna-helix", primary: "#ffffff", secondary: "#000000", speed: 1, density: 0.5, values: [] } }] };
    expect(DeckSpecSchema.safeParse(ai).success).toBe(true);
  });
});

describe("no two slides alike", () => {
  it("replaces repeated presets with the closest unused ones", () => {
    const deck = diversifyDeck(deckWith(Array(10).fill("dna-helix")));
    const names = deck.slides.map((s) => s.scene.preset);
    expect(new Set(names).size).toBe(10);
    expect(names[0]).toBe("dna-helix");
  });

  it("never puts the same arrangement on neighbouring slides", () => {
    const deck = diversifyDeck(deckWith(["satellite-ring", "crown-of-cubes", "crystal-circle", "torus-halo", "city-blocks", "pixel-field"]));
    for (let i = 1; i < deck.slides.length; i++) {
      const a = deck.slides[i - 1].scene, b = deck.slides[i].scene;
      if (a.kind === "composed" && b.kind === "composed") expect(b.compose!.arrangement).not.toBe(a.compose!.arrangement);
    }
  });

  it("picks replacements by shared tags", () => {
    const pick = closestUnusedPreset("solar-system", new Set(["solar-system"]));
    expect(pick.name).not.toBe("solar-system");
    expect(pick.tags).toMatch(/space|astronomy|planets|education/);
  });
});
