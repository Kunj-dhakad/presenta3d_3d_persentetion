import { z } from "zod";
import { CINE_CUTS, CINE_FRAMES, CINE_LOOKS, CINE_STYLES, CINE_VISUALS, TEXT_EFFECTS, defaultDeckSettings, validateDeck, type CineStyle, type DeckSlide, type DeckSpec, type DeckValidation } from "./deck";

/**
 * Cinematic presentations: what the model writes (CineSpec), and how it is
 * stored in deck.json (a DeckSpec with style "cinematic", a deck style and a
 * `cine` block on every slide). Storing it as a DeckSpec keeps everything that
 * works on decks working: chat edits, the Settings drawer (Thank-you slide,
 * footer, auto-play), narration notes, versions, Present and Publish. Only the
 * engine differs (server/deck/cine-codegen.ts); the 3D scene fields are placeholders.
 * Every field is required so the schema works with OpenAI strict structured outputs.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

export const CineSlideSchema = z.object({
  look: z
    .enum(CINE_LOOKS)
    .describe(
      "hero = opening title; image = one big statement over its picture; statement = one huge turning-point line; stats = 2-3 huge numbers; cards = 3 numbered cards (items); timeline = 3-4 milestones on a line (items: heading = when, text = what); bullets = 2-4 short bullets; closing = the final line.",
    ),
  kicker: z.string().describe("Short line above the title, e.g. 'THE CAUSE' or 'SOLUTION 01'. Empty string for none."),
  title: z.string().describe("The headline, 2-7 punchy words."),
  highlight: z.string().describe("The key word(s) of the title to set in the slide's tone, copied exactly from the title. Empty string for none."),
  subtitle: z.string().describe("One short supporting sentence. Empty string for none."),
  bullets: z.array(z.string()).describe("For look 'bullets': 2-4 bullets of at most 8 words. Otherwise empty."),
  stats: z.array(z.object({ value: z.string().describe("e.g. '420+' or '~1.2°C'"), label: z.string() })).describe("For look 'stats': 2-3 items. Otherwise empty."),
  items: z.array(z.object({ heading: z.string(), text: z.string() })).describe("For 'cards' (3 items: short heading + one sentence) and 'timeline' (3-4 items: heading = a date or stage, text = 2-5 words). Otherwise empty."),
  imagePrompt: z
    .string()
    .describe(
      "EVERY slide: the photograph that shows THIS slide's own content — name the concrete people, objects, places and actions from its title, subtitle, bullets, numbers or items (never a generic stock scene, never the same scene twice). Say the shot (wide establishing, close-up, aerial, macro detail, portrait, over-the-shoulder, silhouette), the setting, the light and the mood. No text, letters, logos or UI in the image.",
    ),
  frame: z
    .enum(CINE_FRAMES)
    .describe("Where the image sits: full = the whole screen behind the text; right / left = the image fills that half and the text sits on the other; window = the image in a framed panel on the right. hero, closing and statement use full; cards and timeline use full; vary the others, never the same frame on more than two slides in a row."),
  cut: z
    .enum(CINE_CUTS)
    .describe("How this slide cuts in: flash (blur and light flash), fade (through black), push (slides in), zoom (zooms through), wipe (revealed from the side), iris (opens from the centre). Never the same cut on neighbouring slides; use at least 4 different cuts in a deck."),
  visual: z.enum(CINE_VISUALS).describe("A glowing shape shown only if the image cannot be made: planet, spiral, orbs, pulse, or none."),
  tone: Hex.describe("This slide's highlight colour. Readable on the image; vary it with the story within the deck's palette."),
  textEffect: z.enum(TEXT_EFFECTS).describe("How the title appears: zoom, rise, letters (letter by letter), slide, blur, flip, drop. Never the same on neighbouring slides."),
  notes: z.string().describe("What the presenter says on this slide (read aloud with subtitles): 2-4 natural spoken sentences, never empty. Same language as the slides."),
});

export const CineSpecSchema = z.object({
  title: z.string(),
  theme: z.object({
    style: z
      .enum(CINE_STYLES)
      .describe(
        "The deck's look: trailer = blockbuster trailer, huge condensed capitals, embers and flashes; editorial = magazine, elegant serif titles, calm fades; noir = black-and-white photographs, red accent, hard cuts; neon = futuristic night, glowing wide type; documentary = photojournalism, bold sans titles on lower-third panels; luxury = campaign photography, refined serif, gold, slow and quiet.",
      ),
    background: Hex.describe("Dark base colour behind the images, tinted to the palette"),
    text: Hex.describe("Title and text colour, light"),
    accent: Hex.describe("The deck's accent (kickers, lines, buttons), fitting the style"),
    font: z.enum(["display", "sans", "serif", "mono"]).describe("Kept for the Settings drawer; the style sets the fonts. Use display."),
  }),
  slides: z.array(CineSlideSchema),
});
export type CineSpec = z.infer<typeof CineSpecSchema>;
type CineSpecSlide = CineSpec["slides"][number];

/** Stored slide layout for each look (used by anything that reads decks generically). */
const LAYOUT: Record<(typeof CINE_LOOKS)[number], DeckSlide["layout"]> = {
  hero: "hero",
  image: "left",
  statement: "center",
  stats: "stats",
  cards: "left",
  timeline: "left",
  bullets: "left",
  closing: "hero",
};

/** Looks that need the whole width for their text: their image is always full screen. */
const FULL_WIDTH_LOOKS = new Set<string>(["hero", "statement", "closing", "cards", "timeline"]);

/**
 * The model's cinematic deck → a stored deck. Every slide gets an image; images
 * of slides whose prompt did not change are kept from `previous` (an edit does
 * not repaint them). Returns the deck and the slides that still need an image.
 */
export function cineToDeck(spec: CineSpec, previous: DeckSpec | null): { deck: DeckValidation; missing: number[] } {
  const painted = new Map<string, string>();
  for (const s of previous?.slides ?? []) if (s.cine?.image && s.cine.imagePrompt) painted.set(imageKey(s.cine.imagePrompt), s.cine.image);
  const missing: number[] = [];
  let prevCut = "";
  const slides = spec.slides.map((s: CineSpecSlide, i) => {
    const prompt = s.imagePrompt.trim() || [s.title, s.subtitle, ...s.bullets, ...s.items.map((x) => `${x.heading}: ${x.text}`)].filter(Boolean).join(". ");
    const image = painted.get(imageKey(prompt)) ?? "";
    if (!image) missing.push(i);
    // Neighbouring slides never cut in the same way, whatever the model chose.
    const cut = s.cut === prevCut ? CINE_CUTS[(CINE_CUTS.indexOf(s.cut) + 1) % CINE_CUTS.length] : s.cut;
    prevCut = cut;
    return {
      layout: LAYOUT[s.look],
      kicker: s.kicker,
      title: s.title,
      subtitle: s.subtitle,
      bullets: s.look === "bullets" ? s.bullets : [],
      stats: s.look === "stats" ? s.stats : [],
      notes: s.notes,
      textEffect: s.textEffect,
      // The 3D fields are not used by the cinematic engine; kept valid for generic readers.
      scene: { kind: "particles", primary: s.tone, secondary: spec.theme.accent, speed: 1, density: 0.6, values: [] },
      cine: {
        look: s.look,
        highlight: s.highlight,
        tone: s.tone,
        visual: s.visual,
        imagePrompt: prompt,
        image,
        items: s.look === "cards" || s.look === "timeline" ? s.items : [],
        frame: FULL_WIDTH_LOOKS.has(s.look) ? ("full" as const) : s.frame,
        cut,
      },
    };
  });
  const { style, ...theme } = spec.theme;
  const deck = validateDeck({
    title: spec.title,
    style: "cinematic",
    cineStyle: style,
    theme: { ...theme, environment: "space", transition: "side" },
    slides,
    // New decks get the default settings (they end on a Thank-you slide); edits keep the owner's.
    settings: previous?.settings ?? defaultDeckSettings(),
  });
  return { deck, missing };
}

const imageKey = (prompt: string) => prompt.trim().toLowerCase().replace(/\s+/g, " ");

/** A stored cinematic deck in the model's format (for edits: the model sees what it wrote, without image URLs). */
export function cineForPrompt(deck: DeckSpec): CineSpec {
  return {
    title: deck.title,
    theme: { style: deck.cineStyle ?? "trailer", background: deck.theme.background, text: deck.theme.text, accent: deck.theme.accent, font: deck.theme.font },
    slides: deck.slides.map((s) => ({
      look: s.cine?.look ?? "statement",
      kicker: s.kicker,
      title: s.title,
      highlight: s.cine?.highlight ?? "",
      subtitle: s.subtitle,
      bullets: s.bullets,
      stats: s.stats,
      items: s.cine?.items ?? [],
      imagePrompt: s.cine?.imagePrompt ?? "",
      frame: s.cine?.frame ?? "full",
      cut: s.cine?.cut ?? "flash",
      visual: s.cine?.visual ?? "none",
      tone: s.cine?.tone ?? deck.theme.accent,
      textEffect: s.textEffect ?? "rise",
      notes: s.notes,
    })),
  };
}

/** The photographic direction of each deck style, added to every image of the deck so they belong together. */
export const STYLE_ART: Record<CineStyle, string> = {
  trailer: "Epic blockbuster film still, anamorphic lens, dramatic volumetric light, teal-and-orange colour grade, haze and atmosphere",
  editorial: "Editorial magazine photograph, natural soft window light, refined composition, muted elegant tones, fine grain",
  noir: "Black-and-white film noir photograph, hard directional light, deep shadows, high contrast, rain or smoke where it fits",
  neon: "Futuristic night scene, neon light and reflections, saturated magenta and cyan, glossy surfaces, cyberpunk mood",
  documentary: "Documentary photojournalism, an authentic real-world moment, natural available light, candid, true colours",
  luxury: "Luxury brand campaign photograph, soft golden light, minimal composition, rich textures, shallow depth of field",
};

/**
 * The full prompt for one slide's image: what the slide is about (its own
 * prompt), the deck's photographic style, and the composition its layout needs
 * (calm space where the text goes on a full-screen image).
 */
export function imagePromptFor(deck: DeckSpec, index: number): string {
  const slide = deck.slides[index];
  const c = slide.cine!;
  const style = STYLE_ART[deck.cineStyle ?? "trailer"];
  const centred = c.look === "hero" || c.look === "statement" || c.look === "closing";
  const composition =
    (c.frame ?? "full") !== "full"
      ? "One strong, clear subject, well composed for a half-screen crop."
      : centred
        ? "Keep a calm, darker area in the centre where a headline will sit."
        : "Keep the left half calm and darker where text will sit; the subject on the right.";
  const about = [slide.title, slide.subtitle].filter(Boolean).join(" — ");
  return `${c.imagePrompt}\n\nThis image illustrates the slide "${about}".\nStyle: ${style}.\n${composition}\nWidescreen 16:9 photograph. Absolutely no text, letters, numbers, captions, watermarks or logos.`;
}
