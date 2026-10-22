import { z } from "zod";

/**
 * SceneSpec — the declarative, validated description of a 3D scene that the
 * 3D Studio renders and the AI is allowed to produce. All fields are required
 * (OpenAI strict structured outputs need that); `normalizeScene` fills defaults
 * for partial or user-imported data before validation.
 */

const Vec3 = z.array(z.number()).length(3);
export type Vec3 = number[];

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

export const OBJECT_TYPES = [
  "sphere",
  "box",
  "torus",
  "torusKnot",
  "plane",
  "cylinder",
  "cone",
  "icosahedron",
  "ring",
  "particles",
  "starfield",
  "terrain",
  "text",
  "group",
] as const;
export const SceneObjectType = z.enum(OBJECT_TYPES);
export type SceneObjectType = z.infer<typeof SceneObjectType>;

export const MaterialSchema = z.object({
  type: z.enum(["standard", "physical", "basic", "toon", "normal"]),
  color: Hex,
  emissive: Hex,
  emissiveIntensity: z.number().min(0).max(20),
  metalness: z.number().min(0).max(1),
  roughness: z.number().min(0).max(1),
  opacity: z.number().min(0).max(1),
  wireframe: z.boolean(),
  flatShading: z.boolean(),
});
export type MaterialSpec = z.infer<typeof MaterialSchema>;

export const AnimationSchema = z.object({
  type: z.enum(["none", "spin", "orbit", "float", "pulse"]),
  speed: z.number().min(-20).max(20).describe("Radians/sec for spin & orbit, cycles/sec for float & pulse."),
  axis: z.enum(["x", "y", "z"]),
  radius: z.number().min(0).max(500).describe("Orbit radius around the parent origin, or float amplitude."),
  phase: z.number().describe("Start offset in radians."),
});
export type AnimationSpec = z.infer<typeof AnimationSchema>;

export const ObjectParamsSchema = z.object({
  size: z.number().min(0.001).max(1000).describe("Primary size: radius (sphere/torus/ring/cone/cylinder/icosahedron), width (box/plane/terrain), spread radius (particles/starfield), font size (text)."),
  size2: z.number().min(0).max(1000).describe("Secondary size: height (box/cylinder/cone/plane depth), tube radius (torus/torusKnot), inner radius (ring)."),
  size3: z.number().min(0).max(1000).describe("Tertiary size: depth (box). Otherwise 0."),
  detail: z.number().int().min(0).max(256).describe("Segments / subdivision level."),
  count: z.number().int().min(0).max(20000).describe("Particle/star count. 0 for non-particle types."),
  amplitude: z.number().min(0).max(200).describe("Terrain height amplitude. 0 otherwise."),
  seed: z.number().int().describe("Deterministic seed for procedural types."),
  text: z.string().max(200).describe("Text content for type=text. Empty otherwise."),
});
export type ObjectParams = z.infer<typeof ObjectParamsSchema>;

export const SceneObjectSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  name: z.string().max(80),
  type: SceneObjectType,
  parentId: z.string().nullable(),
  position: Vec3,
  rotation: Vec3.describe("Euler radians."),
  scale: Vec3,
  params: ObjectParamsSchema,
  material: MaterialSchema,
  animation: AnimationSchema,
  castShadow: z.boolean(),
  receiveShadow: z.boolean(),
  visible: z.boolean(),
  label: z.string().max(120).describe("Floating annotation text. Empty for none."),
  interaction: z.enum(["none", "hover-highlight", "click-focus", "click-toggle-animation"]),
  role: z.enum(["none", "player", "collectible", "obstacle"]).describe("Game role; only used when controls.mode = player."),
});
export type SceneObject = z.infer<typeof SceneObjectSchema>;

export const LightSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  name: z.string().max(80),
  type: z.enum(["ambient", "directional", "point", "spot", "hemisphere"]),
  color: Hex,
  groundColor: Hex,
  intensity: z.number().min(0).max(1000),
  position: Vec3,
  castShadow: z.boolean(),
  distance: z.number().min(0).max(10000),
  angle: z.number().min(0).max(Math.PI / 2),
});
export type LightSpec = z.infer<typeof LightSchema>;

export const CameraSchema = z.object({
  position: Vec3,
  target: Vec3,
  fov: z.number().min(10).max(120),
  autoRotate: z.boolean(),
  autoRotateSpeed: z.number().min(-20).max(20),
});

export const EnvironmentSchema = z.object({
  background: Hex,
  fog: z.boolean(),
  fogColor: Hex,
  fogNear: z.number().min(0),
  fogFar: z.number().min(0),
  grid: z.boolean(),
  ground: z.boolean(),
  groundColor: Hex,
  shadows: z.boolean(),
  exposure: z.number().min(0.1).max(4),
  preset: z.enum(["none", "studio", "sunset", "night", "city"]).describe("Local reflection environment built from light formers."),
});

export const ControlsSchema = z.object({
  mode: z.enum(["orbit", "player"]),
  playerSpeed: z.number().min(0).max(100),
  bounds: z.number().min(1).max(1000).describe("Half-size of the playable square area."),
});

export const SceneSpecSchema = z.object({
  version: z.number().int().min(1).max(1),
  title: z.string().max(80),
  description: z.string().max(400),
  objects: z.array(SceneObjectSchema),
  lights: z.array(LightSchema),
  camera: CameraSchema,
  environment: EnvironmentSchema,
  controls: ControlsSchema,
  timeline: z.object({
    duration: z.number().min(1).max(600),
    loop: z.boolean(),
  }),
});
export type SceneSpec = z.infer<typeof SceneSpecSchema>;

export const SCENE_LIMITS = { maxObjects: 400, maxLights: 16 } as const;

// ─── Defaults & normalization ────────────────────────────────────────────

export const DEFAULT_MATERIAL: MaterialSpec = {
  type: "standard",
  color: "#cccccc",
  emissive: "#000000",
  emissiveIntensity: 0,
  metalness: 0.1,
  roughness: 0.6,
  opacity: 1,
  wireframe: false,
  flatShading: false,
};

export const DEFAULT_ANIMATION: AnimationSpec = { type: "none", speed: 1, axis: "y", radius: 0, phase: 0 };

export const DEFAULT_PARAMS: ObjectParams = {
  size: 1,
  size2: 0.4,
  size3: 1,
  detail: 32,
  count: 0,
  amplitude: 0,
  seed: 1,
  text: "",
};

export function defaultParamsFor(type: SceneObjectType): ObjectParams {
  switch (type) {
    case "box":
      return { ...DEFAULT_PARAMS, size: 1, size2: 1, size3: 1, detail: 1 };
    case "plane":
      return { ...DEFAULT_PARAMS, size: 10, size2: 10, detail: 1 };
    case "torus":
      return { ...DEFAULT_PARAMS, size: 1, size2: 0.3, detail: 48 };
    case "torusKnot":
      return { ...DEFAULT_PARAMS, size: 1, size2: 0.3, detail: 128 };
    case "cylinder":
    case "cone":
      return { ...DEFAULT_PARAMS, size: 0.6, size2: 1.5, detail: 32 };
    case "icosahedron":
      return { ...DEFAULT_PARAMS, size: 1, detail: 0 };
    case "ring":
      return { ...DEFAULT_PARAMS, size: 1.5, size2: 1, detail: 64 };
    case "particles":
      return { ...DEFAULT_PARAMS, size: 8, count: 2000, detail: 0 };
    case "starfield":
      return { ...DEFAULT_PARAMS, size: 200, count: 4000, detail: 0 };
    case "terrain":
      return { ...DEFAULT_PARAMS, size: 40, detail: 96, amplitude: 3 };
    case "text":
      return { ...DEFAULT_PARAMS, size: 0.6, text: "Hello" };
    case "group":
      return { ...DEFAULT_PARAMS, size: 1 };
    default:
      return { ...DEFAULT_PARAMS };
  }
}

export function createObject(type: SceneObjectType, id: string, overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    name: overrides.name ?? `${type[0].toUpperCase()}${type.slice(1)}`,
    type,
    parentId: null,
    position: [0, type === "plane" || type === "terrain" ? 0 : 1, 0],
    rotation: type === "plane" ? [-Math.PI / 2, 0, 0] : [0, 0, 0],
    scale: [1, 1, 1],
    params: defaultParamsFor(type),
    material: { ...DEFAULT_MATERIAL },
    animation: { ...DEFAULT_ANIMATION },
    castShadow: type !== "plane" && type !== "terrain" && type !== "particles" && type !== "starfield",
    receiveShadow: type === "plane" || type === "terrain",
    visible: true,
    label: "",
    interaction: "none",
    role: "none",
    ...overrides,
  };
}

export const DEFAULT_ENVIRONMENT: SceneSpec["environment"] = {
  background: "#0a0a0c",
  fog: false,
  fogColor: "#0a0a0c",
  fogNear: 20,
  fogFar: 120,
  grid: false,
  ground: false,
  groundColor: "#111114",
  shadows: true,
  exposure: 1,
  preset: "none",
};

export function emptyScene(title = "Untitled scene"): SceneSpec {
  return {
    version: 1,
    title,
    description: "",
    objects: [],
    lights: [
      { id: "ambient", name: "Ambient", type: "ambient", color: "#ffffff", groundColor: "#000000", intensity: 0.4, position: [0, 0, 0], castShadow: false, distance: 0, angle: 0.6 },
      { id: "key", name: "Key light", type: "directional", color: "#ffffff", groundColor: "#000000", intensity: 2, position: [5, 8, 5], castShadow: true, distance: 0, angle: 0.6 },
    ],
    camera: { position: [6, 4, 8], target: [0, 0, 0], fov: 50, autoRotate: false, autoRotateSpeed: 0.5 },
    environment: { ...DEFAULT_ENVIRONMENT, grid: true },
    controls: { mode: "orbit", playerSpeed: 6, bounds: 20 },
    timeline: { duration: 30, loop: true },
  };
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

/** Fill defaults for partially specified scene data (imports, older saves, AI drafts). */
export function normalizeScene(input: unknown): unknown {
  if (!isObj(input)) return input;
  const base = emptyScene(typeof input.title === "string" ? input.title : "Untitled scene");
  const objects = Array.isArray(input.objects)
    ? input.objects.map((o, i) => {
        if (!isObj(o)) return o;
        const type = (typeof o.type === "string" ? o.type : "box") as SceneObjectType;
        const def = createObject(OBJECT_TYPES.includes(type) ? type : "box", typeof o.id === "string" ? o.id : `obj-${i}`);
        return {
          ...def,
          ...o,
          params: { ...defaultParamsFor(def.type), ...(isObj(o.params) ? o.params : {}) },
          material: { ...DEFAULT_MATERIAL, ...(isObj(o.material) ? o.material : {}) },
          animation: { ...DEFAULT_ANIMATION, ...(isObj(o.animation) ? o.animation : {}) },
        };
      })
    : base.objects;
  const lights = Array.isArray(input.lights)
    ? input.lights.map((l, i) => (isObj(l) ? { ...base.lights[1], id: `light-${i}`, name: `Light ${i + 1}`, ...l } : l))
    : base.lights;
  return {
    ...base,
    ...input,
    version: 1,
    objects,
    lights,
    camera: { ...base.camera, ...(isObj(input.camera) ? input.camera : {}) },
    environment: { ...base.environment, ...(isObj(input.environment) ? input.environment : {}) },
    controls: { ...base.controls, ...(isObj(input.controls) ? input.controls : {}) },
    timeline: { ...base.timeline, ...(isObj(input.timeline) ? input.timeline : {}) },
  };
}

export type SceneValidation = { ok: true; scene: SceneSpec } | { ok: false; errors: string[] };

/** Schema validation plus referential checks (unique ids, valid parents, no cycles, limits). */
export function validateScene(input: unknown): SceneValidation {
  const parsed = SceneSpecSchema.safeParse(normalizeScene(input));
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "scene"}: ${i.message}`) };
  }
  const scene = parsed.data;
  const errors: string[] = [];
  if (scene.objects.length > SCENE_LIMITS.maxObjects) errors.push(`too many objects (${scene.objects.length} > ${SCENE_LIMITS.maxObjects})`);
  if (scene.lights.length > SCENE_LIMITS.maxLights) errors.push(`too many lights (${scene.lights.length} > ${SCENE_LIMITS.maxLights})`);
  const ids = new Set<string>();
  for (const o of [...scene.objects, ...scene.lights]) {
    if (ids.has(o.id)) errors.push(`duplicate id "${o.id}"`);
    ids.add(o.id);
  }
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  for (const o of scene.objects) {
    if (o.parentId !== null && !byId.has(o.parentId)) errors.push(`object "${o.id}" has unknown parent "${o.parentId}"`);
    // cycle detection
    let cur: SceneObject | undefined = o;
    let steps = 0;
    while (cur && cur.parentId !== null && steps <= scene.objects.length) {
      cur = byId.get(cur.parentId);
      steps++;
    }
    if (steps > scene.objects.length) errors.push(`object "${o.id}" is part of a parent cycle`);
  }
  const totalParticles = scene.objects.reduce((n, o) => n + (o.type === "particles" || o.type === "starfield" ? o.params.count : 0), 0);
  if (totalParticles > 60000) errors.push(`total particle count ${totalParticles} exceeds 60000`);
  if (scene.controls.mode === "player" && !scene.objects.some((o) => o.role === "player")) {
    errors.push('controls.mode is "player" but no object has role "player"');
  }
  return errors.length ? { ok: false, errors } : { ok: true, scene };
}
