import {
  createObject,
  emptyScene,
  type LightSpec,
  type SceneObject,
  type SceneSpec,
} from "@/lib/schemas/scene";

/** Deterministic PRNG so procedural templates are identical on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const light = (l: Partial<LightSpec> & Pick<LightSpec, "id" | "type">): LightSpec => ({
  name: l.id,
  color: "#ffffff",
  groundColor: "#000000",
  intensity: 1,
  position: [0, 5, 0],
  castShadow: false,
  distance: 0,
  angle: 0.6,
  ...l,
});

const mat = (o: SceneObject, m: Partial<SceneObject["material"]>): SceneObject => ({ ...o, material: { ...o.material, ...m } });

// ─── 1. Solar system ─────────────────────────────────────────────────────

export function solarSystem(): SceneSpec {
  const s = emptyScene("Solar system");
  s.description = "The sun and eight planets on animated orbits with labels, a moon, Saturn's rings and a starfield.";
  const objects: SceneObject[] = [];
  objects.push(
    mat(
      createObject("sphere", "sun", {
        name: "Sun",
        position: [0, 0, 0],
        params: { size: 2.2, size2: 0, size3: 0, detail: 64, count: 0, amplitude: 0, seed: 1, text: "" },
        animation: { type: "spin", speed: 0.08, axis: "y", radius: 0, phase: 0 },
        castShadow: false,
        label: "Sun",
        interaction: "click-focus",
      }),
      { type: "basic", color: "#ffb347", emissive: "#ff8c1a", emissiveIntensity: 2 },
    ),
  );
  const planets: [string, string, number, number, number, string][] = [
    ["mercury", "Mercury", 0.25, 3.6, 1.6, "#a39e98"],
    ["venus", "Venus", 0.45, 5, 1.2, "#e3c27a"],
    ["earth", "Earth", 0.5, 6.8, 1.0, "#3f7fd9"],
    ["mars", "Mars", 0.36, 8.6, 0.8, "#c1502e"],
    ["jupiter", "Jupiter", 1.1, 12, 0.43, "#d8a878"],
    ["saturn", "Saturn", 0.9, 15.5, 0.32, "#e6cf98"],
    ["uranus", "Uranus", 0.7, 18.5, 0.23, "#9fd8e0"],
    ["neptune", "Neptune", 0.68, 21, 0.18, "#4766d6"],
  ];
  planets.forEach(([id, name, r, orbit, speed, color], i) => {
    objects.push(
      mat(
        createObject("ring", `${id}-orbit`, {
          name: `${name} orbit`,
          parentId: "sun",
          position: [0, 0, 0],
          rotation: [-Math.PI / 2, 0, 0],
          params: { size: orbit + 0.015, size2: orbit - 0.015, size3: 0, detail: 128, count: 0, amplitude: 0, seed: 1, text: "" },
          castShadow: false,
        }),
        { type: "basic", color: "#ffffff", opacity: 0.12 },
      ),
    );
    objects.push(
      mat(
        createObject("sphere", id, {
          name,
          parentId: "sun",
          position: [0, 0, 0],
          params: { size: r, size2: 0, size3: 0, detail: 48, count: 0, amplitude: 0, seed: 1, text: "" },
          animation: { type: "orbit", speed, axis: "y", radius: orbit, phase: i * 0.9 },
          label: name,
          interaction: "click-focus",
        }),
        { color, roughness: 0.85, metalness: 0 },
      ),
    );
  });
  objects.push(
    mat(
      createObject("sphere", "moon", {
        name: "Moon",
        parentId: "earth",
        position: [0, 0, 0],
        params: { size: 0.14, size2: 0, size3: 0, detail: 32, count: 0, amplitude: 0, seed: 1, text: "" },
        animation: { type: "orbit", speed: 3, axis: "y", radius: 0.9, phase: 0 },
      }),
      { color: "#cfcfcf" },
    ),
    mat(
      createObject("ring", "saturn-rings", {
        name: "Saturn rings",
        parentId: "saturn",
        position: [0, 0, 0],
        rotation: [-Math.PI / 2.4, 0, 0],
        params: { size: 1.9, size2: 1.15, size3: 0, detail: 96, count: 0, amplitude: 0, seed: 1, text: "" },
        castShadow: false,
      }),
      { type: "standard", color: "#d9c48f", opacity: 0.75, roughness: 1 },
    ),
    mat(createObject("starfield", "stars", { name: "Starfield", position: [0, 0, 0], params: { size: 260, size2: 0, size3: 0, detail: 0, count: 6000, amplitude: 0, seed: 7, text: "" } }), { type: "basic", color: "#ffffff" }),
  );
  s.objects = objects;
  s.lights = [
    light({ id: "ambient", type: "ambient", intensity: 0.08 }),
    light({ id: "sunlight", name: "Sunlight", type: "point", color: "#fff1d6", intensity: 400, position: [0, 0, 0], distance: 0, castShadow: true }),
  ];
  s.camera = { position: [0, 16, 30], target: [0, 0, 0], fov: 50, autoRotate: false, autoRotateSpeed: 0.3 };
  s.environment = { ...s.environment, background: "#020208", grid: false, shadows: true, exposure: 1.1 };
  s.timeline = { duration: 120, loop: true };
  return s;
}

// ─── 2. Cinematic product showcase ───────────────────────────────────────

export function productShowcase(): SceneSpec {
  const s = emptyScene("Product showcase");
  s.description = "A brushed-metal bottle on a turntable under studio lighting, with material annotations.";
  s.objects = [
    mat(createObject("cylinder", "pedestal", { name: "Pedestal", position: [0, -0.15, 0], params: { size: 2.2, size2: 0.3, size3: 0, detail: 96, count: 0, amplitude: 0, seed: 1, text: "" }, receiveShadow: true }), { color: "#1b1b1f", roughness: 0.35, metalness: 0.2 }),
    createObject("group", "product", { name: "Bottle", position: [0, 0, 0], animation: { type: "spin", speed: 0.35, axis: "y", radius: 0, phase: 0 } }),
    mat(createObject("cylinder", "body", { name: "Body", parentId: "product", position: [0, 1.25, 0], params: { size: 0.62, size2: 2.2, size3: 0, detail: 96, count: 0, amplitude: 0, seed: 1, text: "" }, label: "Brushed aluminium body", interaction: "hover-highlight" }), { type: "physical", color: "#b9bcc4", metalness: 1, roughness: 0.28 }),
    mat(createObject("sphere", "shoulder", { name: "Shoulder", parentId: "product", position: [0, 2.35, 0], scale: [1, 0.45, 1], params: { size: 0.62, size2: 0, size3: 0, detail: 96, count: 0, amplitude: 0, seed: 1, text: "" } }), { type: "physical", color: "#b9bcc4", metalness: 1, roughness: 0.28 }),
    mat(createObject("cylinder", "cap", { name: "Cap", parentId: "product", position: [0, 2.85, 0], params: { size: 0.3, size2: 0.55, size3: 0, detail: 64, count: 0, amplitude: 0, seed: 1, text: "" }, label: "Matte ceramic cap", interaction: "hover-highlight" }), { type: "physical", color: "#2b2d33", metalness: 0, roughness: 0.75 }),
    mat(createObject("torus", "band", { name: "Accent band", parentId: "product", position: [0, 0.55, 0], rotation: [Math.PI / 2, 0, 0], params: { size: 0.625, size2: 0.03, size3: 0, detail: 96, count: 0, amplitude: 0, seed: 1, text: "" }, label: "Copper accent", interaction: "hover-highlight" }), { type: "physical", color: "#c27a4a", metalness: 1, roughness: 0.2 }),
    mat(createObject("plane", "floor", { name: "Floor", position: [0, -0.3, 0], params: { size: 40, size2: 40, size3: 0, detail: 1, count: 0, amplitude: 0, seed: 1, text: "" } }), { color: "#0d0d10", roughness: 0.9 }),
  ];
  s.lights = [
    light({ id: "ambient", type: "hemisphere", color: "#ffffff", groundColor: "#1a1a20", intensity: 0.35 }),
    light({ id: "key", name: "Key", type: "spot", intensity: 120, position: [4, 7, 4], castShadow: true, angle: 0.5 }),
    light({ id: "rim", name: "Rim", type: "spot", color: "#9fb4ff", intensity: 80, position: [-5, 4, -4], angle: 0.6 }),
    light({ id: "fill", name: "Fill", type: "point", color: "#ffd9b8", intensity: 8, position: [-3, 1.5, 4] }),
  ];
  s.camera = { position: [0, 2.2, 7], target: [0, 1.4, 0], fov: 38, autoRotate: false, autoRotateSpeed: 0.5 };
  s.environment = { ...s.environment, background: "#0b0b0e", grid: false, fog: true, fogColor: "#0b0b0e", fogNear: 10, fogFar: 30, preset: "studio", exposure: 1.05 };
  return s;
}

// ─── 3. Futuristic city ──────────────────────────────────────────────────

export function futuristicCity(): SceneSpec {
  const s = emptyScene("Futuristic city");
  s.description = "A procedurally generated neon city at night with traffic orbiting the skyline.";
  const rand = rng(42);
  const objects: SceneObject[] = [
    mat(createObject("plane", "ground", { name: "Ground", position: [0, 0, 0], params: { size: 80, size2: 80, size3: 0, detail: 1, count: 0, amplitude: 0, seed: 1, text: "" } }), { color: "#07070b", roughness: 0.4, metalness: 0.6 }),
  ];
  const neon = ["#00e5ff", "#ff2bd6", "#7c4dff", "#00ff9c"];
  let n = 0;
  for (let gx = -6; gx <= 6; gx++) {
    for (let gz = -6; gz <= 6; gz++) {
      if (Math.abs(gx) <= 0 && Math.abs(gz) <= 0) continue;
      if (rand() < 0.35) continue;
      const h = 1 + Math.pow(rand(), 2.2) * 12 * (1 - Math.hypot(gx, gz) / 10);
      const w = 0.8 + rand() * 0.9;
      const glow = rand() < 0.25;
      objects.push(
        mat(
          createObject("box", `tower-${n++}`, {
            name: `Tower ${n}`,
            position: [gx * 2.2 + (rand() - 0.5) * 0.4, Math.max(h, 1) / 2, gz * 2.2 + (rand() - 0.5) * 0.4],
            params: { size: w, size2: Math.max(h, 1), size3: w, detail: 1, count: 0, amplitude: 0, seed: 1, text: "" },
          }),
          glow
            ? { color: "#0d0d18", emissive: neon[n % neon.length], emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.3 }
            : { color: "#151522", metalness: 0.7, roughness: 0.35, emissive: "#1a1f4a", emissiveIntensity: 0.25 },
        ),
      );
    }
  }
  objects.push(
    mat(createObject("cylinder", "spire", { name: "Central spire", position: [0, 9, 0], params: { size: 0.5, size2: 18, size3: 0, detail: 6, count: 0, amplitude: 0, seed: 1, text: "" }, label: "Arcology One", interaction: "click-focus" }), { color: "#111122", emissive: "#00e5ff", emissiveIntensity: 1.4, metalness: 0.9, roughness: 0.2 }),
  );
  for (let i = 0; i < 10; i++) {
    objects.push(
      mat(
        createObject("box", `car-${i}`, {
          name: `Hover car ${i + 1}`,
          position: [0, 3 + (i % 4) * 1.6, 0],
          params: { size: 0.5, size2: 0.12, size3: 0.22, detail: 1, count: 0, amplitude: 0, seed: 1, text: "" },
          animation: { type: "orbit", speed: (i % 2 ? 1 : -1) * (0.25 + rand() * 0.3), axis: "y", radius: 6 + rand() * 9, phase: rand() * Math.PI * 2 },
          castShadow: false,
        }),
        { type: "basic", color: neon[i % neon.length] },
      ),
    );
  }
  objects.push(mat(createObject("particles", "haze", { name: "Haze", position: [0, 8, 0], params: { size: 30, size2: 0, size3: 0, detail: 0, count: 1500, amplitude: 0, seed: 9, text: "" }, animation: { type: "spin", speed: 0.02, axis: "y", radius: 0, phase: 0 } }), { type: "basic", color: "#5865ff", opacity: 0.5 }));
  s.objects = objects;
  s.lights = [
    light({ id: "ambient", type: "hemisphere", color: "#3b4bff", groundColor: "#05050a", intensity: 0.35 }),
    light({ id: "moon", name: "Moonlight", type: "directional", color: "#8fa8ff", intensity: 0.6, position: [-10, 20, 8], castShadow: true }),
    light({ id: "neon-a", name: "Neon cyan", type: "point", color: "#00e5ff", intensity: 60, position: [4, 3, 4], distance: 30 }),
    light({ id: "neon-b", name: "Neon magenta", type: "point", color: "#ff2bd6", intensity: 60, position: [-5, 3, -3], distance: 30 }),
  ];
  s.camera = { position: [18, 12, 22], target: [0, 4, 0], fov: 45, autoRotate: true, autoRotateSpeed: 0.25 };
  s.environment = { ...s.environment, background: "#05050a", fog: true, fogColor: "#05050a", fogNear: 18, fogFar: 70, grid: false, preset: "night", exposure: 1.2 };
  return s;
}

// ─── 4. Interactive abstract sculpture ───────────────────────────────────

export function abstractSculpture(): SceneSpec {
  const s = emptyScene("Abstract sculpture");
  s.description = "An iridescent knot surrounded by rotating rings. Click elements to toggle their motion; hover to highlight.";
  s.objects = [
    mat(createObject("torusKnot", "knot", { name: "Knot", position: [0, 2, 0], params: { size: 1.1, size2: 0.32, size3: 0, detail: 256, count: 0, amplitude: 0, seed: 1, text: "" }, animation: { type: "spin", speed: 0.4, axis: "y", radius: 0, phase: 0 }, interaction: "click-toggle-animation", label: "Click to pause" }), { type: "physical", color: "#8f7bff", metalness: 0.6, roughness: 0.15 }),
    ...[0, 1, 2].map((i) =>
      mat(
        createObject("torus", `ring-${i}`, {
          name: `Ring ${i + 1}`,
          position: [0, 2, 0],
          rotation: [i * 0.9, i * 0.4, 0],
          params: { size: 2.2 + i * 0.45, size2: 0.035, size3: 0, detail: 128, count: 0, amplitude: 0, seed: 1, text: "" },
          animation: { type: "spin", speed: 0.25 + i * 0.15, axis: (["x", "y", "z"] as const)[i], radius: 0, phase: 0 },
          interaction: "click-toggle-animation",
        }),
        { type: "standard", color: ["#ffffff", "#ff8fd8", "#7fe7ff"][i], metalness: 1, roughness: 0.2, emissive: ["#222222", "#5a1446", "#0d4a5a"][i], emissiveIntensity: 1 },
      ),
    ),
    ...[0, 1, 2, 3, 4, 5].map((i) =>
      mat(
        createObject("icosahedron", `orb-${i}`, {
          name: `Orb ${i + 1}`,
          position: [Math.cos((i / 6) * Math.PI * 2) * 4, 1.2 + (i % 3) * 0.8, Math.sin((i / 6) * Math.PI * 2) * 4],
          params: { size: 0.28, size2: 0, size3: 0, detail: 1, count: 0, amplitude: 0, seed: 1, text: "" },
          animation: { type: "float", speed: 0.4 + i * 0.07, axis: "y", radius: 0.35, phase: i },
          interaction: "hover-highlight",
        }),
        { color: "#f2f2f5", flatShading: true, roughness: 0.4 },
      ),
    ),
    mat(createObject("plane", "floor", { name: "Floor", position: [0, 0, 0], params: { size: 30, size2: 30, size3: 0, detail: 1, count: 0, amplitude: 0, seed: 1, text: "" } }), { color: "#101014", roughness: 0.6 }),
  ];
  s.lights = [
    light({ id: "ambient", type: "ambient", intensity: 0.25 }),
    light({ id: "key", name: "Key", type: "directional", intensity: 2.4, position: [5, 9, 4], castShadow: true }),
    light({ id: "pink", name: "Pink accent", type: "point", color: "#ff5fc8", intensity: 30, position: [-4, 3, 2] }),
    light({ id: "cyan", name: "Cyan accent", type: "point", color: "#4fd8ff", intensity: 30, position: [4, 1, -3] }),
  ];
  s.camera = { position: [6, 4.5, 8], target: [0, 2, 0], fov: 45, autoRotate: true, autoRotateSpeed: 0.4 };
  s.environment = { ...s.environment, background: "#0c0c10", grid: false, preset: "studio" };
  return s;
}

// ─── 5. Particle & fluid-inspired scene ──────────────────────────────────

export function particleFlow(): SceneSpec {
  const s = emptyScene("Particle flow");
  s.description = "Layered particle nebulae drifting at different speeds around a glowing core.";
  const colors = ["#5b8cff", "#a66bff", "#ff6bd6", "#6bffe1"];
  s.objects = [
    mat(createObject("sphere", "core", { name: "Core", position: [0, 0, 0], params: { size: 0.6, size2: 0, size3: 0, detail: 48, count: 0, amplitude: 0, seed: 1, text: "" }, animation: { type: "pulse", speed: 0.5, axis: "y", radius: 0.15, phase: 0 }, castShadow: false }), { type: "basic", color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 3 }),
    ...colors.map((c, i) =>
      mat(
        createObject("particles", `cloud-${i}`, {
          name: `Cloud ${i + 1}`,
          position: [0, 0, 0],
          rotation: [i * 0.5, 0, i * 0.3],
          scale: [1, 0.35 + i * 0.1, 1],
          params: { size: 4 + i * 2.2, size2: 0, size3: 0, detail: 0, count: 2500, amplitude: 0, seed: 11 + i, text: "" },
          animation: { type: "spin", speed: (i % 2 ? -1 : 1) * (0.05 + i * 0.04), axis: "y", radius: 0, phase: 0 },
        }),
        { type: "basic", color: c, opacity: 0.8 },
      ),
    ),
    mat(createObject("starfield", "stars", { name: "Stars", position: [0, 0, 0], params: { size: 150, size2: 0, size3: 0, detail: 0, count: 3000, amplitude: 0, seed: 3, text: "" } }), { type: "basic", color: "#ffffff" }),
  ];
  s.lights = [light({ id: "ambient", type: "ambient", intensity: 0.2 })];
  s.camera = { position: [0, 6, 18], target: [0, 0, 0], fov: 55, autoRotate: true, autoRotateSpeed: 0.3 };
  s.environment = { ...s.environment, background: "#030308", grid: false, shadows: false, fog: true, fogColor: "#030308", fogNear: 15, fogFar: 60 };
  return s;
}

// ─── 6. 3D portfolio hero ────────────────────────────────────────────────

export function portfolioHero(): SceneSpec {
  const s = emptyScene("Portfolio hero");
  s.description = "A hero section for a creative portfolio: floating name, wireframe crystals and soft lighting.";
  const rand = rng(5);
  s.objects = [
    mat(createObject("text", "name", { name: "Name", position: [0, 2.4, 0], params: { size: 0.9, size2: 0, size3: 0, detail: 0, count: 0, amplitude: 0, seed: 1, text: "ALEX MORGAN" }, animation: { type: "float", speed: 0.25, axis: "y", radius: 0.08, phase: 0 } }), { type: "basic", color: "#f4f4f6" }),
    mat(createObject("text", "role", { name: "Role", position: [0, 1.5, 0], params: { size: 0.3, size2: 0, size3: 0, detail: 0, count: 0, amplitude: 0, seed: 1, text: "Creative technologist · Designer · Developer" }, animation: { type: "float", speed: 0.25, axis: "y", radius: 0.06, phase: 0.4 } }), { type: "basic", color: "#9aa0b4" }),
    ...Array.from({ length: 14 }, (_, i) =>
      mat(
        createObject("icosahedron", `crystal-${i}`, {
          name: `Crystal ${i + 1}`,
          position: [(rand() - 0.5) * 14, rand() * 5 - 0.5, -2 - rand() * 6],
          rotation: [rand() * 3, rand() * 3, 0],
          params: { size: 0.3 + rand() * 0.6, size2: 0, size3: 0, detail: 0, count: 0, amplitude: 0, seed: 1, text: "" },
          animation: { type: i % 2 ? "spin" : "float", speed: 0.2 + rand() * 0.4, axis: "y", radius: 0.3, phase: rand() * 6 },
          interaction: "hover-highlight",
          castShadow: false,
        }),
        { color: i % 3 === 0 ? "#7c8cff" : "#d0d3e0", wireframe: i % 2 === 0, emissive: i % 3 === 0 ? "#2b3480" : "#000000", emissiveIntensity: 1 },
      ),
    ),
  ];
  s.lights = [light({ id: "ambient", type: "ambient", intensity: 0.5 }), light({ id: "key", name: "Key", type: "directional", intensity: 1.6, position: [3, 6, 6] }), light({ id: "accent", name: "Accent", type: "point", color: "#7c8cff", intensity: 25, position: [-4, 2, 2] })];
  s.camera = { position: [0, 2, 9], target: [0, 1.8, 0], fov: 50, autoRotate: false, autoRotateSpeed: 0.5 };
  s.environment = { ...s.environment, background: "#0a0a0f", grid: false, shadows: false, fog: true, fogColor: "#0a0a0f", fogNear: 8, fogFar: 22 };
  return s;
}

// ─── 7. Simple playable 3D game ──────────────────────────────────────────

export function collectorGame(): SceneSpec {
  const s = emptyScene("Orb collector");
  s.description = "Move with WASD / arrow keys, collect every golden ring and avoid the red blocks.";
  const rand = rng(21);
  const objects: SceneObject[] = [
    mat(createObject("plane", "arena", { name: "Arena", position: [0, 0, 0], params: { size: 26, size2: 26, size3: 0, detail: 1, count: 0, amplitude: 0, seed: 1, text: "" } }), { color: "#14161d", roughness: 0.9 }),
    mat(createObject("sphere", "player", { name: "Player", position: [0, 0.5, 0], params: { size: 0.5, size2: 0, size3: 0, detail: 48, count: 0, amplitude: 0, seed: 1, text: "" }, role: "player", label: "You" }), { color: "#5b8cff", emissive: "#1c3b99", emissiveIntensity: 0.6, roughness: 0.3 }),
  ];
  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2;
    const r = 3 + rand() * 8;
    objects.push(
      mat(
        createObject("torus", `coin-${i}`, {
          name: `Ring ${i + 1}`,
          position: [Math.cos(a) * r, 0.6, Math.sin(a) * r],
          params: { size: 0.35, size2: 0.1, size3: 0, detail: 32, count: 0, amplitude: 0, seed: 1, text: "" },
          animation: { type: "spin", speed: 2, axis: "y", radius: 0, phase: i },
          role: "collectible",
        }),
        { color: "#ffcc33", emissive: "#aa7700", emissiveIntensity: 0.8, metalness: 0.9, roughness: 0.25 },
      ),
    );
  }
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const r = 2.5 + rand() * 9;
    objects.push(
      mat(
        createObject("box", `block-${i}`, {
          name: `Block ${i + 1}`,
          position: [Math.cos(a) * r, 0.5, Math.sin(a) * r],
          params: { size: 1, size2: 1, size3: 1, detail: 1, count: 0, amplitude: 0, seed: 1, text: "" },
          animation: { type: "float", speed: 0.5, axis: "y", radius: 0.1, phase: i },
          role: "obstacle",
        }),
        { color: "#e5484d", emissive: "#5a0f12", emissiveIntensity: 0.6 },
      ),
    );
  }
  s.objects = objects;
  s.lights = [light({ id: "ambient", type: "hemisphere", color: "#c9d6ff", groundColor: "#101018", intensity: 0.7 }), light({ id: "sun", name: "Sun", type: "directional", intensity: 2.2, position: [8, 14, 6], castShadow: true })];
  s.camera = { position: [0, 14, 14], target: [0, 0, 0], fov: 50, autoRotate: false, autoRotateSpeed: 0 };
  s.environment = { ...s.environment, background: "#0b0d12", grid: true };
  s.controls = { mode: "player", playerSpeed: 7, bounds: 12.5 };
  return s;
}

export const SCENE_TEMPLATES = [
  { id: "solar-system", name: "Solar system", description: "Orbiting planets, labels, starfield", build: solarSystem },
  { id: "product-showcase", name: "Product showcase", description: "Studio-lit product on a turntable", build: productShowcase },
  { id: "futuristic-city", name: "Futuristic city", description: "Procedural neon skyline at night", build: futuristicCity },
  { id: "abstract-sculpture", name: "Abstract sculpture", description: "Interactive kinetic sculpture", build: abstractSculpture },
  { id: "particle-flow", name: "Particle flow", description: "Layered particle nebulae", build: particleFlow },
  { id: "portfolio-hero", name: "Portfolio hero", description: "Floating type and crystals", build: portfolioHero },
  { id: "collector-game", name: "Orb collector game", description: "Playable: WASD to collect rings", build: collectorGame },
] as const;

/** Used by the offline test provider only. */
export function mockSceneFor(prompt: string): SceneSpec {
  if (/game|play/i.test(prompt)) return collectorGame();
  if (/city|urban|skyline/i.test(prompt)) return futuristicCity();
  if (/particle|nebula|fluid/i.test(prompt)) return particleFlow();
  if (/product|showcase/i.test(prompt)) return productShowcase();
  if (/solar|planet|orbit/i.test(prompt)) return solarSystem();
  const s = abstractSculpture();
  s.title = prompt.slice(0, 60) || s.title;
  return s;
}
