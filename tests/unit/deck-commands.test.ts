import { describe, expect, it } from "vitest";
import { sampleDeck, validateDeck, type DeckSpec } from "@/lib/schemas/deck";
import { applyDeckCommand, deckForCommand, DeckCommandSchema, type DeckCommand } from "@/lib/deck-commands";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { readFileSync } from "node:fs";
import { PRESET_NAMES } from "@/lib/deck-presets";
import { cinePicturePrompt } from "@/lib/schemas/cine";

const nothing: DeckCommand = { action: "edit", reply: "", textScale: null, background: null, text: null, accent: null, font: null, environment: null, autoplay: null, slides: [] };
const cmd = (c: Partial<DeckCommand>): DeckCommand => DeckCommandSchema.parse({ ...nothing, ...c });
const deck = (): DeckSpec => {
  const v = validateDeck(sampleDeck("Commands"));
  if (!v.ok) throw new Error("sample deck is invalid");
  return v.deck;
};

describe("deck commands", () => {
  it("sets the text size within its bounds, and new decks start at 1", () => {
    expect(deck().settings.textScale).toBe(1);
    expect(applyDeckCommand(deck(), cmd({ textScale: 1.15 })).deck.settings.textScale).toBe(1.15);
    expect(applyDeckCommand(deck(), cmd({ textScale: 9 })).deck.settings.textScale).toBe(1.6);
    expect(applyDeckCommand(deck(), cmd({ textScale: 0.1 })).deck.settings.textScale).toBe(0.7);
    // Saved and loaded again, the size stays.
    const v = validateDeck(applyDeckCommand(deck(), cmd({ textScale: 1.3 })).deck);
    expect(v.ok && v.deck.settings.textScale).toBe(1.3);
  });

  it("changes colours and font, and ignores colours that are not #rrggbb", () => {
    const { deck: d, changed } = applyDeckCommand(deck(), cmd({ accent: "#3B82F6", background: "blue", font: "serif" }));
    expect(d.theme.accent).toBe("#3b82f6");
    expect(d.theme.background).toBe(deck().theme.background);
    expect(d.theme.font).toBe("serif");
    expect(changed).toEqual(["accent", "font"]);
  });

  it("rewrites the words of one slide and leaves the others", () => {
    const before = deck();
    const { deck: d, changed } = applyDeckCommand(before, cmd({ slides: [{ slide: 2, kicker: null, title: " Pricing ", subtitle: null, bullets: ["A", " ", "B", "C", "D", "E"], notes: null, scene: null, picture: null }] }));
    expect(d.slides[1].title).toBe("Pricing");
    expect(d.slides[1].bullets).toEqual(["A", "B", "C", "D"]);
    expect(d.slides[0]).toEqual(before.slides[0]);
    expect(changed).toEqual(["slide 2 title", "slide 2 bullets"]);
    // A slide that does not exist changes nothing.
    expect(applyDeckCommand(before, cmd({ slides: [{ slide: 99, kicker: null, title: "X", subtitle: null, bullets: null, notes: null, scene: null, picture: null }] })).changed).toEqual([]);
  });

  it("does not change the 3D world of a cinematic presentation", () => {
    const cine = { ...deck(), style: "cinematic" as const };
    expect(applyDeckCommand(cine, cmd({ environment: deck().theme.environment === "grid" ? "space" : "grid" })).changed).toEqual([]);
  });

  it("replaces a slide's visual: a 3D scene from the catalog, or a picture to paint on a cinematic slide", () => {
    const keep = { kicker: null, title: null, subtitle: null, bullets: null, notes: null, scene: null, picture: null };
    const before = deck();
    const other = PRESET_NAMES.find((n) => n !== before.slides[1].scene.preset)!;
    const three = applyDeckCommand(before, cmd({ slides: [{ ...keep, slide: 2, scene: other, picture: "ignored on 3D" }] }));
    expect(three.changed).toEqual(["slide 2 scene"]);
    expect(three.deck.slides[1].scene.preset).toBe(other);
    expect(three.deck.slides[1].scene.code).toBeUndefined();
    expect(three.pictures).toEqual([]);
    expect(validateDeck(three.deck).ok).toBe(true);

    const cine: DeckSpec = { ...before, style: "cinematic", slides: before.slides.map((s) => ({ ...s, cine: { text: "fadeUp", camera: "push", transition: "glide", pace: "normal", imagePrompt: "old", image: "" } })) };
    const pics = applyDeckCommand(cine, cmd({ slides: [1, 2, 3].map((n) => ({ ...keep, slide: n, picture: " a city at night ", scene: other })) }));
    // At most two pictures per command; the scene field is ignored on cinematic slides.
    expect(pics.pictures).toEqual([{ slide: 0, subject: "a city at night" }, { slide: 1, subject: "a city at night" }]);
    expect(pics.changed).toEqual(["slide 1 picture", "slide 2 picture"]);
    const prompt = cinePicturePrompt(cine, 0, "a city at night");
    expect(prompt).toContain("It shows: a city at night.");
    expect(prompt).toContain(cine.theme.accent);
  });

  it("does not touch the deck it was given", () => {
    const before = deck();
    const copy = JSON.stringify(before);
    applyDeckCommand(before, cmd({ textScale: 1.4, autoplay: !before.settings.autoplay.enabled, slides: [{ slide: 1, kicker: "NEW", title: null, subtitle: null, bullets: null, notes: null, scene: null, picture: null }] }));
    expect(JSON.stringify(before)).toBe(copy);
  });

  it("tells the model the current slide and every slide's words", () => {
    const seen = JSON.parse(deckForCommand(deck(), 3));
    expect(seen.currentSlide).toBe(3);
    expect(seen.textScale).toBe(1);
    expect(seen.slides[0]).toMatchObject({ slide: 1, title: deck().slides[0].title });
  });

  it("scales the slide text in both engines", () => {
    const css = (files: { path: string; content: string }[]) => files.map((f) => f.content).join("\n");
    expect(css(deckToProjectFiles(deck()))).toContain("calc(clamp(36px, 5.2vw, 76px) * var(--ts, 1))");
    expect(css(deckToProjectFiles(deck()))).toContain('setProperty("--ts"');
    // The cinematic engine has the same text rules and sets the same variable.
    const cine = readFileSync("src/server/deck/cine-codegen.ts", "utf8") + readFileSync("src/server/deck/cine-runtime.js.txt", "utf8");
    expect(cine).toContain("calc(clamp(36px, 5.2vw, 76px) * var(--ts, 1))");
    expect(cine).toContain('setProperty("--ts"');
  });
});
