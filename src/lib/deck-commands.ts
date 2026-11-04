import { z } from "zod";
import { ENVIRONMENTS, TEXT_SCALE, type DeckSpec } from "@/lib/schemas/deck";
import { applyDeckDesign, type DeckDesign } from "@/lib/deck-design";

/**
 * Edit a presentation with a spoken or typed command (PRD 3), e.g. "make the
 * text bigger", "use a blue accent", "change slide 2's title to Pricing".
 * The model maps the command to these direct edits, applied at once without
 * regenerating the deck. Anything else (new slides, layouts, images, 3D
 * scenes) is "ai": it goes to the chat's full AI edit instead.
 * Every field is required (nullable) so the schema works with OpenAI strict structured outputs.
 */
const SlideEditSchema = z.object({
  slide: z.number().int().describe("Slide number, 1-based."),
  kicker: z.string().nullable().describe("New label above the title, or null to keep it."),
  title: z.string().nullable().describe("New title, or null to keep it."),
  subtitle: z.string().nullable().describe("New supporting sentence, or null to keep it."),
  bullets: z.array(z.string()).nullable().describe("The slide's new bullet points (0-4), or null to keep them."),
  notes: z.string().nullable().describe("New narration text, or null to keep it."),
});

export const DeckCommandSchema = z.object({
  action: z
    .enum(["edit", "ai", "none"])
    .describe("edit = the fields below make the change; ai = the change needs the full AI editor (new or removed slides, layouts, images, 3D scenes, restructuring); none = not a change request or unclear."),
  reply: z.string().describe("One short sentence for the presenter, in the language of the command: what was changed, or why not."),
  textScale: z.number().nullable().describe(`New size of all slide text, as a multiple of the designed size (${TEXT_SCALE.min} to ${TEXT_SCALE.max}), or null to keep it.`),
  background: z.string().nullable().describe("New background colour #rrggbb, or null."),
  text: z.string().nullable().describe("New text colour #rrggbb, or null."),
  accent: z.string().nullable().describe("New accent colour #rrggbb, or null."),
  font: z.enum(["sans", "serif", "display", "mono"]).nullable().describe("New title font, or null."),
  environment: z.enum(ENVIRONMENTS).nullable().describe("New 3D world (3D presentations only), or null."),
  autoplay: z.boolean().nullable().describe("Turn auto-play on or off, or null."),
  slides: z.array(SlideEditSchema).describe("Word changes on specific slides; empty when none."),
});
export type DeckCommand = z.infer<typeof DeckCommandSchema>;

export const DECK_COMMAND_SYSTEM = `You turn a presenter's command into direct edits of their presentation.
Use action "edit" only for: the size of the slide text (textScale), the background, text or accent colour, the title font, the 3D world (3D presentations only), auto-play, and rewriting the words of specific slides (label, title, subtitle, bullet points, narration).
Use action "ai" for everything else: adding, removing or reordering slides, changing layouts, images, 3D scenes or other visual elements, or rewriting the whole presentation.
Use action "none" for anything that is not a change request, or too unclear to act on; then ask in "reply" what to change.
textScale is absolute: "bigger" is about the current value x 1.15, "much bigger" x 1.3, "smaller" x 0.87; stay between ${TEXT_SCALE.min} and ${TEXT_SCALE.max}.
Colours are #rrggbb. Keep text readable on the background.
"This slide" or "the current slide" means the current slide number given with the command; without one, ask which slide.
Keep the presentation's language for slide words unless the command asks for another. Set every field you do not change to null (slides: empty).`;

/** What the model sees of the deck: its look and every slide's words (no scenes or images). */
export function deckForCommand(deck: DeckSpec, currentSlide: number | null): string {
  return JSON.stringify({
    style: deck.style ?? "3d",
    theme: { background: deck.theme.background, text: deck.theme.text, accent: deck.theme.accent, font: deck.theme.font, environment: deck.style === "cinematic" ? null : deck.theme.environment },
    textScale: deck.settings.textScale,
    autoplay: deck.settings.autoplay.enabled,
    currentSlide,
    slides: deck.slides.map((s, i) => ({ slide: i + 1, kicker: s.kicker, title: s.title, subtitle: s.subtitle, bullets: s.bullets, notes: s.notes.slice(0, 400) })),
  });
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Apply a command's edits to a deck. Returns the changed deck and what
 * changed (empty: nothing to apply). Values are checked again here; the deck
 * is validated (lengths, readable colours) when it is saved.
 */
export function applyDeckCommand(deck: DeckSpec, c: DeckCommand): { deck: DeckSpec; changed: string[] } {
  const changed: string[] = [];
  let next: DeckSpec = { ...deck, settings: { ...deck.settings, autoplay: { ...deck.settings.autoplay } }, slides: [...deck.slides] };

  const design: DeckDesign = {};
  if (c.background && HEX.test(c.background)) design.background = c.background.toLowerCase();
  if (c.text && HEX.test(c.text)) design.text = c.text.toLowerCase();
  if (c.accent && HEX.test(c.accent)) design.accent = c.accent.toLowerCase();
  if (c.font) design.font = c.font;
  if (c.environment && next.style !== "cinematic") design.environment = c.environment;
  if (Object.keys(design).length) {
    next = applyDeckDesign(next, design);
    changed.push(...Object.keys(design));
  }

  if (c.textScale !== null && Number.isFinite(c.textScale)) {
    const scale = Math.round(Math.min(TEXT_SCALE.max, Math.max(TEXT_SCALE.min, c.textScale)) * 100) / 100;
    if (scale !== next.settings.textScale) {
      next.settings.textScale = scale;
      changed.push("textScale");
    }
  }
  if (c.autoplay !== null && c.autoplay !== next.settings.autoplay.enabled) {
    next.settings.autoplay.enabled = c.autoplay;
    changed.push("autoplay");
  }

  for (const edit of c.slides) {
    const i = edit.slide - 1;
    const slide = next.slides[i];
    if (!slide) continue;
    const copy = { ...slide };
    for (const key of ["kicker", "title", "subtitle", "notes"] as const) {
      const value = edit[key];
      if (value !== null && value !== copy[key]) {
        copy[key] = value.trim();
        changed.push(`slide ${i + 1} ${key}`);
      }
    }
    if (edit.bullets !== null && JSON.stringify(edit.bullets) !== JSON.stringify(copy.bullets)) {
      copy.bullets = edit.bullets.map((b) => b.trim()).filter(Boolean).slice(0, 4);
      changed.push(`slide ${i + 1} bullets`);
    }
    next.slides[i] = copy;
  }
  return { deck: next, changed };
}
