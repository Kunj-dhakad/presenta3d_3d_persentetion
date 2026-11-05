import { z } from "zod";
import {
  CINE_CAMERA_MOVES,
  CINE_PACES,
  CINE_TEXT_STYLES,
  CINE_TRANSITIONS,
  ENVIRONMENTS,
  ENVIRONMENT_HINTS,
  defaultDeckSettings,
  validateDeck,
  type DeckSpec,
  type DeckValidation,
} from "./deck";

/**
 * Cinematic presentations: what the model writes (CineSpec), and how it is
 * stored in deck.json (a DeckSpec with style "cinematic" and a `cine` block on
 * every slide). Storing it as a DeckSpec keeps everything that works on decks
 * working: chat edits, the Settings drawer (Thank-you slide, footer, auto-play),
 * narration notes, versions, Present and Publish. Only the engine differs
 * (server/deck/cine-codegen.ts): each slide is a unique AI photograph animated
 * with film-like moves and kinetic typography. The image prompts are derived by
 * the server from each slide's own words, never written by the model.
 * Every field is required so the schema works with OpenAI strict structured outputs.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

const MotionSchema = z
  .object({
    text: z
      .enum(CINE_TEXT_STYLES)
      .describe(
        "How the title and text animate in: glitch (tech, disruption), zoom (big statements), split (contrasts, two sides), rotate3d (products, reveals), wipe (clean corporate, data), letters (names, short powerful titles), fadeUp (calm, storytelling).",
      ),
    camera: z
      .enum(CINE_CAMERA_MOVES)
      .describe("The camera's slow move while the slide is shown: push (in, focus), pull (out, scale), orbit (around the scene, products/objects), crane (rise above, overview), drift (gentle sideways), static."),
    transition: z
      .enum(CINE_TRANSITIONS)
      .describe("How the camera travels to this slide: glide (zoom out, sideways, zoom in), whip (fast whip pan, energy), rise (crane up and over), spiral (rolling arc, drama), zoom (lens zoom through)."),
    pace: z.enum(CINE_PACES).describe("Timing: calm (slow, elegant), normal, energetic (snappy)."),
  })
  .describe("Cinematic motion for this slide. Vary it from slide to slide; never repeat the same text style or transition on consecutive slides.");
export type CineMotion = z.infer<typeof MotionSchema>;

export const CineSlideSchema = z.object({
  layout: z
    .enum(["hero", "left", "right", "center", "stats"])
    .describe("hero = big title slide; left/right = text on that side with the main image subject on the other; center = text over the image; stats = up to 4 big numbers."),
  kicker: z.string().describe("Short uppercase label above the title, e.g. 'CHAPTER 02'. Empty string for none."),
  title: z.string().describe("Slide title, at most ~8 words."),
  subtitle: z.string().describe("One supporting sentence. Empty string for none."),
  bullets: z.array(z.string()).describe("0-4 concise bullet points (at most ~12 words each)."),
  stats: z.array(z.object({ value: z.string().describe("e.g. '3.2x' or '$4M'"), label: z.string() })).describe("2-4 items for layout 'stats', otherwise empty."),
  motion: MotionSchema,
  notes: z
    .string()
    .describe(
      "What the presenter says on this slide; it is read aloud as narration with subtitles. 2-4 natural spoken sentences (about 30-60 words) that add to the slide rather than repeat it word for word. Same language as the slides. Never empty.",
    ),
});

export const CineSpecSchema = z.object({
  title: z.string(),
  theme: z.object({
    background: Hex.describe("Dark background color behind the images, near black, tinted toward the palette, e.g. #05060a"),
    text: Hex,
    accent: Hex,
    font: z.enum(["sans", "serif", "display", "mono"]).describe("Title font. Prefer display or sans; serif only for elegant, literary or luxury topics."),
    environment: z.enum(ENVIRONMENTS).describe("The atmospheric background treatment for generated slide images; pick what fits the topic."),
  }),
  slides: z.array(CineSlideSchema),
});
export type CineSpec = z.infer<typeof CineSpecSchema>;
type CineSpecSlide = CineSpec["slides"][number];

/**
 * The prompt for one slide's generated image, derived from the slide's own
 * words so every image shows that slide's subject, composed so the text's side
 * stays calm and dark.
 */
/** Where the picture's subject goes so the slide's text stays readable. */
function layoutHint(layout: string): string {
  return layout === "left"
    ? "Place the main subject on the RIGHT half, leaving the LEFT third dark, uncluttered and low contrast for presentation text."
    : layout === "right"
      ? "Place the main subject on the LEFT half, leaving the RIGHT third dark, uncluttered and low contrast for presentation text."
      : "Compose a clear cinematic focal subject with a darker, low-detail central area where presentation text can remain readable.";
}

function cineImagePrompt(slide: CineSpecSlide, index: number, total: number, theme: CineSpec["theme"]): string {
  const layout = layoutHint(slide.layout);
  return [
    `Create a polished cinematic widescreen presentation background for slide ${index + 1} of ${total}.`,
    `Presentation topic: ${slide.title}.`,
    slide.subtitle ? `Key idea: ${slide.subtitle}.` : "",
    slide.bullets.length ? `Supporting ideas: ${slide.bullets.join("; ")}.` : "",
    `Art direction: colors that harmonize with ${theme.accent} over a deep ${theme.background} atmosphere. Image atmosphere: ${ENVIRONMENT_HINTS[theme.environment]}.`,
    layout,
    "Make the visual specifically recognizable as this slide's subject, photorealistic or refined editorial illustration as appropriate. Rich detail in the subject, elegant lighting, subtle depth, presentation-ready. No words, letters, labels, logos, watermarks, UI, charts with text, borders, or collages.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Neighbouring slides never share a text style, camera move or transition. */
function varyMotion(m: CineMotion, prev: CineMotion | null, i: number): CineMotion {
  if (!prev) return m;
  const next = <T,>(xs: readonly T[], v: T, avoid: T) => (v !== avoid ? v : xs[(xs.indexOf(v) + 1 + (i % (xs.length - 1))) % xs.length]);
  let text = next(CINE_TEXT_STYLES, m.text, prev.text);
  if (text === prev.text) text = CINE_TEXT_STYLES[(CINE_TEXT_STYLES.indexOf(text) + 1) % CINE_TEXT_STYLES.length];
  let camera = next(CINE_CAMERA_MOVES, m.camera, prev.camera);
  if (camera === prev.camera && camera !== "static") camera = CINE_CAMERA_MOVES[(CINE_CAMERA_MOVES.indexOf(camera) + 1) % CINE_CAMERA_MOVES.length];
  let transition = next(CINE_TRANSITIONS, m.transition, prev.transition);
  if (transition === prev.transition) transition = CINE_TRANSITIONS[(CINE_TRANSITIONS.indexOf(transition) + 1) % CINE_TRANSITIONS.length];
  return { ...m, text, camera, transition };
}

/**
 * The model's cinematic deck → a stored deck. Every slide gets an image prompt
 * derived from its words; images of slides whose prompt did not change are kept
 * from `previous` (an edit does not repaint them). Returns the deck and the
 * slides that still need an image.
 */
export function cineToDeck(spec: CineSpec, previous: DeckSpec | null): { deck: DeckValidation; missing: number[] } {
  const painted = new Map<string, string>();
  for (const s of previous?.slides ?? []) if (s.cine?.image && s.cine.imagePrompt) painted.set(imageKey(s.cine.imagePrompt), s.cine.image);
  const missing: number[] = [];
  let prev: CineMotion | null = null;
  const slides = spec.slides.map((s: CineSpecSlide, i) => {
    const motion = varyMotion(s.motion, prev, i);
    prev = motion;
    const prompt = cineImagePrompt(s, i, spec.slides.length, spec.theme);
    const image = painted.get(imageKey(prompt)) ?? "";
    if (!image) missing.push(i);
    return {
      layout: s.layout,
      kicker: s.kicker,
      title: s.title,
      subtitle: s.subtitle,
      bullets: s.bullets,
      stats: s.layout === "stats" ? s.stats : [],
      notes: s.notes,
      // The 3D fields are not used by the cinematic engine; kept valid for generic readers.
      scene: { kind: "particles", primary: spec.theme.accent, secondary: spec.theme.accent, speed: 1, density: 0.6, values: [] },
      cine: { ...motion, imagePrompt: prompt, image },
    };
  });
  const deck = validateDeck({
    title: spec.title,
    style: "cinematic",
    theme: { ...spec.theme, transition: "side" },
    slides,
    // New decks get the default settings (they end on a Thank-you slide); edits keep the owner's.
    settings: previous?.settings ?? defaultDeckSettings(),
  });
  return { deck, missing };
}

const imageKey = (prompt: string) => prompt.trim().toLowerCase().replace(/\s+/g, " ");

/** A stored cinematic deck in the model's format (for edits: the model sees what it wrote, without prompts or image URLs). */
export function cineForPrompt(deck: DeckSpec): CineSpec {
  return {
    title: deck.title,
    theme: { background: deck.theme.background, text: deck.theme.text, accent: deck.theme.accent, font: deck.theme.font, environment: deck.theme.environment },
    slides: deck.slides.map((s) => ({
      layout: s.layout,
      kicker: s.kicker,
      title: s.title,
      subtitle: s.subtitle,
      bullets: s.bullets,
      stats: s.stats,
      motion: {
        text: s.cine?.text ?? "fadeUp",
        camera: s.cine?.camera ?? "static",
        transition: s.cine?.transition ?? "glide",
        pace: s.cine?.pace ?? "normal",
      },
      notes: s.notes,
    })),
  };
}

/**
 * The prompt for a slide picture the presenter asked for by command (PRD 3):
 * their subject, in the deck's colours and atmosphere, composed around the
 * slide's text like the generated ones.
 */
export function cinePicturePrompt(deck: DeckSpec, index: number, subject: string): string {
  const slide = deck.slides[index];
  return [
    `Create a polished cinematic widescreen presentation background for slide ${index + 1} of ${deck.slides.length}.`,
    `It shows: ${subject.trim().slice(0, 600)}.`,
    slide?.title ? `Presentation topic: ${slide.title}.` : "",
    `Art direction: colors that harmonize with ${deck.theme.accent} over a deep ${deck.theme.background} atmosphere. Image atmosphere: ${ENVIRONMENT_HINTS[deck.theme.environment]}.`,
    layoutHint(slide?.layout ?? "center"),
    "Photorealistic or refined editorial illustration as appropriate. Rich detail in the subject, elegant lighting, subtle depth, presentation-ready. No words, letters, labels, logos, watermarks, UI, charts with text, borders, or collages.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The full prompt for one slide's image (stored on the slide when the deck was made). */
export function imagePromptFor(deck: DeckSpec, index: number): string {
  return deck.slides[index]?.cine?.imagePrompt ?? "";
}
