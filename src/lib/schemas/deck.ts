import { z } from "zod";
import { PRESET_NAMES, closestUnusedPreset, presetByName, type ComposeSpec } from "@/lib/deck-presets";

/**
 * DeckSpec — a 3D presentation, produced by the AI and rendered by the
 * presentation engine (src/server/deck/runtime.js.txt). The model only writes
 * content and art direction; the engine guarantees it runs.
 * Every field is required so the schema works with OpenAI strict structured outputs.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

/** Preset scenes, plus "composed": a scene the model designs from building blocks (see COMPOSE_*). */
export const SCENE_KINDS = ["composed", "galaxy", "globe", "orbits", "particles", "crystal", "knot", "helix", "bars", "cubes", "waves", "rings"] as const;
export const SceneKind = z.enum(SCENE_KINDS);
export type SceneKind = z.infer<typeof SceneKind>;

export const SCENE_KIND_HINTS: Record<SceneKind, string> = {
  composed: "a custom scene built from scene.compose (shape, arrangement, motion, material, count) — use this for most slides",
  galaxy: "spiral galaxy of glowing stars: vision, scale, the big picture",
  globe: "wireframe globe with glowing connection arcs: global reach, markets, networks",
  orbits: "a core with orbiting satellites and rings: ecosystems, products around a platform",
  particles: "drifting particle field: ideas, data, atmosphere, openings and closings",
  crystal: "faceted rotating crystal: quality, value, a core insight",
  knot: "glossy torus knot: complexity, integration, technology",
  helix: "DNA-style double helix: growth, identity, science, culture",
  bars: "3D bar chart driven by scene.values: metrics, growth, comparisons",
  cubes: "grid of rising cubes: systems, building blocks, scale",
  waves: "flowing wave surface: momentum, change, markets, sound",
  rings: "concentric rotating rings: process, cycles, layers, focus",
};

// Building blocks of a "composed" scene. 12 × 12 × 8 × 7 combinations (plus count and colours).
export const COMPOSE_SHAPES = ["sphere", "cube", "torus", "cone", "cylinder", "icosahedron", "octahedron", "dodecahedron", "tetrahedron", "capsule", "ring", "knot"] as const;
export const COMPOSE_ARRANGEMENTS = ["single", "ring", "grid", "spiral", "helix", "scatter", "stack", "wave", "orbit", "shell", "tunnel", "cluster"] as const;
export const COMPOSE_MOTIONS = ["rotate", "float", "pulse", "orbit", "wave", "swirl", "breathe", "drift"] as const;
export const COMPOSE_MATERIALS = ["glass", "metal", "wireframe", "glow", "matte", "holographic", "points"] as const;

export const ENVIRONMENTS = ["grid", "space", "ocean", "aurora", "horizon", "studio"] as const;
export const ENVIRONMENT_HINTS: Record<(typeof ENVIRONMENTS)[number], string> = {
  grid: "neon grid floor under stars: tech, startups, futuristic products",
  space: "deep space with nebulae, no floor: science, vision, astronomy, big ideas",
  ocean: "rolling sea of glowing points: nature, climate, travel, calm or flowing topics",
  aurora: "aurora curtains over a glossy floor: wellness, culture, creativity, elegant topics",
  horizon: "retro striped sun behind a grid: entertainment, music, gaming, bold launches",
  studio: "soft glossy stage with spotlight: corporate, finance, education, minimal decks",
};
export const TRANSITIONS = ["side", "dive"] as const;

const ComposeSchema = z.object({
  shape: z.enum(COMPOSE_SHAPES),
  arrangement: z.enum(COMPOSE_ARRANGEMENTS),
  motion: z.enum(COMPOSE_MOTIONS),
  material: z.enum(COMPOSE_MATERIALS),
  count: z.number(),
});

const sceneColours = {
  primary: Hex,
  secondary: Hex,
  speed: z.number().describe("Animation speed 0.2-2, 1 = normal."),
  density: z.number().describe("Amount of geometry 0.2-1."),
  values: z.array(z.number()).describe("For the bar-chart preset: 3-8 positive numbers to chart. Otherwise empty."),
};

/** What the model writes: a preset picked from the catalog by name. */
const AiSceneSchema = z.object({
  preset: z.enum(PRESET_NAMES).describe("The 3D scene for this slide, picked from the preset catalog by matching the slide's meaning to the tags. Never reuse a preset within a deck."),
  ...sceneColours,
});

/** What the engine reads (presets expanded by the server; older decks have kind only). */
const StoredSceneSchema = z.object({
  kind: SceneKind,
  preset: z.string().optional(),
  compose: ComposeSchema.optional(),
  /** A custom scene written by the model for this slide (function body; see server/deck/scene-code.ts). */
  code: z.string().max(14_000).optional(),
  /** The custom scene is still being written: the engine shows only the world for now. */
  pending: z.boolean().optional(),
  ...sceneColours,
});

const slideFields = {
  layout: z.enum(["hero", "left", "right", "center", "stats"]).describe("hero = big title slide; left/right = text on that side with the 3D scene on the other; center = text over the scene; stats = up to 4 big numbers."),
  kicker: z.string().describe("Short uppercase label above the title, e.g. 'CHAPTER 02'. Empty string for none."),
  title: z.string().describe("Slide title, at most ~8 words."),
  subtitle: z.string().describe("One supporting sentence. Empty string for none."),
  bullets: z.array(z.string()).describe("0-4 concise bullet points (at most ~12 words each)."),
  stats: z.array(z.object({ value: z.string().describe("e.g. '3.2x' or '$4M'"), label: z.string() })).describe("2-4 items for layout 'stats', otherwise empty."),
  notes: z
    .string()
    .describe(
      "What the presenter says on this slide; it is read aloud as narration with subtitles. 2-4 natural spoken sentences (about 30-60 words) that add to the slide rather than repeat it word for word. Same language as the slides. Never empty.",
    ),
};

const ThemeSchema = z.object({
  background: Hex.describe("Dark background color for best 3D contrast, e.g. #05060a"),
  text: Hex,
  accent: Hex,
  font: z.enum(["sans", "serif", "display", "mono"]).describe("Title font. Prefer display or sans; serif only for elegant, literary or luxury topics."),
  environment: z.enum(ENVIRONMENTS).describe("The 3D world the presentation travels through; pick what fits the topic."),
  transition: z.enum(TRANSITIONS).describe('Always "side" (the camera zooms out, glides sideways and zooms in). "dive" is kept only for older decks.'),
});

/** What the model writes (OpenAI strict structured output). */
/** How the camera travels into a slide, and how its text appears (runtime: travel() / animateText()). */
export const SLIDE_TRANSITIONS = ["glide", "orbit", "rise", "push", "swoop", "spin"] as const;
export const TEXT_EFFECTS = ["slide", "rise", "drop", "zoom", "blur", "flip", "letters"] as const;
const motionFields = {
  transition: z
    .enum(SLIDE_TRANSITIONS)
    .describe(
      "How the camera travels INTO this slide. Vary it: neighbouring slides never share one, and use at least 4 different ones in a deck. glide = zoom out, glide sideways, zoom in; orbit = swing round the slide in an arc; rise = lift high above the world and come down; push = quick straight dash; swoop = dip low over the floor and rise; spin = barrel roll (sparingly, at most once).",
    ),
  textEffect: z
    .enum(TEXT_EFFECTS)
    .describe(
      "How this slide's text appears. Vary it: neighbouring slides never share one. slide = in from the side; rise = up from below; drop = down from above; zoom = grows in; blur = sharpens from a blur; flip = flips up in 3D; letters = title letter by letter (best on hero and short titles).",
    ),
};

export const DeckSlideSchema = z.object({ ...slideFields, ...motionFields, scene: AiSceneSchema });
export const DeckSpecSchema = z.object({ title: z.string(), theme: ThemeSchema, slides: z.array(DeckSlideSchema) });
/**
 * Settings the owner edits by hand (the Design panel), never the model: the
 * Thank You slide the engine appends, footer branding and auto-play. Edits by
 * chat keep them (see the deck pipeline). Every part is optional in deck.json.
 */
const CtaSchema = z.object({ label: z.string(), url: z.string() });
const DeckSettingsInput = z
  .object({
    thankYou: z.object({ enabled: z.boolean(), title: z.string(), message: z.string(), buttons: z.array(CtaSchema) }).partial(),
    footer: z.object({ enabled: z.boolean(), logoUrl: z.string(), name: z.string(), link: z.string() }).partial(),
    autoplay: z.object({ enabled: z.boolean(), seconds: z.number() }).partial(),
    textScale: z.number(),
  })
  .partial();
export type DeckCta = z.infer<typeof CtaSchema>;
export type DeckSettings = {
  thankYou: { enabled: boolean; title: string; message: string; buttons: DeckCta[] };
  footer: { enabled: boolean; logoUrl: string; name: string; link: string };
  autoplay: { enabled: boolean; seconds: number };
  /** Size of the slides' text, 1 = as designed (TEXT_SCALE.min to .max); set by commands like "bigger text". */
  textScale: number;
};
export const TEXT_SCALE = { min: 0.7, max: 1.6 } as const;

/**
 * Cinematic presentations (deck.style "cinematic", see lib/schemas/cine.ts):
 * an AI photograph on every slide, animated with film-like moves and kinetic
 * typography instead of 3D scenes (engine: server/deck/cine-runtime.js.txt).
 * Each slide keeps the shared fields (layout, kicker, title, notes …) and
 * adds its cinematic motion and image here.
 */
/** Kinetic typography styles for a cinematic slide's text (cine engine: animateText). */
export const CINE_TEXT_STYLES = ["glitch", "zoom", "split", "rotate3d", "wipe", "letters", "fadeUp"] as const;
/** The image's slow move while a cinematic slide is on screen. */
export const CINE_CAMERA_MOVES = ["push", "pull", "orbit", "crane", "drift", "static"] as const;
/** How a cinematic slide arrives. */
export const CINE_TRANSITIONS = ["glide", "whip", "rise", "spiral", "zoom"] as const;
export const CINE_PACES = ["calm", "normal", "energetic"] as const;
/** Where a slide image may come from: this app's deckmedia route, or any https URL. */
export const CINE_IMAGE_RE = /^(\/deckmedia\/[A-Za-z0-9_-]{8,64}\/[A-Za-z0-9_-]{8,64}\.(?:webp|png|jpe?g)|https:\/\/\S{1,1000})$/;
const StoredCineSchema = z.object({
  text: z.enum(CINE_TEXT_STYLES),
  camera: z.enum(CINE_CAMERA_MOVES),
  transition: z.enum(CINE_TRANSITIONS),
  pace: z.enum(CINE_PACES),
  /** The slide's image prompt, derived by the server from the slide's own words. */
  imagePrompt: z.string(),
  /** The generated image ("" while it is being painted, or when painting it failed). */
  image: z.string(),
});
export type CineSlide = z.infer<typeof StoredCineSchema>;

/** What is stored in deck.json and read by the engine: presets expanded into scene descriptions. */
// Optional: decks saved before slides had them rotate through the runtime's defaults.
const StoredSlideSchema = z.object({
  ...slideFields,
  transition: motionFields.transition.optional(),
  textEffect: motionFields.textEffect.optional(),
  scene: StoredSceneSchema,
  cine: StoredCineSchema.optional(),
});
const StoredDeckSchema = z.object({
  title: z.string(),
  /** "cinematic": rendered by the cinematic engine (server/deck/cine-codegen.ts); missing = 3D. */
  style: z.enum(["3d", "cinematic"]).optional(),
  theme: ThemeSchema,
  slides: z.array(StoredSlideSchema),
  settings: DeckSettingsInput.optional(),
});
export type DeckSpec = Omit<z.infer<typeof StoredDeckSchema>, "settings"> & { settings: DeckSettings };
export type DeckSlide = DeckSpec["slides"][number];

export const DECK_LIMITS = { minSlides: 1, maxSlides: 20, maxBullets: 5, maxStats: 4, maxValues: 12, maxCount: 160, maxButtons: 3 } as const;

/** Settings of a new deck: it ends on a Thank You slide and plays by itself (the viewer's Auto control turns that off). */
export function defaultDeckSettings(): DeckSettings {
  return {
    thankYou: { enabled: true, title: "Thank you", message: "", buttons: [] },
    footer: { enabled: false, logoUrl: "", name: "", link: "" },
    autoplay: { enabled: true, seconds: 7 },
    textScale: 1,
  };
}

/** Links the engine may open: web pages, plus e-mail and phone for buttons. Anything else (javascript: …) is dropped. */
function safeUrl(url: string | undefined, schemes: RegExp = /^https?:\/\//i): string {
  const u = (url ?? "").trim().slice(0, 1000);
  return schemes.test(u) ? u : "";
}

function normalizeSettings(input: z.infer<typeof DeckSettingsInput> | undefined): DeckSettings {
  const base = defaultDeckSettings();
  // Decks saved before settings existed often end with their own closing slide: no second Thank You slide for them.
  if (!input) base.thankYou.enabled = false;
  const t = { ...base.thankYou, ...input?.thankYou };
  const f = { ...base.footer, ...input?.footer };
  const a = { ...base.autoplay, ...input?.autoplay };
  return {
    thankYou: {
      enabled: t.enabled,
      title: t.title.trim().slice(0, 120) || base.thankYou.title,
      message: t.message.slice(0, 400),
      buttons: t.buttons
        .map((b) => ({ label: b.label.trim().slice(0, 40), url: safeUrl(b.url, /^(https?:\/\/|mailto:|tel:)/i) }))
        .filter((b) => b.label && b.url)
        .slice(0, DECK_LIMITS.maxButtons),
    },
    // The logo must be https: the presentation's CSP loads images only over https.
    footer: { enabled: f.enabled, logoUrl: safeUrl(f.logoUrl, /^https:\/\//i), name: f.name.trim().slice(0, 80), link: safeUrl(f.link) },
    autoplay: { enabled: a.enabled, seconds: Math.round(clamp(a.seconds, 3, 60, 7)) },
    textScale: Math.round(clamp(input?.textScale ?? 1, TEXT_SCALE.min, TEXT_SCALE.max, 1) * 100) / 100,
  };
}

const DEFAULT_COMPOSE: ComposeSpec = { shape: "icosahedron", arrangement: "ring", motion: "rotate", material: "glow", count: 12 };

const clamp = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio of two #rrggbb colours (1-21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** `color`, moved toward black on a light background or white on a dark one until it reaches `min` contrast. */
function readableOn(color: string, background: string, min: number): string {
  if (contrastRatio(color, background) >= min) return color;
  const target = luminance(background) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const from = rgbOf(color);
  for (let t = 0.1; t < 1; t += 0.1) {
    const mixed = hexOf(from.map((v, i) => v + (target[i] - v) * t));
    if (contrastRatio(mixed, background) >= min) return mixed;
  }
  return hexOf(target);
}
/** Text is always readable on the background (WCAG AA), and the accent stands out from it. */
function readableTheme<T extends { background: string; text: string; accent: string }>(theme: T): T {
  return { ...theme, text: readableOn(theme.text, theme.background, 4.5), accent: readableOn(theme.accent, theme.background, 3) };
}

export type DeckValidation = { ok: true; deck: DeckSpec } | { ok: false; errors: string[] };

function expandPreset(scene: Record<string, unknown>): Record<string, unknown> {
  const preset = typeof scene.preset === "string" ? presetByName(scene.preset) : undefined;
  if (preset) return { ...scene, kind: preset.kind, compose: preset.kind === "composed" ? { ...preset.compose } : undefined };
  if (scene.kind === "composed" && !scene.compose) return { ...scene, compose: { ...DEFAULT_COMPOSE } };
  return scene;
}

/** Fill fields that decks saved by older versions do not have, and expand presets. */
function withLegacyDefaults(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const d = input as { theme?: unknown; slides?: unknown };
  const out: Record<string, unknown> = { ...(input as object) };
  if (d.theme && typeof d.theme === "object") out.theme = { environment: "grid", transition: "side", ...(d.theme as object) };
  if (Array.isArray(d.slides)) {
    out.slides = d.slides.map((s) => {
      if (!s || typeof s !== "object") return s;
      const slide = s as { scene?: unknown; cine?: unknown };
      // A scene from the model has a preset and no kind yet; the kind is filled in from the catalog below.
      const scene = slide.scene && typeof slide.scene === "object" ? expandPreset(slide.scene as Record<string, unknown>) : slide.scene;
      // Cinematic slides from before the image-led engine (they had a "look"): their cine block is dropped; the engine uses its defaults.
      const cine = slide.cine && typeof slide.cine === "object" && !("text" in (slide.cine as object)) ? undefined : slide.cine;
      return { ...slide, scene, cine };
    });
  }
  return out;
}

/** Validate and normalize a deck (clamps numbers, trims lists and text). */
export function validateDeck(input: unknown): DeckValidation {
  const parsed = StoredDeckSchema.safeParse(withLegacyDefaults(input));
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 15).map((i) => `${i.path.join(".") || "deck"}: ${i.message}`) };
  }
  const d = parsed.data;
  if (d.slides.length < DECK_LIMITS.minSlides) return { ok: false, errors: ["the deck needs at least one slide"] };
  const deck: DeckSpec = {
    title: d.title.trim().slice(0, 120) || "Untitled presentation",
    ...(d.style === "cinematic" ? { style: "cinematic" as const } : {}),
    theme: readableTheme(d.theme),
    slides: d.slides.slice(0, DECK_LIMITS.maxSlides).map((s) => ({
      ...s,
      kicker: s.kicker.slice(0, 60),
      title: s.title.slice(0, 160),
      subtitle: s.subtitle.slice(0, 400),
      bullets: s.bullets.filter((b) => b.trim()).slice(0, DECK_LIMITS.maxBullets).map((b) => b.slice(0, 200)),
      stats: s.stats.slice(0, DECK_LIMITS.maxStats).map((x) => ({ value: x.value.slice(0, 20), label: x.label.slice(0, 80) })),
      notes: s.notes.slice(0, 2000),
      scene: {
        ...s.scene,
        speed: clamp(s.scene.speed, 0.1, 3, 1),
        density: clamp(s.scene.density, 0.1, 1, 0.6),
        values: s.scene.values.filter((v) => Number.isFinite(v) && v >= 0).slice(0, DECK_LIMITS.maxValues),
        ...(s.scene.compose ? { compose: { ...s.scene.compose, count: Math.round(clamp(s.scene.compose.count, 1, DECK_LIMITS.maxCount, 12)) } } : {}),
      },
      ...(s.cine ? { cine: normalizeCine(s.cine) } : {}),
    })),
    settings: normalizeSettings(d.settings),
  };
  return { ok: true, deck };
}

/** Trim a cinematic slide's fields; an image from anywhere else is dropped. */
function normalizeCine(c: CineSlide): CineSlide {
  return {
    text: c.text,
    camera: c.camera,
    transition: c.transition,
    pace: c.pace,
    imagePrompt: c.imagePrompt.slice(0, 1600),
    image: CINE_IMAGE_RE.test(c.image) ? c.image : "",
  };
}

/**
 * Guarantee that no two slides of a deck look alike: a preset is used at most
 * once per deck (the bar chart excepted: charts differ by their data), and
 * neighbouring slides never share an arrangement or a classic scene. Clashes
 * are replaced by the closest unused preset by tags.
 */
export function diversifyDeck(deck: DeckSpec): DeckSpec {
  const used = new Set<string>();
  let prev: DeckSlide | null = null;
  const slides = deck.slides.map((slide) => {
    let scene = slide.scene;
    if (scene.preset && scene.kind !== "bars") {
      const clashesWithPrev =
        prev !== null &&
        ((scene.kind !== "composed" && prev.scene.kind === scene.kind) ||
          (scene.kind === "composed" && prev.scene.kind === "composed" && prev.scene.compose?.arrangement === scene.compose?.arrangement));
      if (used.has(scene.preset) || clashesWithPrev) {
        const pick = closestUnusedPreset(scene.preset, used, { arrangement: prev?.scene.compose?.arrangement, kind: prev?.scene.kind });
        scene = { ...scene, preset: pick.name, kind: pick.kind, compose: pick.kind === "composed" ? { ...pick.compose } : undefined };
      }
      used.add(scene.preset!);
    }
    // Neighbouring slides never move in the same way: a repeated (or missing)
    // transition / text effect takes the next one in the list after the previous slide's.
    const transition = varied(SLIDE_TRANSITIONS, slide.transition, prev?.transition);
    const textEffect = varied(TEXT_EFFECTS, slide.textEffect, prev?.textEffect);
    const s: DeckSlide = { ...slide, transition, textEffect, scene };
    prev = s;
    return s;
  });
  return { ...deck, slides };
}

function varied<T extends string>(list: readonly T[], value: T | undefined, previous: T | undefined): T {
  if (value && value !== previous) return value;
  return list[(list.indexOf(previous ?? list[list.length - 1]) + 1) % list.length];
}

/** Starter deck used when a presentation is created without AI (and by tests). */
export function sampleDeck(topic = "Present 3D"): DeckSpec {
  const scene = (preset: string, primary: string, secondary: string, values: number[] = []) =>
    expandPreset({ preset, primary, secondary, speed: 1, density: 0.7, values }) as DeckSlide["scene"];
  return {
    title: `${topic} — 3D presentation`,
    theme: { background: "#05060a", text: "#f2f3f7", accent: "#8b9cff", font: "display", environment: "grid", transition: "side" },
    slides: [
      { layout: "hero", transition: "rise", textEffect: "letters", kicker: "INTRODUCING", title: topic, subtitle: "Ideas that move in three dimensions.", bullets: [], stats: [], scene: scene("spiral-galaxy", "#8b9cff", "#ff7ad9"), notes: "" },
      { layout: "left", transition: "glide", textEffect: "slide", kicker: "WHY NOW", title: "Attention is the new currency", subtitle: "Flat slides blend together. Spatial stories are remembered.", bullets: ["Immersive visuals hold attention", "Motion guides the narrative", "Works in any browser"], stats: [], scene: scene("hero-crystal", "#7fe7ff", "#8b9cff"), notes: "" },
      { layout: "stats", transition: "push", textEffect: "zoom", kicker: "IMPACT", title: "Numbers that matter", subtitle: "", bullets: [], stats: [{ value: "3.2x", label: "longer viewing time" }, { value: "87%", label: "recall after a week" }, { value: "0", label: "plugins to install" }], scene: scene("bar-chart", "#8b9cff", "#5be0c3", [3, 5, 4, 7, 9]), notes: "" },
      { layout: "center", transition: "orbit", textEffect: "blur", kicker: "THANK YOU", title: "Let's build the future together", subtitle: "", bullets: [], stats: [], scene: scene("warp-tunnel", "#ff7ad9", "#8b9cff"), notes: "" },
    ],
    // Its last slide is already a closing slide.
    settings: { ...defaultDeckSettings(), thankYou: { ...defaultDeckSettings().thankYou, enabled: false } },
  };
}
