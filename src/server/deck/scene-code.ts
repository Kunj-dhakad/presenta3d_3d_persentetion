import "server-only";
import vm from "node:vm";
import { z } from "zod";
import type { TextModelProvider } from "@/server/ai/types";
import type { DeckSpec } from "@/lib/schemas/deck";

/**
 * Per-slide 3D scenes written by the model at generation time.
 *
 * The model writes the BODY of a function that receives a small, documented
 * toolkit (`ctx`) and returns `{ group, update(t), enter?(tl) }` — the same
 * contract as the engine's built-in scenes. The code runs only inside the
 * sandboxed presentation document (opaque origin, CSP sandbox), never on the
 * server: here it is only compiled (syntax check) and screened.
 * Any slide whose code is missing, invalid or fails at runtime falls back to
 * its catalog preset, so a presentation never breaks.
 */

export const SCENE_CODE_MAX = 14_000;
const SCENE_TIMEOUT_MS = 100_000;

const SceneCodeSchema = z.object({
  summary: z.string().describe("One short sentence: what the scene shows and how it moves."),
  code: z.string().describe("The function body (JavaScript). Must end with `return { group, update };` (enter is optional)."),
});

// Identifiers the scene code may not touch (bare, not as a property like mesh.parent).
const FORBIDDEN = [
  "import", "export", "require", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "eval", "Function",
  "document", "window", "globalThis", "parent", "opener", "frames", "localStorage", "sessionStorage", "indexedDB",
  "caches", "cookieStore", "navigator", "postMessage", "Worker", "SharedWorker", "importScripts", "WebAssembly",
];
const FORBIDDEN_RE = new RegExp(`(?<![.\\w$])(${FORBIDDEN.join("|")})(?![\\w$])`);

/** Compile-only syntax check plus a screen for things a scene never needs. Never executes the code. */
export function validateSceneCode(code: string): { ok: true } | { ok: false; error: string } {
  if (!code.trim()) return { ok: false, error: "empty code" };
  if (code.length > SCENE_CODE_MAX) return { ok: false, error: `code is longer than ${SCENE_CODE_MAX} characters` };
  const bad = FORBIDDEN_RE.exec(code);
  if (bad) return { ok: false, error: `uses "${bad[1]}", which scenes may not use` };
  if (!/\breturn\b/.test(code) || !/\bgroup\b/.test(code)) return { ok: false, error: "must build a `group` and `return { group, update }`" };
  try {
    new vm.Script(`(function (ctx) {\n${code}\n})`, { filename: "scene.js" });
  } catch (err) {
    return { ok: false, error: `syntax error: ${(err as Error).message}` };
  }
  return { ok: true };
}

export const SCENE_CODE_SYSTEM = `You are a creative three.js developer making the animated 3D background of ONE slide in a cinematic presentation.
Write the BODY of a JavaScript function. It receives \`ctx\` and must return { group, update(t), enter(tl) }.

ctx provides (destructure what you need):
- THREE: the three.js module (r180+). gsap: GSAP 3.
- colors: { primary, secondary, accent, background } as "#rrggbb" strings; color(hex) returns a THREE.Color.
- speed (0.2-2) and density (0.2-1): scale animation speed and amount of geometry with them.
- rng(): seeded random number in [0, 1) — use it instead of Math.random so the scene is stable.
- glowPoints(positions: Float32Array, colors: Float32Array | null, size): an additive glowing THREE.Points.
- glowTexture(): a soft radial glow texture for sprites.
- standard(hexColor, hexEmissive, extraOptions): a MeshStandardMaterial preset.

Rules:
- Put everything in \`const group = new THREE.Group();\`, centred on the origin. The engine scales the finished group to fill its part of the screen, so think in proportions: a wide, cinematic composition (about 16:9), not a single small object.
- Fill the frame in layers: a large, recognisable main subject in the middle ground, supporting objects around it, and a background layer that spreads across the whole width (particle fields, rings, light beams, floating shapes) so the scene feels like a full-screen world, not an object on an empty background.
- No hard edges: the scene must blend into the dark page. Distribute background particles in a soft round or elliptical cloud whose density falls off toward the edges (e.g. gaussian or radius-weighted), never in a rectangle or box; avoid rows/grids of particles that end in straight lines.
- Do not add ground planes, platforms, pedestals or large flat discs: the world already has a floor, and flat discs turn into a big glowing plate.
- Make it clearly ABOUT this slide's subject: build recognisable objects from primitives (e.g. a coffee cup from a lathe/cylinder with a torus handle and rising steam particles; a rocket from cones and cylinders with a particle exhaust; a heart from two spheres and a cone; a city skyline from boxes; a plant from cylinders and leaf shapes; a chart from bars), combined with motion that expresses the idea.
- Cinematic quality: layered depth, readable shapes, subtle motion. Use the deck colours.
- Lighting: the scene has ambient, a key light, an environment map and a soft bloom pass. Build the main objects with lit materials (MeshStandardMaterial / MeshPhysicalMaterial: metalness, roughness, clearcoat) so their form is visible. Use MeshBasicMaterial, emissive glow and glowPoints only for small accents (lights, particles, edges). Never use white or near-white for large surfaces; keep large surfaces at most ~70% brightness so they do not bloom into a blob.
- update(t) receives elapsed seconds; animate with sin/cos and rotation. Keep it light: at most ~8,000 particles and ~300 meshes; reuse geometries and materials; no allocation inside update().
- Keep the code focused: at most about 100 lines.
- enter(tl) is optional: an entrance animation on the given GSAP timeline (e.g. scale up from 0, pieces flying in).
- Allowed: THREE, gsap, Math, the ctx helpers, plain JavaScript. Not allowed: import/export/require, fetch or any network, document, window, DOM, timers, eval/Function, workers.
- No text or fonts in 3D. Return only the function body: no surrounding function declaration, no markdown.

Example (a faceted crystal with orbiting shards):
const { THREE, colors, color, speed, density, rng, standard } = ctx;
const group = new THREE.Group();
const outer = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 0), new THREE.MeshPhysicalMaterial({ color: color(colors.primary), emissive: color(colors.secondary), emissiveIntensity: 0.15, metalness: 0.2, roughness: 0.08, clearcoat: 1, flatShading: true, transparent: true, opacity: 0.92 }));
outer.add(new THREE.LineSegments(new THREE.EdgesGeometry(outer.geometry), new THREE.LineBasicMaterial({ color: color(colors.secondary) })));
const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), standard(colors.secondary, colors.secondary, { emissiveIntensity: 1.4, flatShading: true }));
group.add(outer, inner);
const shardGeo = new THREE.OctahedronGeometry(0.18);
const shardMat = standard(colors.primary, colors.secondary, { flatShading: true });
const shards = [];
for (let i = 0; i < Math.round(6 + 10 * density); i++) {
  const m = new THREE.Mesh(shardGeo, shardMat);
  group.add(m);
  shards.push({ m, r: 3 + rng() * 1.5, a: rng() * Math.PI * 2, y: (rng() - 0.5) * 3, sp: 0.2 + rng() * 0.4 });
}
const update = (t) => {
  outer.rotation.set(t * 0.2 * speed, t * 0.3 * speed, 0);
  inner.rotation.set(-t * 0.5 * speed, -t * 0.4 * speed, 0);
  for (const s of shards) s.m.position.set(Math.cos(s.a + t * s.sp * speed) * s.r, s.y + Math.sin(t + s.a) * 0.2, Math.sin(s.a + t * s.sp * speed) * s.r);
};
const enter = (tl) => { group.scale.setScalar(0.01); tl.to(group.scale, { x: 1, y: 1, z: 1, duration: 1.4, ease: "expo.out" }); };
return { group, update, enter };`;

/** What a scene prompt needs from a slide: the stored slide and the model's streamed slide both fit. */
export type SceneSlide = {
  layout: string;
  kicker: string;
  title: string;
  subtitle: string;
  bullets: string[];
  stats: { value: string; label: string }[];
  scene: { preset?: string; kind?: string; primary: string; secondary: string; speed: number; density: number };
};
export type SceneDeckInfo = { title: string; theme: { environment: string; accent: string; background: string }; slideCount?: number };

function scenePrompt(deck: SceneDeckInfo, slide: SceneSlide, index: number) {
  return [
    `Presentation: "${deck.title}"${deck.slideCount ? ` (${deck.slideCount} slides)` : ""}. World: ${deck.theme.environment}.`,
    `Colours: primary ${slide.scene.primary}, secondary ${slide.scene.secondary}, accent ${deck.theme.accent}, background ${deck.theme.background}. speed ${slide.scene.speed}, density ${slide.scene.density}.`,
    `Slide ${index + 1} (layout "${slide.layout}"${slide.layout === "left" ? ", the text is on the left; the scene is shown on the right half of the screen" : slide.layout === "right" ? ", the text is on the right; the scene is shown on the left half of the screen" : ", the text is centred over the scene: keep the middle third dim and calm (place the main objects around it, behind it, or low) so the text stays readable"}):`,
    slide.kicker ? `Kicker: ${slide.kicker}` : "",
    `Title: ${slide.title}`,
    slide.subtitle ? `Subtitle: ${slide.subtitle}` : "",
    slide.bullets.length ? `Points: ${slide.bullets.join(" | ")}` : "",
    slide.stats.length ? `Numbers: ${slide.stats.map((s) => `${s.value} ${s.label}`).join(" | ")}` : "",
    `Mood hint (a catalog scene that fits): ${slide.scene.preset ?? slide.scene.kind ?? "any"}.`,
    "Design a 3D scene that a viewer immediately connects with THIS slide's subject, and that looks different from the other slides.",
  ]
    .filter(Boolean)
    .join("\n");
}

type WriterOptions = { userId: string; jobId: string; signal: AbortSignal; log: (message: string, level?: "info" | "warn") => void; concurrency?: number };

/**
 * Writes slide scenes in the background. `start()` can be called as soon as a
 * slide's text is known (even while the rest of the deck is still streaming);
 * up to `concurrency` scenes are written at once. `results()` waits for all
 * started scenes. A slide whose scene fails simply has no code (its catalog
 * scene is used).
 */
export class SceneWriter {
  private tasks = new Map<number, Promise<string | null>>();
  /** Finished scenes: their code, or null when writing it failed. */
  private finished = new Map<number, string | null>();
  private running = 0;
  private waiting: (() => void)[] = [];
  private done = 0;

  constructor(
    private provider: TextModelProvider,
    private opts: WriterOptions,
  ) {}

  get started() {
    return this.tasks.size;
  }

  has(index: number) {
    return this.tasks.has(index);
  }

  start(deck: SceneDeckInfo, slide: SceneSlide, index: number) {
    if (this.tasks.has(index) || this.opts.signal.aborted) return;
    const task = this.run(deck, slide, index).catch((err) => {
      if (!this.opts.signal.aborted) this.opts.log(`Slide ${index + 1}: custom scene failed (${(err as Error).message.slice(0, 160)}); using the catalog scene instead`, "warn");
      return null;
    });
    void task.then((code) => this.finished.set(index, code));
    this.tasks.set(index, task);
  }

  /** Scenes finished so far: code, or null when writing it failed. */
  settled(): Map<number, string | null> {
    return new Map(this.finished);
  }

  /** Wait until every started scene has finished, or until `deadline` (ms epoch), whichever comes first. */
  async until(deadline: number): Promise<void> {
    const all = Promise.all(this.tasks.values()).then(() => {});
    if (deadline === Infinity) return all;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([all, new Promise<void>((r) => (timer = setTimeout(r, Math.max(0, deadline - Date.now()))))]);
    clearTimeout(timer);
    // Let scenes that resolved in the same tick be recorded in `finished`.
    await new Promise((r) => setImmediate(r));
  }

  async results(): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    await Promise.all([...this.tasks].map(async ([i, t]) => {
      const code = await t;
      if (code) out.set(i, code);
    }));
    return out;
  }

  private async slot() {
    if (this.running >= (this.opts.concurrency ?? 8)) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
  }

  private release() {
    this.running--;
    this.waiting.shift()?.();
  }

  private async run(deck: SceneDeckInfo, slide: SceneSlide, index: number): Promise<string | null> {
    await this.slot();
    try {
      let extra = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await this.provider.structured({
          operation: "deck.scene",
          schema: SceneCodeSchema,
          schemaName: "scene_code",
          system: SCENE_CODE_SYSTEM,
          input: scenePrompt(deck, slide, index) + extra,
          maxOutputTokens: 8_000,
          reasoningEffort: "low",
          // A scene that takes too long is skipped (its catalog scene is used) rather than holding up the deck.
          signal: AbortSignal.any([this.opts.signal, AbortSignal.timeout(SCENE_TIMEOUT_MS)]),
          userId: this.opts.userId,
          jobId: this.opts.jobId,
        });
        const code = res.data.code.replace(/^```(?:js|javascript)?\s*|```\s*$/g, "").trim();
        const v = validateSceneCode(code);
        if (v.ok) {
          this.done++;
          this.opts.log(`Scene ready — slide ${index + 1}: ${res.data.summary.slice(0, 120)}`);
          return code;
        }
        extra = `\n\nYour previous code was rejected: ${v.error}. Write it again following the rules.`;
      }
      this.opts.log(`Slide ${index + 1}: custom scene was rejected twice; using the catalog scene instead`, "warn");
      return null;
    } finally {
      this.release();
    }
  }
}

/**
 * From the partial JSON of a deck that is still streaming, return the deck
 * header (title, theme) and every slide object that is already complete.
 * Never throws; returns what can be parsed so far.
 */
export function completedSlides(text: string): { head: SceneDeckInfo | null; slides: unknown[] } {
  const m = /"slides"\s*:\s*\[/.exec(text);
  if (!m) return { head: null, slides: [] };
  let head: SceneDeckInfo | null = null;
  try {
    const parsed = JSON.parse(`${text.slice(0, m.index)}"slides":[]}`) as { title?: unknown; theme?: Record<string, unknown> };
    if (typeof parsed.title === "string" && parsed.theme) {
      head = { title: parsed.title, theme: { environment: String(parsed.theme.environment ?? ""), accent: String(parsed.theme.accent ?? ""), background: String(parsed.theme.background ?? "") } };
    }
  } catch {
    /* header not complete yet */
  }
  const slides: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let begin = -1;
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) begin = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && begin >= 0) {
        try {
          slides.push(JSON.parse(text.slice(begin, i + 1)));
        } catch {
          /* ignore */
        }
        begin = -1;
      }
    } else if (c === "]" && depth === 0) break;
  }
  return { head, slides };
}

/** A streamed slide is usable for a scene prompt once it has these fields. */
export function asSceneSlide(raw: unknown): SceneSlide | null {
  const s = raw as Partial<SceneSlide> | null;
  if (!s || typeof s.title !== "string" || typeof s.layout !== "string" || !s.scene || typeof s.scene.primary !== "string") return null;
  return {
    layout: s.layout,
    kicker: typeof s.kicker === "string" ? s.kicker : "",
    title: s.title,
    subtitle: typeof s.subtitle === "string" ? s.subtitle : "",
    bullets: Array.isArray(s.bullets) ? s.bullets.filter((b): b is string => typeof b === "string") : [],
    stats: Array.isArray(s.stats) ? s.stats : [],
    scene: { preset: s.scene.preset, primary: s.scene.primary, secondary: String(s.scene.secondary ?? s.scene.primary), speed: Number(s.scene.speed ?? 1), density: Number(s.scene.density ?? 0.6) },
  };
}

type Slide = DeckSpec["slides"][number];
const fingerprint = (s: Slide) => JSON.stringify([s.title, s.subtitle, s.layout, s.scene.preset, s.scene.primary, s.scene.secondary]);

/** Copy scenes from `previous` onto slides whose content and look did not change (edits). Returns the indexes still without a scene. */
export function reuseScenes(deck: DeckSpec, previous: DeckSpec | null): { deck: DeckSpec; missing: number[] } {
  const reuse = new Map<string, string>();
  for (const s of previous?.slides ?? []) if (s.scene.code) reuse.set(fingerprint(s), s.scene.code);
  const missing: number[] = [];
  const slides = deck.slides.map((s, i) => {
    const kept = reuse.get(fingerprint(s));
    const scene = { ...s.scene };
    if (kept) scene.code = kept;
    else {
      delete scene.code;
      missing.push(i);
    }
    return { ...s, scene };
  });
  return { deck: { ...deck, slides }, missing };
}

/** The deck as context for the model when editing: scene code is left out (it is large and not needed). */
export function deckForPrompt(deck: DeckSpec): DeckSpec {
  return { ...deck, slides: deck.slides.map((s) => ({ ...s, scene: { ...s.scene, code: undefined, compose: undefined } })) };
}

/**
 * Write a 3D scene for every slide (in parallel). Scenes from `previous` are
 * reused for slides whose content and look did not change in an edit.
 */
export async function addSceneCode(deck: DeckSpec, previous: DeckSpec | null, provider: TextModelProvider, opts: WriterOptions): Promise<DeckSpec> {
  const { deck: reused, missing } = reuseScenes(deck, previous);
  if (!missing.length) return reused;
  opts.log(`Designing ${missing.length} custom 3D scene${missing.length > 1 ? "s" : ""} with ${provider.model}`);
  const writer = new SceneWriter(provider, opts);
  const info: SceneDeckInfo = { title: deck.title, theme: deck.theme, slideCount: deck.slides.length };
  for (const i of missing) writer.start(info, reused.slides[i], i);
  return withScenes(reused, await writer.results());
}

export function withScenes(deck: DeckSpec, codes: Map<number, string>): DeckSpec {
  return { ...deck, slides: deck.slides.map((s, i) => (codes.has(i) ? { ...s, scene: { ...s.scene, code: codes.get(i) } } : s)) };
}
