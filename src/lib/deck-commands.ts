import { z } from "zod";
import { ENVIRONMENTS, TEXT_SCALE, ThankYouEditSchema, withThankYouEdit, type DeckSpec } from "@/lib/schemas/deck";
import { applyDeckDesign, type DeckDesign } from "@/lib/deck-design";
import { PRESET_NAMES, presetByName } from "@/lib/deck-presets";

/**
 * Edit a presentation with a spoken or typed command (PRD 3), e.g. "make the
 * text bigger", "use a blue accent", "change slide 2's title to Pricing".
 * The model maps the command to these direct edits, applied at once without
 * regenerating the deck, including a slide's visual: its 3D scene (3D decks)
 * or a newly painted picture (cinematic decks). Anything else (new slides,
 * layouts, restructuring) is "ai": it goes to the chat's full AI edit instead.
 * Every field is required (nullable) so the schema works with OpenAI strict structured outputs.
 */
const SlideEditSchema = z.object({
  slide: z.number().int().describe("Slide number, 1-based."),
  kicker: z.string().nullable().describe("New label above the title, or null to keep it."),
  title: z.string().nullable().describe("New title, or null to keep it."),
  subtitle: z.string().nullable().describe("New supporting sentence, or null to keep it."),
  bullets: z.array(z.string()).nullable().describe("The slide's new bullet points (0-4), or null to keep them."),
  notes: z.string().nullable().describe("New narration text, or null to keep it."),
  scene: z.enum(PRESET_NAMES).nullable().describe("3D presentations only: the slide's new 3D scene, picked from the scene catalog by matching what the presenter asked for, or null to keep it."),
  picture: z.string().nullable().describe("Cinematic presentations only: what the slide's new picture should show, a short visual description in English (e.g. 'a modern glass office at sunset'), or null to keep it."),
});

export const DeckCommandSchema = z.object({
  action: z
    .enum(["edit", "ai", "none"])
    .describe("edit = the fields below make the change; ai = the change needs the full AI editor (new or removed slides, layouts, restructuring); none = not a change request or unclear."),
  reply: z.string().describe("One short sentence for the presenter, in the language of the command: what was changed, or why not."),
  textScale: z.number().nullable().describe(`New size of all slide text, as a multiple of the designed size (${TEXT_SCALE.min} to ${TEXT_SCALE.max}), or null to keep it.`),
  background: z.string().nullable().describe("New background colour #rrggbb, or null."),
  text: z.string().nullable().describe("New text colour #rrggbb, or null."),
  accent: z.string().nullable().describe("New accent colour #rrggbb, or null."),
  font: z.enum(["sans", "serif", "display", "mono"]).nullable().describe("New title font, or null."),
  environment: z.enum(ENVIRONMENTS).nullable().describe("New 3D world (3D presentations only), or null."),
  autoplay: z.boolean().nullable().describe("Turn auto-play on or off, or null."),
  thankYou: ThankYouEditSchema,
  slides: z.array(SlideEditSchema).describe("Word changes on specific slides; empty when none."),
});
export type DeckCommand = z.infer<typeof DeckCommandSchema>;

export const DECK_COMMAND_SYSTEM = `You turn a presenter's command into direct edits of their presentation.
Use action "edit" only for: the size of the slide text (textScale), the background, text or accent colour, the title font, the 3D world (3D presentations only), auto-play, the Thank-you slide (thankYou: show or hide it, its title, message and buttons), rewriting the words of specific slides (label, title, subtitle, bullet points, narration), and replacing a slide's visual: in a 3D presentation its 3D scene ("scene", from the scene catalog given with the presentation), in a cinematic presentation its picture ("picture": describe what it should show; a new picture is painted).
Use action "ai" for everything else: adding, removing or reordering slides, changing layouts, or rewriting the whole presentation.
"Image", "picture", "photo", "visual" or "graphic" of a slide means its scene in a 3D presentation and its picture in a cinematic one. At most 2 pictures per command.
Use action "none" for anything that is not a change request, or too unclear to act on; then ask in "reply" what to change.
textScale is absolute: "bigger" is about the current value x 1.15, "much bigger" x 1.3, "smaller" x 0.87; stay between ${TEXT_SCALE.min} and ${TEXT_SCALE.max}.
Colours are #rrggbb. Keep text readable on the background.
The Thank-you slide is not in "slides": the engine shows it after the last slide when thankYou.enabled is true, so "the thank-you slide" (or "the last slide", when the current slide number is after the last of "slides") means it. Change it only through thankYou, never by adding or rewriting a slide.
"This slide" or "the current slide" means the current slide number given with the command; without one, ask which slide.
Keep the presentation's language for slide words unless the command asks for another. Set every field you do not change to null (slides: empty).`;

/** What the model sees of the deck: its look and every slide's words (no scenes or images). */
export function deckForCommand(deck: DeckSpec, currentSlide: number | null): string {
  return JSON.stringify({
    style: deck.style ?? "3d",
    theme: { background: deck.theme.background, text: deck.theme.text, accent: deck.theme.accent, font: deck.theme.font, environment: deck.style === "cinematic" ? null : deck.theme.environment },
    textScale: deck.settings.textScale,
    autoplay: deck.settings.autoplay.enabled,
    thankYou: deck.settings.thankYou,
    currentSlide,
    slides: deck.slides.map((s, i) => ({
      slide: i + 1,
      kicker: s.kicker,
      title: s.title,
      subtitle: s.subtitle,
      bullets: s.bullets,
      notes: s.notes.slice(0, 400),
      // The slide's visual now: its 3D scene, or (cinematic) whether it has a picture.
      ...(deck.style === "cinematic" ? { picture: !!s.cine?.image } : { scene: s.scene.preset ?? s.scene.kind }),
    })),
  });
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Pictures one command may have painted (each takes ~10-30 s). */
export const MAX_COMMAND_PICTURES = 2;

/**
 * Apply a command's edits to a deck. Returns the changed deck, what changed
 * (empty: nothing to apply) and the pictures to paint (cinematic decks: the
 * caller paints them and sets slides[slide].cine.image). Values are checked
 * again here; the deck is validated (lengths, readable colours) when it is saved.
 */
export function applyDeckCommand(deck: DeckSpec, c: DeckCommand): { deck: DeckSpec; changed: string[]; pictures: { slide: number; subject: string }[] } {
  const changed: string[] = [];
  const pictures: { slide: number; subject: string }[] = [];
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
  const settings = withThankYouEdit(next.settings, c.thankYou);
  if (JSON.stringify(settings.thankYou) !== JSON.stringify(next.settings.thankYou)) {
    next.settings = settings;
    changed.push("thankYou");
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
    // A new 3D scene from the catalog (its colours and speed stay; a custom-written scene is replaced).
    const preset = edit.scene && next.style !== "cinematic" ? presetByName(edit.scene) : undefined;
    if (preset && preset.name !== copy.scene.preset) {
      const scene = { ...copy.scene, preset: preset.name, kind: preset.kind, compose: preset.kind === "composed" && preset.compose ? { ...preset.compose } : undefined };
      delete scene.code;
      delete scene.pending;
      copy.scene = scene;
      changed.push(`slide ${i + 1} scene`);
    }
    // A new picture (cinematic): painted by the caller.
    const subject = edit.picture?.trim();
    if (subject && next.style === "cinematic" && copy.cine && pictures.length < MAX_COMMAND_PICTURES) {
      pictures.push({ slide: i, subject: subject.slice(0, 600) });
      changed.push(`slide ${i + 1} picture`);
    }
    next.slides[i] = copy;
  }
  return { deck: next, changed, pictures };
}
