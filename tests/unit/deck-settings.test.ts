import { describe, expect, it } from "vitest";
import { defaultDeckSettings, sampleDeck, validateDeck } from "@/lib/schemas/deck";
import { applyDeckDesign, deckColors, DECK_TEMPLATES } from "@/lib/deck-design";
import { deckToProjectFiles } from "@/server/deck/codegen";

const withSettings = (settings: unknown) => ({ ...sampleDeck("Settings"), settings });

describe("deck settings", () => {
  it("gives decks saved before settings existed no extra Thank You slide", () => {
    const v = validateDeck(withSettings(undefined));
    expect(v.ok && v.deck.settings.thankYou.enabled).toBe(false);
    expect(v.ok && v.deck.settings.autoplay).toEqual({ enabled: false, seconds: 7 });
  });

  it("fills settings saved in part with the defaults of a new deck", () => {
    const v = validateDeck(withSettings({ footer: { enabled: true, name: "Acme" } }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.deck.settings.thankYou).toEqual(defaultDeckSettings().thankYou);
    expect(v.deck.settings.footer).toEqual({ enabled: true, logoUrl: "", name: "Acme", link: "" });
  });

  it("drops unsafe links, keeps at most 3 buttons and bounds auto-play", () => {
    const v = validateDeck(
      withSettings({
        thankYou: {
          enabled: true,
          title: "  ",
          message: "Bye",
          buttons: [
            { label: "Site", url: "https://example.com" },
            { label: "Bad", url: "javascript:alert(1)" },
            { label: "Mail", url: "mailto:hi@example.com" },
            { label: "", url: "https://no-label.example" },
            { label: "Call", url: "tel:+911234567890" },
            { label: "Fourth", url: "https://example.org" },
          ],
        },
        footer: { enabled: true, logoUrl: "http://example.com/logo.png", name: "Acme", link: "javascript:alert(1)" },
        autoplay: { enabled: true, seconds: 1 },
      }),
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const s = v.deck.settings;
    expect(s.thankYou.title).toBe("Thank you");
    expect(s.thankYou.buttons.map((b) => b.label)).toEqual(["Site", "Mail", "Call"]);
    // Only https logos load in the presentation (its CSP); links must be web pages.
    expect(s.footer.logoUrl).toBe("");
    expect(s.footer.link).toBe("");
    expect(s.autoplay.seconds).toBe(3);
  });

  it("writes the settings into deck.json and the play button and footer into the page", () => {
    const files = deckToProjectFiles({ ...sampleDeck("Page"), settings: { ...defaultDeckSettings(), autoplay: { enabled: true, seconds: 5 } } });
    expect(JSON.parse(files.find((f) => f.path === "deck.json")!.content).settings.autoplay).toEqual({ enabled: true, seconds: 5 });
    const html = files.find((f) => f.path === "index.html")!.content;
    expect(html).toContain('id="play"');
    expect(html).toContain('id="brand"');
  });
});

describe("deck design", () => {
  it("applies a template's world, font and colours, keeping the slides' content", () => {
    const deck = sampleDeck("Design");
    const t = DECK_TEMPLATES[2];
    const next = applyDeckDesign(deck, { environment: t.environment, font: t.font, ...t.colors });
    expect(next.theme).toMatchObject({ environment: t.environment, font: t.font, background: t.colors.background, text: t.colors.text, accent: t.colors.accent });
    expect(deckColors(next)).toEqual(t.colors);
    expect(next.slides.map((s) => s.title)).toEqual(deck.slides.map((s) => s.title));
    expect(next.slides.map((s) => s.scene.kind)).toEqual(deck.slides.map((s) => s.scene.kind));
    // Neighbouring slides swap the two scene colours.
    expect(next.slides[1].scene).toMatchObject({ primary: t.colors.secondary, secondary: t.colors.primary });
  });

  it("changes only the colours given", () => {
    const deck = sampleDeck("Design");
    const next = applyDeckDesign(deck, { accent: "#123456" });
    expect(next.theme).toEqual({ ...deck.theme, accent: "#123456" });
    expect(next.slides).toEqual(deck.slides);
  });
});
