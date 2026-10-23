import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import { EditPlanSchema, FileOperationsResultSchema, ProjectSpecSchema, type ProjectSpec } from "@/lib/schemas/project";
import { SceneSpecSchema, createObject, emptyScene, normalizeScene, validateScene } from "@/lib/schemas/scene";
import { AiFrameContentSchema, CanvasDocSchema, emptyCanvas, makeNode } from "@/lib/schemas/canvas";
import { SCENE_TEMPLATES } from "@/lib/scene/templates";
import { normalizeSpec, tasksFromSpec } from "@/server/pipeline/spec";
import { reviewProject } from "@/server/pipeline/review";
import { DeckSpecSchema, sampleDeck, validateDeck } from "@/lib/schemas/deck";

const spec = (over: Partial<ProjectSpec> = {}): ProjectSpec => ({
  understanding: "u",
  title: "T",
  category: "website",
  framework: "react-ts",
  goal: "g",
  designSystem: { palette: ["#000000"], typography: "t", style: "s" },
  files: [
    { path: "src/App.tsx", purpose: "app", exports: "App", group: "ui" },
    { path: "src/components/Hero.tsx", purpose: "hero", exports: "Hero", group: "ui" },
    { path: "src/styles.css", purpose: "css", exports: "", group: "design" },
  ],
  components: [],
  packages: ["react", "framer-motion"],
  interactions: [],
  responsive: "",
  acceptanceTests: [],
  ...over,
});

describe("AI structured output schemas", () => {
  it.each([
    ["project_spec", ProjectSpecSchema],
    ["file_operations", FileOperationsResultSchema],
    ["edit_plan", EditPlanSchema],
    ["scene_spec", SceneSpecSchema],
    ["frame_content", AiFrameContentSchema],
    ["deck_spec", DeckSpecSchema],
  ] as const)("%s converts to a strict JSON schema without unsupported constructs", (name, schema) => {
    const f = zodTextFormat(schema, name);
    expect(f.strict).toBe(true);
    expect(JSON.stringify(f.schema)).not.toMatch(/prefixItems|"const"|"default"/);
  });
});

describe("project specification normalization", () => {
  it("adds a missing React entry file and groups entry files last", () => {
    const { spec: s, warnings } = normalizeSpec(spec());
    expect(s.files.find((f) => f.path === "src/main.tsx")?.group).toBe("entry");
    expect(s.files.find((f) => f.path === "src/App.tsx")?.group).toBe("entry");
    expect(warnings.join()).toMatch(/added missing entry/);
  });

  it("adds index.html for static projects", () => {
    const { spec: s } = normalizeSpec(spec({ framework: "vanilla", files: [{ path: "main.js", purpose: "", exports: "", group: "a" }] }));
    expect(s.files.some((f) => f.path === "index.html")).toBe(true);
  });

  it("drops unsafe paths and packages outside the runtime", () => {
    const { spec: s, warnings } = normalizeSpec(
      spec({ files: [{ path: "../evil.js", purpose: "", exports: "", group: "x" }, { path: "src/main.tsx", purpose: "", exports: "", group: "x" }], packages: ["react", "axios", "three/addons/controls/OrbitControls.js"] }),
    );
    expect(s.files.map((f) => f.path)).toEqual(["src/main.tsx"]);
    expect(s.packages).toEqual(["react", "three/addons/controls/OrbitControls.js"]);
    expect(warnings.join("\n")).toMatch(/axios/);
  });

  it("splits oversized groups and caps the number of files", () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ path: `src/c${i}.tsx`, purpose: "", exports: "", group: "big" }));
    const { spec: s } = normalizeSpec(spec({ files }));
    expect(s.files.length).toBeLessThanOrEqual(17);
    const sizes = new Map<string, number>();
    for (const f of s.files) sizes.set(f.group, (sizes.get(f.group) ?? 0) + 1);
    for (const [g, n] of sizes) if (g !== "entry") expect(n).toBeLessThanOrEqual(4);
  });

  it("derives a task graph where the entry group depends on all other groups", () => {
    const { spec: s } = normalizeSpec(spec());
    const tasks = tasksFromSpec(s);
    const entry = tasks.find((t) => t.id === "gen-entry")!;
    expect(entry.dependsOn.sort()).toEqual(tasks.filter((t) => t.id !== "gen-entry").map((t) => t.id).sort());
    expect(tasks.find((t) => t.id === "gen-design")?.role).toBe("design");
    // Every planned file is written by exactly one task.
    const writes = tasks.flatMap((t) => t.writes);
    expect(new Set(writes).size).toBe(writes.length);
  });
});

describe("deterministic reviewer", () => {
  it("reports missing entry and empty files", () => {
    const r = reviewProject(new Map([["src/App.tsx", ""]]), "react-ts", ["src/App.tsx", "src/x.ts"]);
    expect(r.errors.join()).toMatch(/no src\/main/);
    expect(r.errors.join()).toMatch(/empty/);
    expect(r.warnings.join()).toMatch(/src\/x.ts/);
  });
  it("passes a minimal valid static project", () => {
    expect(reviewProject(new Map([["index.html", "<script type=module src=./a.js></script>"], ["a.js", "1"]]), "vanilla", []).errors).toEqual([]);
  });
});

describe("3D scene schema", () => {
  it.each(SCENE_TEMPLATES.map((t) => [t.id, t] as const))("template %s is valid", (_, t) => {
    const r = validateScene(t.build());
    expect(r.ok, r.ok ? "" : r.errors.join("; ")).toBe(true);
  });

  it("fills defaults for partial scenes", () => {
    const r = validateScene({ title: "x", objects: [{ id: "a", type: "sphere" }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scene.objects[0].material.color).toMatch(/^#/);
    expect(normalizeScene(null)).toBeNull();
  });

  it("rejects duplicate ids, unknown parents, cycles and invalid values", () => {
    const s = emptyScene();
    s.objects = [createObject("box", "a"), createObject("box", "a")];
    const dup = validateScene(s);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.join()).toMatch(/duplicate id "a"/);
    const cyc = emptyScene();
    cyc.objects = [createObject("box", "a", { parentId: "b" }), createObject("box", "b", { parentId: "a" })];
    const r = validateScene(cyc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/cycle/);
    const bad = emptyScene();
    bad.objects = [createObject("sphere", "x", { parentId: "ghost" })];
    expect(validateScene(bad).ok).toBe(false);
    const color = emptyScene();
    color.environment.background = "red";
    expect(validateScene(color).ok).toBe(false);
  });

  it("requires a player object in player mode and bounds particle counts", () => {
    const s = emptyScene();
    s.controls.mode = "player";
    expect(validateScene(s).ok).toBe(false);
    const p = emptyScene();
    p.objects = [0, 1, 2, 3].map((i) => createObject("particles", `p${i}`, { params: { ...createObject("particles", "t").params, count: 20000 } }));
    const r = validateScene(p);
    expect(r.ok).toBe(false);
  });
});

describe("canvas document schema", () => {
  it("accepts documents with frames and nodes and rejects malformed ones", () => {
    const doc = emptyCanvas();
    doc.pages[0].nodes.push(makeNode("frame", "f"), makeNode("text", "t", { frameId: "f" }));
    expect(CanvasDocSchema.safeParse(doc).success).toBe(true);
    expect(CanvasDocSchema.safeParse({ ...doc, pages: [] }).success).toBe(false);
    expect(CanvasDocSchema.safeParse({ ...doc, version: 2 }).success).toBe(false);
    const bad = structuredClone(doc);
    bad.pages[0].nodes[0].w = Number.NaN;
    expect(CanvasDocSchema.safeParse(bad).success).toBe(false);
  });
});

describe("3D presentation deck schema", () => {
  it("accepts the sample deck", () => {
    expect(validateDeck(sampleDeck("Test")).ok).toBe(true);
  });
  it("normalizes out-of-range values and trims long lists", () => {
    const d = sampleDeck();
    d.slides[0].scene.speed = 99;
    d.slides[0].scene.density = -4;
    d.slides[1].bullets = Array.from({ length: 12 }, (_, i) => `b${i}`);
    d.slides[2].scene.values = [1, -3, 4];
    const r = validateDeck(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deck.slides[0].scene.speed).toBe(3);
    expect(r.deck.slides[0].scene.density).toBe(0.1);
    expect(r.deck.slides[1].bullets).toHaveLength(5);
    expect(r.deck.slides[2].scene.values).toEqual([1, 4]);
  });
  it("rejects invalid colours, unknown scenes and empty decks", () => {
    const bad = sampleDeck();
    bad.theme.accent = "blue";
    expect(validateDeck(bad).ok).toBe(false);
    const kind = sampleDeck() as unknown as { slides: { scene: { kind: string; preset?: string } }[] };
    kind.slides[0].scene.kind = "teapot";
    delete kind.slides[0].scene.preset;
    expect(validateDeck(kind).ok).toBe(false);
    // The model can only pick presets from the catalog.
    const ai = { ...sampleDeck(), slides: [{ ...sampleDeck().slides[0], scene: { preset: "teapot", primary: "#ffffff", secondary: "#000000", speed: 1, density: 0.5, values: [] } }] };
    expect(DeckSpecSchema.safeParse(ai).success).toBe(false);
    expect(validateDeck({ ...sampleDeck(), slides: [] }).ok).toBe(false);
  });
});
