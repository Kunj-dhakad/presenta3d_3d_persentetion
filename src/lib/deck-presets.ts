/**
 * Curated 3D scene presets for presentations. The model picks one preset per
 * slide by name (matching the slide's meaning to the tags); the server expands
 * it into the engine's scene description. Every preset is a tested
 * combination of the composed-scene building blocks, or one of the classic
 * hand-built scenes. A deck never uses the same preset twice.
 */

export type ComposeSpec = {
  shape: "sphere" | "cube" | "torus" | "cone" | "cylinder" | "icosahedron" | "octahedron" | "dodecahedron" | "tetrahedron" | "capsule" | "ring" | "knot";
  arrangement: "single" | "ring" | "grid" | "spiral" | "helix" | "scatter" | "stack" | "wave" | "orbit" | "shell" | "tunnel" | "cluster";
  motion: "rotate" | "float" | "pulse" | "orbit" | "wave" | "swirl" | "breathe" | "drift";
  material: "glass" | "metal" | "wireframe" | "glow" | "matte" | "holographic" | "points";
  count: number;
};

export type ClassicKind = "galaxy" | "globe" | "orbits" | "particles" | "crystal" | "knot" | "helix" | "bars" | "cubes" | "waves" | "rings";

export type ScenePreset = { name: string; tags: string } & ({ kind: "composed"; compose: ComposeSpec } | { kind: ClassicKind });

// name, "shape arrangement motion material count", tags
const C: [string, string, string][] = [
  // single hero objects
  ["hero-crystal", "icosahedron single rotate holographic 1", "insight, core idea, quality, value"],
  ["golden-orb", "sphere single breathe metal 1", "premium, luxury, finance, value"],
  ["glass-cube", "cube single rotate glass 1", "product, transparency, clarity, packaging"],
  ["wire-dodeca", "dodecahedron single rotate wireframe 1", "technology, structure, engineering, blueprint"],
  ["pulse-heart", "sphere single pulse glow 1", "health, energy, life, heartbeat"],
  ["halo-ring", "ring single swirl glow 1", "focus, unity, community, loop"],
  ["infinity-knot", "knot single rotate holographic 1", "complexity, integration, infinity, AI"],
  ["monolith", "capsule single float matte 1", "stability, foundation, strength, trust"],
  ["prism-cone", "cone single rotate glass 1", "direction, growth, peak, launch"],
  ["star-tetra", "tetrahedron single swirl metal 1", "precision, strategy, sharp edge"],
  ["point-sphere", "sphere single breathe points 1", "data, AI, network, cloud"],
  // rings
  ["satellite-ring", "sphere ring orbit glow 14", "ecosystem, community, partners"],
  ["crown-of-cubes", "cube ring rotate metal 12", "leadership, team, collaboration"],
  ["crystal-circle", "octahedron ring float holographic 10", "values, principles, gems"],
  ["torus-halo", "torus ring swirl glass 8", "cycles, sustainability, recycling"],
  ["wire-carousel", "dodecahedron ring rotate wireframe 10", "options, portfolio, product range"],
  ["capsule-wheel", "capsule ring pulse matte 16", "health, pharmacy, daily routine"],
  ["ember-circle", "tetrahedron ring drift glow 20", "fire, energy, passion"],
  ["bead-necklace", "sphere ring wave metal 24", "fashion, jewelry, craft"],
  ["cone-sunburst", "cone ring breathe glow 16", "sun, optimism, morning, ideas"],
  ["ring-of-rings", "ring ring orbit glow 10", "connections, links, integration"],
  ["point-halo", "icosahedron ring rotate points 12", "digital, AI, cloud"],
  // grids
  ["city-blocks", "cube grid wave matte 49", "city, real estate, infrastructure, buildings"],
  ["pixel-field", "cube grid pulse glow 64", "digital, pixels, gaming, screens"],
  ["solar-array", "cylinder grid float metal 36", "solar, energy, renewables"],
  ["data-matrix", "sphere grid wave glow 81", "data, analytics, signals"],
  ["chip-lattice", "cube grid breathe wireframe 36", "chips, hardware, circuits, computing"],
  ["crystal-farm", "octahedron grid float holographic 25", "mining, crypto, resources"],
  ["bubble-wrap", "sphere grid pulse glass 49", "packaging, logistics, retail"],
  ["cone-forest", "cone grid wave matte 36", "forest, nature, trees, environment"],
  ["dome-grid", "capsule grid float metal 25", "storage, warehouse, servers"],
  ["token-board", "cylinder grid rotate holographic 30", "tokens, coins, payments, fintech"],
  ["grain-field", "tetrahedron grid wave points 36", "agriculture, harvest, farming"],
  // spirals
  ["golden-spiral", "sphere spiral swirl metal 60", "nature, growth, design, harmony"],
  ["galaxy-of-gems", "octahedron spiral swirl holographic 50", "vision, universe, scale"],
  ["sunflower", "cone spiral breathe glow 70", "flowers, spring, beauty, plants"],
  ["vortex", "tetrahedron spiral swirl glow 80", "speed, disruption, momentum"],
  ["shell-spiral", "capsule spiral rotate matte 40", "ocean, nature, evolution"],
  ["coin-spiral", "cylinder spiral swirl metal 45", "money, wealth, investment"],
  ["dna-flower", "sphere spiral pulse points 60", "biology, life, genetics"],
  ["ring-spiral", "ring spiral rotate glow 30", "process, iterations, agile"],
  ["cube-spiral", "cube spiral swirl wireframe 40", "architecture, modules, building"],
  ["knot-spiral", "knot spiral rotate holographic 18", "creativity, art, imagination"],
  ["glass-nautilus", "sphere spiral breathe glass 50", "elegance, calm, wellness"],
  // helices
  ["dna-helix", "sphere helix rotate glow 50", "science, genetics, health"],
  ["cube-tower-helix", "cube helix rotate metal 40", "growth, progress, ladder"],
  ["crystal-strand", "octahedron helix rotate holographic 36", "innovation, research"],
  ["wire-helix", "dodecahedron helix swirl wireframe 30", "engineering, systems"],
  ["capsule-chain", "capsule helix float matte 36", "pharma, medicine, supply chain"],
  ["ribbon-helix", "torus helix rotate glow 24", "events, celebration, culture"],
  ["cone-staircase", "cone helix rotate metal 30", "steps, roadmap, milestones"],
  ["ring-coil", "ring helix swirl glow 28", "energy, electricity, power"],
  ["point-helix", "icosahedron helix rotate points 30", "data science, AI models"],
  ["coin-helix", "cylinder helix rotate holographic 30", "crypto, blockchain, fintech"],
  ["bubble-helix", "sphere helix drift glass 40", "water, chemistry, freshness"],
  // scatters
  ["confetti", "tetrahedron scatter drift glow 90", "celebration, launch, success"],
  ["snowfall", "octahedron scatter drift glass 80", "winter, holiday, calm"],
  ["asteroid-field", "dodecahedron scatter rotate matte 40", "space, exploration, risk"],
  ["bubbles", "sphere scatter drift glass 50", "ideas, freshness, beverages"],
  ["star-dust", "icosahedron scatter float points 60", "dreams, imagination, magic"],
  ["floating-gifts", "cube scatter float metal 30", "ecommerce, rewards, retail"],
  ["pill-cloud", "capsule scatter float matte 40", "healthcare, pharmacy"],
  ["fireflies", "sphere scatter pulse glow 70", "night, nature, inspiration"],
  ["shard-storm", "tetrahedron scatter swirl holographic 60", "disruption, change, chaos"],
  ["ring-drift", "ring scatter drift glow 30", "connections, social, communication"],
  ["wire-debris", "cube scatter rotate wireframe 35", "problems, challenges, complexity"],
  // stacks
  ["skyscraper", "cube stack breathe metal 14", "growth, cities, construction, scale"],
  ["coin-stack", "cylinder stack float metal 16", "savings, revenue, finance"],
  ["crystal-tower", "octahedron stack rotate holographic 10", "achievement, excellence"],
  ["ring-tower", "torus stack swirl glow 12", "layers, technology stack"],
  ["pagoda", "cone stack float matte 8", "culture, tradition, travel"],
  ["server-rack", "cube stack pulse wireframe 12", "cloud, servers, infrastructure"],
  ["cairn", "sphere stack breathe matte 9", "balance, mindfulness, wellness"],
  ["lantern-stack", "cylinder stack pulse glow 10", "festival, warmth, hospitality"],
  ["capsule-tower", "capsule stack float glass 10", "lab, research, science"],
  ["gem-totem", "icosahedron stack rotate glow 9", "brand, identity, values"],
  ["dodeca-pillar", "dodecahedron stack swirl points 10", "foundation, platform"],
  // waves
  ["ocean-swell", "sphere wave wave glow 100", "ocean, water, travel"],
  ["sound-wave", "cylinder wave wave glow 60", "music, audio, voice, podcast"],
  ["market-wave", "cube wave wave metal 80", "markets, stocks, trends"],
  ["wheat-field", "cone wave wave matte 80", "agriculture, food, harvest"],
  ["crystal-sea", "octahedron wave wave holographic 64", "luxury, beauty, cosmetics"],
  ["signal-wave", "sphere wave wave points 120", "telecom, signals, 5G"],
  ["glass-ripple", "sphere wave pulse glass 64", "calm, spa, water"],
  ["ring-ripple", "ring wave wave glow 40", "impact, ripple effect, influence"],
  ["tile-wave", "cube wave wave wireframe 64", "design, UX, interfaces"],
  ["dune-wave", "tetrahedron wave wave matte 80", "desert, travel, adventure"],
  ["capsule-wave", "capsule wave wave metal 60", "transport, mobility, traffic"],
  // orbits
  ["solar-system", "sphere orbit orbit glow 9", "space, astronomy, planets, education"],
  ["atom", "sphere orbit orbit points 12", "science, physics, chemistry"],
  ["product-orbit", "cube orbit orbit metal 12", "product suite, platform"],
  ["crystal-orbit", "octahedron orbit orbit holographic 12", "partners, ecosystem"],
  ["moon-rings", "torus orbit orbit glass 6", "exploration, discovery"],
  ["satellite-net", "icosahedron orbit orbit wireframe 15", "satellites, connectivity, IoT"],
  ["ring-gyroscope", "ring orbit swirl glow 6", "balance, navigation, control"],
  ["capsule-orbit", "capsule orbit orbit matte 12", "logistics, delivery"],
  ["cone-orbit", "cone orbit orbit glow 12", "rockets, launch, startups"],
  ["knot-orbit", "knot orbit orbit holographic 6", "AI, neural networks, complexity"],
  ["dodeca-orbit", "dodecahedron orbit orbit metal 9", "gaming, dice, strategy"],
  // shells
  ["planet-shell", "sphere shell rotate glow 120", "globe, world, global"],
  ["geodesic-dome", "icosahedron shell rotate wireframe 60", "architecture, innovation, structure"],
  ["cube-sphere", "cube shell breathe metal 80", "systems, cohesion"],
  ["crystal-ball", "octahedron shell rotate holographic 70", "future, prediction, vision"],
  ["dandelion", "cone shell breathe glow 90", "nature, spreading ideas, growth"],
  ["virus-shell", "capsule shell pulse matte 60", "biology, health, medicine"],
  ["point-planet", "sphere shell rotate points 150", "data, global network"],
  ["glass-pearl", "sphere shell breathe glass 70", "elegance, luxury"],
  ["ring-sphere", "ring shell rotate glow 40", "connections, community"],
  ["tetra-shell", "tetrahedron shell swirl metal 70", "security, protection, shield"],
  ["disco-ball", "cube shell rotate holographic 100", "party, entertainment, music"],
  // tunnels
  ["warp-tunnel", "ring tunnel swirl glow 24", "speed, future, transformation"],
  ["cube-corridor", "cube tunnel rotate wireframe 40", "journey, pathway, process"],
  ["light-tunnel", "sphere tunnel pulse glow 60", "journey, progress"],
  ["crystal-tunnel", "octahedron tunnel swirl holographic 50", "discovery, exploration"],
  ["torus-tunnel", "torus tunnel rotate glass 16", "flow, pipeline, transport"],
  ["data-tunnel", "icosahedron tunnel drift points 40", "data pipeline, cloud"],
  ["coin-tunnel", "cylinder tunnel swirl metal 40", "finance, payments flow"],
  ["arch-tunnel", "ring tunnel float matte 18", "architecture, travel, gateway"],
  ["cone-tunnel", "cone tunnel swirl glow 40", "acceleration, sales funnel"],
  ["tetra-tunnel", "tetrahedron tunnel rotate glow 50", "gaming, sci-fi"],
  ["capsule-tunnel", "capsule tunnel drift metal 30", "transport, hyperloop, mobility"],
  // clusters
  ["molecule", "sphere cluster rotate glass 18", "chemistry, molecules, materials"],
  ["grape-cluster", "sphere cluster breathe matte 30", "food, wine, agriculture"],
  ["gem-pile", "octahedron cluster rotate holographic 24", "treasure, value, rewards"],
  ["brain-cluster", "icosahedron cluster pulse points 30", "AI, brain, intelligence"],
  ["cube-swarm", "cube cluster swirl glow 40", "teamwork, swarm, collaboration"],
  ["coral", "cone cluster float matte 30", "ocean, nature, reefs"],
  ["neural-knot", "knot cluster rotate wireframe 8", "networks, deep learning"],
  ["asteroid-cluster", "dodecahedron cluster rotate metal 20", "resources, mining"],
  ["cell-cluster", "capsule cluster pulse glass 24", "biology, healthcare, biotech"],
  ["ring-cluster", "ring cluster swirl metal 16", "partnerships, linking"],
  ["ember-cluster", "tetrahedron cluster pulse glow 36", "energy, heat, passion"],
];

const CLASSIC: [string, ClassicKind, string][] = [
  ["spiral-galaxy", "galaxy", "vision, scale, the big picture, space"],
  ["connected-globe", "globe", "global reach, markets, networks, world"],
  ["platform-orbits", "orbits", "ecosystems, products around a platform"],
  ["particle-field", "particles", "ideas, atmosphere, openings and closings"],
  ["faceted-crystal", "crystal", "quality, value, a core insight"],
  ["torus-knot", "knot", "complexity, integration, technology"],
  ["double-helix", "helix", "growth, identity, science, culture"],
  ["bar-chart", "bars", "metrics, growth, comparisons — needs scene.values"],
  ["rising-cubes", "cubes", "systems, building blocks, scale"],
  ["flowing-waves", "waves", "momentum, change, markets, sound"],
  ["rotating-rings", "rings", "process, cycles, layers, focus"],
];

export const SCENE_PRESETS: ScenePreset[] = [
  ...C.map(([name, spec, tags]): ScenePreset => {
    const [shape, arrangement, motion, material, count] = spec.split(" ");
    return {
      name,
      tags,
      kind: "composed",
      compose: { shape, arrangement, motion, material, count: Number(count) } as ComposeSpec,
    };
  }),
  ...CLASSIC.map(([name, kind, tags]): ScenePreset => ({ name, tags, kind })),
];

export const PRESET_NAMES = SCENE_PRESETS.map((p) => p.name) as [string, ...string[]];
const BY_NAME = new Map(SCENE_PRESETS.map((p) => [p.name, p]));
export const presetByName = (name: string) => BY_NAME.get(name);

/** Compact catalog for the model's instructions: "name: tags" per line. */
export function presetCatalog(): string {
  return SCENE_PRESETS.map((p) => `${p.name}: ${p.tags}`).join("\n");
}

/**
 * The unused preset that best matches `tags` (by shared words), avoiding
 * `avoidArrangement` so neighbouring slides look different.
 */
export function closestUnusedPreset(name: string, used: Set<string>, avoid: { arrangement?: string; kind?: string } = {}): ScenePreset {
  const base = BY_NAME.get(name);
  const words = new Set((base?.tags ?? name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  let best: ScenePreset | null = null;
  let bestScore = -Infinity;
  for (const p of SCENE_PRESETS) {
    if (used.has(p.name) || p.kind === "bars") continue;
    if (avoid.kind && p.kind === avoid.kind && p.kind !== "composed") continue;
    if (avoid.arrangement && p.kind === "composed" && p.compose.arrangement === avoid.arrangement) continue;
    let score = 0;
    for (const w of p.tags.toLowerCase().split(/[^a-z0-9]+/)) if (words.has(w)) score += 2;
    if (base?.kind === "composed" && p.kind === "composed") {
      if (p.compose.material === base.compose.material) score += 0.5;
      if (p.compose.shape === base.compose.shape) score += 0.5;
    }
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best ?? SCENE_PRESETS[0];
}
