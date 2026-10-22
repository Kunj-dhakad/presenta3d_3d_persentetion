import { z } from "zod";

/**
 * DeckSpec — a 3D presentation, produced by the AI and rendered by the
 * presentation engine (src/server/deck/runtime.js.txt). The model only writes
 * content and art direction; the engine guarantees it runs.
 * Every field is required so the schema works with OpenAI strict structured outputs.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

export const SCENE_KINDS = ["galaxy", "globe", "orbits", "particles", "crystal", "knot", "helix", "bars", "cubes", "waves", "rings"] as const;
export const SceneKind = z.enum(SCENE_KINDS);
export type SceneKind = z.infer<typeof SceneKind>;

export const SCENE_KIND_HINTS: Record<SceneKind, string> = {
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

export const DeckSlideSchema = z.object({
  layout: z.enum(["hero", "left", "right", "center", "stats"]).describe("hero = big title slide; left/right = text on that side with the 3D scene on the other; center = text over the scene; stats = up to 4 big numbers."),
  kicker: z.string().describe("Short uppercase label above the title, e.g. 'CHAPTER 02'. Empty string for none."),
  title: z.string().describe("Slide title, at most ~8 words."),
  subtitle: z.string().describe("One supporting sentence. Empty string for none."),
  bullets: z.array(z.string()).describe("0-4 concise bullet points (at most ~12 words each)."),
  stats: z.array(z.object({ value: z.string().describe("e.g. '3.2x' or '$4M'"), label: z.string() })).describe("2-4 items for layout 'stats', otherwise empty."),
  scene: z.object({
    kind: SceneKind,
    primary: Hex,
    secondary: Hex,
    speed: z.number().describe("Animation speed 0.2-2, 1 = normal."),
    density: z.number().describe("Amount of geometry 0.2-1."),
    values: z.array(z.number()).describe("For kind 'bars': 3-8 positive numbers to chart. Otherwise empty."),
  }),
  notes: z.string().describe("Speaker notes. Empty string for none."),
});
export type DeckSlide = z.infer<typeof DeckSlideSchema>;

export const DeckSpecSchema = z.object({
  title: z.string(),
  theme: z.object({
    background: Hex.describe("Dark background color for best 3D contrast, e.g. #05060a"),
    text: Hex,
    accent: Hex,
    font: z.enum(["sans", "serif", "display", "mono"]),
    environment: z.enum(ENVIRONMENTS).describe("The 3D world the presentation travels through; pick what fits the topic."),
    transition: z.enum(TRANSITIONS).describe("side = camera glides sideways between slides; dive = camera flies forward into depth."),
  }),
  slides: z.array(DeckSlideSchema),
});
export type DeckSpec = z.infer<typeof DeckSpecSchema>;

export const DECK_LIMITS = { minSlides: 1, maxSlides: 20, maxBullets: 5, maxStats: 4, maxValues: 12 } as const;

const clamp = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

export type DeckValidation = { ok: true; deck: DeckSpec } | { ok: false; errors: string[] };

/** Validate and normalize a deck (clamps numbers, trims lists and text). */
export function validateDeck(input: unknown): DeckValidation {
  // Decks created before environments/transitions existed keep their original look.
  if (input && typeof input === "object" && (input as { theme?: unknown }).theme && typeof (input as { theme: unknown }).theme === "object") {
    const theme = (input as { theme: Record<string, unknown> }).theme;
    input = { ...input, theme: { environment: "grid", transition: "side", ...theme } };
  }
  const parsed = DeckSpecSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 15).map((i) => `${i.path.join(".") || "deck"}: ${i.message}`) };
  }
  const d = parsed.data;
  if (d.slides.length < DECK_LIMITS.minSlides) return { ok: false, errors: ["the deck needs at least one slide"] };
  const deck: DeckSpec = {
    title: d.title.trim().slice(0, 120) || "Untitled presentation",
    theme: d.theme,
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
      },
    })),
  };
  return { ok: true, deck };
}

/** Starter deck used when a presentation is created without AI (and by tests). */
export function sampleDeck(topic = "Strata"): DeckSpec {
  return {
    title: `${topic} — 3D presentation`,
    theme: { background: "#05060a", text: "#f2f3f7", accent: "#8b9cff", font: "display", environment: "grid", transition: "side" },
    slides: [
      { layout: "hero", kicker: "INTRODUCING", title: topic, subtitle: "Ideas that move in three dimensions.", bullets: [], stats: [], scene: { kind: "galaxy", primary: "#8b9cff", secondary: "#ff7ad9", speed: 1, density: 0.8, values: [] }, notes: "" },
      { layout: "left", kicker: "WHY NOW", title: "Attention is the new currency", subtitle: "Flat slides blend together. Spatial stories are remembered.", bullets: ["Immersive visuals hold attention", "Motion guides the narrative", "Works in any browser"], stats: [], scene: { kind: "crystal", primary: "#7fe7ff", secondary: "#8b9cff", speed: 0.8, density: 0.6, values: [] }, notes: "" },
      { layout: "stats", kicker: "IMPACT", title: "Numbers that matter", subtitle: "", bullets: [], stats: [{ value: "3.2x", label: "longer viewing time" }, { value: "87%", label: "recall after a week" }, { value: "0", label: "plugins to install" }], scene: { kind: "bars", primary: "#8b9cff", secondary: "#5be0c3", speed: 1, density: 0.6, values: [3, 5, 4, 7, 9] }, notes: "" },
      { layout: "center", kicker: "THANK YOU", title: "Let's build the future together", subtitle: "", bullets: [], stats: [], scene: { kind: "rings", primary: "#ff7ad9", secondary: "#8b9cff", speed: 1, density: 0.7, values: [] }, notes: "" },
    ],
  };
}
