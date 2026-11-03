import { z } from "zod";
import { CINE_IMAGE_LOOKS, CINE_LOOKS, CINE_VISUALS, TEXT_EFFECTS, defaultDeckSettings, validateDeck, type DeckSlide, type DeckSpec, type DeckValidation } from "./deck";

/**
 * Cinematic presentations: what the model writes (CineSpec), and how it is
 * stored in deck.json (a DeckSpec with style "cinematic" and a `cine` block on
 * every slide). Storing it as a DeckSpec keeps everything that works on decks
 * working: chat edits, the Settings drawer (Thank-you slide, footer, auto-play),
 * narration notes, versions, Present and Publish. Only the engine differs
 * (server/deck/cine-codegen.ts), and the 3D scene fields are placeholders.
 * Every field is required so the schema works with OpenAI strict structured outputs.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

export const CineSlideSchema = z.object({
  look: z
    .enum(CINE_LOOKS)
    .describe(
      "hero = opening title over a full-bleed image; image = big statement over a full-bleed image; statement = one huge centred line, no image; stats = 2-3 huge numbers with a visual; cards = 3 numbered cards (items); timeline = 3-4 milestones on a line (items: heading = when, text = what); bullets = 2-4 short bullets with a visual; closing = final line over a full-bleed image.",
    ),
  kicker: z.string().describe("Short line above the title, shown in wide letter-spaced capitals, e.g. 'THE CAUSE' or 'SOLUTION 01'. Empty string for none."),
  title: z.string().describe("The headline, 2-7 punchy words, written to be shown in huge condensed capitals."),
  highlight: z.string().describe("The word(s) of the title to colour in the slide's tone and make glow, copied exactly from the title (e.g. 'MISSION'). Empty string for none."),
  subtitle: z.string().describe("One short supporting sentence. Empty string for none."),
  bullets: z.array(z.string()).describe("For look 'bullets': 2-4 bullets of at most 8 words. Otherwise empty."),
  stats: z.array(z.object({ value: z.string().describe("e.g. '420+' or '~1.2°C'"), label: z.string() })).describe("For look 'stats': 2-3 items. Otherwise empty."),
  items: z.array(z.object({ heading: z.string(), text: z.string() })).describe("For 'cards' (3 items: short heading + one sentence) and 'timeline' (3-4 items: heading = a date or stage, text = 2-5 words). Otherwise empty."),
  visual: z.enum(CINE_VISUALS).describe("For slides without an image: planet = glowing sphere with a ring; spiral = glowing rings spinning in 3D; orbs = a big orb with small orbiting ones; pulse = an orb sending out rings; none. Image looks use none."),
  tone: Hex.describe("This slide's glow colour (highlight word, particles, visual). Vivid, readable on near-black; vary it along the story (e.g. ember orange for problems, green for solutions, cyan for technology)."),
  imagePrompt: z
    .string()
    .describe(
      "For hero, image and closing: a detailed prompt for a photorealistic cinematic image, 16:9 film still, dramatic lighting, dark edges, no text, no letters, no logos, leaving calm space on the left for the title. Describe subject, setting, light, colour grade and camera. Empty for the other looks.",
    ),
  textEffect: z.enum(TEXT_EFFECTS).describe("How the title appears: zoom (huge to normal, blurred), rise, letters (letter by letter), slide, blur, flip, drop. Vary it from slide to slide."),
  notes: z.string().describe("What the presenter says on this slide (read aloud with subtitles): 2-4 natural spoken sentences, never empty. Same language as the slides."),
});

export const CineSpecSchema = z.object({
  title: z.string(),
  theme: z.object({
    background: Hex.describe("Near black, slightly tinted, e.g. #030608"),
    text: Hex.describe("Warm off-white, e.g. #f6f1ea"),
    accent: Hex.describe("The kicker colour used on every slide, e.g. ember orange #ff7a1a"),
    font: z.enum(["display", "sans", "serif", "mono"]).describe("display = tall condensed capitals (the trailer look, the default); sans = bold condensed; serif = elegant; mono = technical."),
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

/**
 * The model's cinematic deck → a stored deck. Images of slides whose look and
 * prompt did not change are kept from `previous` (an edit does not repaint them).
 * Returns the deck and the slides that still need an image.
 */
export function cineToDeck(spec: CineSpec, previous: DeckSpec | null): { deck: DeckValidation; missing: number[] } {
  const painted = new Map<string, string>();
  for (const s of previous?.slides ?? []) if (s.cine?.image && s.cine.imagePrompt) painted.set(imageKey(s.cine.imagePrompt), s.cine.image);
  const missing: number[] = [];
  const slides = spec.slides.map((s: CineSpecSlide, i) => {
    const needsImage = CINE_IMAGE_LOOKS.includes(s.look);
    const prompt = needsImage ? s.imagePrompt.trim() || `${s.title}. ${s.subtitle}` : "";
    const image = prompt ? (painted.get(imageKey(prompt)) ?? "") : "";
    if (prompt && !image) missing.push(i);
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
        visual: needsImage ? "none" : s.visual,
        imagePrompt: prompt,
        image,
        items: s.look === "cards" || s.look === "timeline" ? s.items : [],
      },
    };
  });
  const deck = validateDeck({
    title: spec.title,
    style: "cinematic",
    theme: { ...spec.theme, environment: "space", transition: "side" },
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
    theme: { background: deck.theme.background, text: deck.theme.text, accent: deck.theme.accent, font: deck.theme.font },
    slides: deck.slides.map((s) => ({
      look: s.cine?.look ?? "statement",
      kicker: s.kicker,
      title: s.title,
      highlight: s.cine?.highlight ?? "",
      subtitle: s.subtitle,
      bullets: s.bullets,
      stats: s.stats,
      items: s.cine?.items ?? [],
      visual: s.cine?.visual ?? "none",
      tone: s.cine?.tone ?? deck.theme.accent,
      imagePrompt: s.cine?.imagePrompt ?? "",
      textEffect: s.textEffect ?? "rise",
      notes: s.notes,
    })),
  };
}
