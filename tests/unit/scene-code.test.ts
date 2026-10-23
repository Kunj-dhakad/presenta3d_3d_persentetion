import { describe, expect, it } from "vitest";
import { validateSceneCode, addSceneCode } from "@/server/deck/scene-code";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { isGeneratedDeck } from "@/server/build/builder";
import { MockTextProvider } from "@/server/ai/mock-provider";
import { sampleDeck } from "@/lib/schemas/deck";

const good = "const { THREE } = ctx;\nconst group = new THREE.Group();\nconst update = (t) => { group.rotation.y = t; };\nreturn { group, update };";

describe("model-written slide scenes", () => {
  it("accepts a well-formed scene body", () => {
    expect(validateSceneCode(good)).toEqual({ ok: true });
    // Property access such as mesh.parent is fine.
    expect(validateSceneCode(good.replace("return", "const p = group.parent;\nreturn"))).toEqual({ ok: true });
  });

  it("rejects syntax errors and anything beyond drawing", () => {
    expect(validateSceneCode("const group = ;").ok).toBe(false);
    for (const bad of ["fetch('/x')", "document.body", "window.top", "parent.postMessage(1)", "import('x')", "new Function('a')", "localStorage.x", "eval('1')"]) {
      expect(validateSceneCode(`${bad};\n${good}`).ok, bad).toBe(false);
    }
    expect(validateSceneCode("x".repeat(20_000)).ok).toBe(false);
  });

  it("emits a module per custom scene and keeps the fast in-process build", async () => {
    const deck = await addSceneCode(sampleDeck("Scenes"), null, new MockTextProvider(), {
      userId: "u",
      jobId: "j",
      signal: new AbortController().signal,
      log: () => {},
    });
    expect(deck.slides.every((s) => s.scene.code)).toBe(true);
    const files = deckToProjectFiles(deck);
    expect(files.filter((f) => f.path.startsWith("scenes/")).map((f) => f.path)).toEqual(["scenes/slide-1.js", "scenes/slide-2.js", "scenes/slide-3.js", "scenes/slide-4.js"]);
    expect(files.find((f) => f.path === "scenes/slide-1.js")!.content).toContain("export default function scene(ctx) {");
    expect(isGeneratedDeck(files)).toBe(true);
    // Tampered scene code in deck.json is screened out at codegen.
    const tampered = { ...deck, slides: deck.slides.map((s, i) => (i === 0 ? { ...s, scene: { ...s.scene, code: `fetch("/api");\n${good}` } } : s)) };
    expect(deckToProjectFiles(tampered).some((f) => f.path === "scenes/slide-1.js")).toBe(false);
  });

  it("reuses scenes of unchanged slides when editing", async () => {
    const provider = new MockTextProvider();
    const opts = { userId: "u", jobId: "j", signal: new AbortController().signal, log: () => {} };
    const first = await addSceneCode(sampleDeck("Reuse"), null, provider, opts);
    const edited = { ...first, slides: first.slides.map((s, i) => (i === 1 ? { ...s, title: "A new title", scene: { ...s.scene, code: undefined } } : { ...s, scene: { ...s.scene, code: undefined } })) };
    const logs: string[] = [];
    const out = await addSceneCode(edited, first, provider, { ...opts, log: (m: string) => logs.push(m) });
    expect(out.slides[0].scene.code).toBe(first.slides[0].scene.code);
    expect(logs[0]).toMatch(/Designing 1 custom 3D scene/);
  });
});

describe("faster generation", () => {
  it("extracts complete slides from a deck that is still streaming", async () => {
    const { completedSlides } = await import("@/server/deck/scene-code");
    const deck = sampleDeck("Stream");
    const json = JSON.stringify({ title: deck.title, theme: deck.theme, slides: deck.slides.map((s) => ({ ...s, title: `${s.title} {"tricky": [x]}` })) });
    const cut = json.indexOf(deck.slides[2].kicker); // part-way through slide 3
    const partial = completedSlides(json.slice(0, cut));
    expect(partial.head?.title).toBe(deck.title);
    expect(partial.slides).toHaveLength(2);
    expect((partial.slides[1] as { title: string }).title).toContain('{"tricky": [x]}');
    expect(completedSlides(json).slides).toHaveLength(4);
    expect(completedSlides('{"title":"x","th').head).toBeNull();
  });

  it("leaves scene code out of the deck sent to the model for edits", async () => {
    const { deckForPrompt } = await import("@/server/deck/scene-code");
    const deck = await addSceneCode(sampleDeck("Edit"), null, new MockTextProvider(), { userId: "u", jobId: "j", signal: new AbortController().signal, log: () => {} });
    expect(JSON.stringify(deck)).toContain("THREE.Group");
    expect(JSON.stringify(deckForPrompt(deck))).not.toContain("THREE.Group");
  });
});
