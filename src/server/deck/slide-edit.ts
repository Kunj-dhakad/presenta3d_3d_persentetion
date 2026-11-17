import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { HttpError } from "@/server/http/api";
import { storage } from "@/server/storage/storage";
import { DECK_LIMITS, type DeckSlide, type DeckSpec } from "@/lib/schemas/deck";
import { cinePromptFor } from "@/lib/schemas/cine";

/**
 * The Slide content panel (components/workspace/slide-editor.tsx): a slide's words changed by hand,
 * and on a cinematic slide the presenter's own picture. Every change is saved like the Design panel's
 * (store.ts saveDeck: rebuilt, a version to undo it).
 */

export const SLIDE_LAYOUTS = ["hero", "left", "right", "center", "stats"] as const;

/** What the panel shows of each slide. */
export function slidesView(deck: DeckSpec) {
  return {
    style: deck.style === "cinematic" ? ("cinematic" as const) : ("3d" as const),
    // The engine adds it after the last slide (the preview counts it); it is changed in Settings.
    thankYou: deck.settings.thankYou.enabled,
    slides: deck.slides.map((s) => ({
      layout: s.layout,
      kicker: s.kicker,
      title: s.title,
      subtitle: s.subtitle,
      bullets: s.bullets,
      stats: s.stats,
      notes: s.notes,
      image: s.cine?.image ?? "",
      ownImage: Boolean(s.cine?.locked),
    })),
  };
}
export type SlidesView = ReturnType<typeof slidesView>;

export const SlideEditSchema = z.object({
  layout: z.enum(SLIDE_LAYOUTS),
  kicker: z.string().max(60),
  title: z.string().max(160),
  subtitle: z.string().max(400),
  bullets: z.array(z.string().max(200)).max(DECK_LIMITS.maxBullets),
  stats: z.array(z.object({ value: z.string().max(20), label: z.string().max(80) })).max(DECK_LIMITS.maxStats),
  notes: z.string().max(2000),
});
export type SlideEdit = z.infer<typeof SlideEditSchema>;

function slideAt(deck: DeckSpec, index: number): DeckSlide {
  const slide = deck.slides[index];
  if (!slide) throw new HttpError(404, "This slide no longer exists. Reopen the panel.", "NO_SLIDE");
  return slide;
}

/** The deck with slide `index`'s words (and layout) changed by hand. */
export function withSlideEdit(deck: DeckSpec, index: number, edit: SlideEdit): DeckSpec {
  const old = slideAt(deck, index);
  const title = edit.title.trim();
  if (!title) throw new HttpError(400, "Give the slide a title.", "VALIDATION");
  const stats = edit.stats.map((x) => ({ value: x.value.trim(), label: x.label.trim() })).filter((x) => x.value || x.label);
  if (edit.layout === "stats" && !stats.length) throw new HttpError(400, "Add at least one number for the Numbers layout.", "VALIDATION");
  const next: DeckSlide = {
    ...old,
    layout: edit.layout,
    kicker: edit.kicker.trim(),
    title,
    subtitle: edit.subtitle.trim(),
    bullets: edit.bullets.map((b) => b.trim()).filter(Boolean),
    // Numbers only show on the Numbers layout; kept there only.
    stats: edit.layout === "stats" ? stats : [],
    notes: edit.notes.trim(),
  };
  const slides = deck.slides.slice();
  slides[index] = next;
  const changed: DeckSpec = { ...deck, slides };
  // A cinematic slide's image prompt follows its words (the picture stays): an AI edit that keeps these words keeps the picture.
  if (next.cine) slides[index] = { ...next, cine: { ...next.cine, imagePrompt: cinePromptFor(changed, index) } };
  return changed;
}

/** Image types the panel accepts, told apart by their first bytes (not by what the browser says). */
function imageType(data: Uint8Array): { ext: "png" | "jpg" | "webp"; mime: string } | null {
  const b = data;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { ext: "webp", mime: "image/webp" };
  return null;
}

export const MAX_SLIDE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Store the presenter's picture (deckmedia/<projectId>/, served by app/deckmedia like the painted ones); its address. */
export async function storeSlideImage(projectId: string, data: Uint8Array): Promise<string> {
  const type = imageType(data);
  if (!type) throw new HttpError(400, "Upload a PNG, JPG or WebP image.", "BAD_IMAGE");
  const name = randomBytes(12).toString("base64url");
  await storage().put(`deckmedia/${projectId}/${name}.${type.ext}`, data, type.mime);
  return `/deckmedia/${projectId}/${name}.${type.ext}`;
}

function cineSlide(deck: DeckSpec, index: number) {
  if (deck.style !== "cinematic") throw new HttpError(400, "Only cinematic slides have a picture.", "NOT_CINEMATIC");
  const slide = slideAt(deck, index);
  if (!slide.cine) throw new HttpError(409, "This slide has no picture yet. Regenerate it in the chat.", "NO_PICTURE");
  return { slide, cine: slide.cine };
}

/** Throws unless slide `index` is a cinematic slide that can take a picture (checked before anything is stored). */
export function assertPictureSlide(deck: DeckSpec, index: number): void {
  cineSlide(deck, index);
}

/** The deck with the presenter's picture on slide `index` (kept through AI edits); the AI picture it replaces is kept to go back to. */
export function withOwnImage(deck: DeckSpec, index: number, image: string): DeckSpec {
  const { slide, cine } = cineSlide(deck, index);
  const aiImage = cine.locked ? cine.aiImage : cine.image || undefined;
  const slides = deck.slides.slice();
  slides[index] = { ...slide, cine: { ...cine, image, locked: true, ...(aiImage ? { aiImage } : {}) } };
  return { ...deck, slides };
}

/**
 * The deck with slide `index` back on its AI picture: the one the presenter's replaced, or, when there
 * is none, `painted` (a new one the caller paints from the slide's image prompt). null: nothing to change.
 */
export function withAiImage(deck: DeckSpec, index: number, painted?: string): DeckSpec | null {
  const { slide, cine } = cineSlide(deck, index);
  if (!cine.locked) return null;
  const image = cine.aiImage || painted || "";
  if (!image) return null;
  const slides = deck.slides.slice();
  slides[index] = { ...slide, cine: { text: cine.text, camera: cine.camera, transition: cine.transition, pace: cine.pace, imagePrompt: cine.imagePrompt, image } };
  return { ...deck, slides };
}

/** Whether going back to the AI picture needs one painted (none was kept). */
export function needsPainting(deck: DeckSpec, index: number): boolean {
  const { cine } = cineSlide(deck, index);
  return Boolean(cine.locked && !cine.aiImage);
}

/** The slide's image prompt, as its words are now. */
export function promptFor(deck: DeckSpec, index: number): string {
  const { cine } = cineSlide(deck, index);
  return cine.imagePrompt || cinePromptFor(deck, index);
}
