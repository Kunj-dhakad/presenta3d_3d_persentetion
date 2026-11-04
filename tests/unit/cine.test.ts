import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { startJob } from "@/server/jobs/runner";
import { runCinePipeline } from "@/server/deck/cine-pipeline";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { isGeneratedDeck } from "@/server/build/builder";
import { MockTextProvider } from "@/server/ai/mock-provider";
import { createProject, getFiles } from "@/server/services/projects";
import { storage } from "@/server/storage/storage";
import { validateDeck, type DeckSpec } from "@/lib/schemas/deck";
import { CineSpecSchema, cineForPrompt, cineToDeck, type CineSpec } from "@/lib/schemas/cine";
import { applyDeckDesign, deckColors } from "@/lib/deck-design";
import type { PipelineResult } from "@/server/pipeline/generate";
import { createUser, waitForJob } from "../support/helpers";

const slide = (over: Partial<CineSpec["slides"][number]>): CineSpec["slides"][number] => ({
  look: "statement",
  kicker: "",
  title: "There is a way",
  highlight: "",
  subtitle: "",
  bullets: [],
  stats: [],
  items: [],
  visual: "none",
  tone: "#4fd8e0",
  imagePrompt: "",
  textEffect: "zoom",
  notes: "Narration.",
  ...over,
});
const spec = (slides: CineSpec["slides"]): CineSpec => ({ title: "The Last Degree", theme: { background: "#030608", text: "#f6f1ea", accent: "#ff7a1a", font: "display" }, slides });

function made(s: CineSpec, previous: DeckSpec | null = null) {
  const r = cineToDeck(s, previous);
  if (!r.deck.ok) throw new Error(r.deck.errors.join("; "));
  return { deck: r.deck.deck, missing: r.missing };
}

describe("cinematic decks", () => {
  it("turns the model's deck into a stored deck and lists the slides that need an image", () => {
    const { deck, missing } = made(
      spec([
        slide({ look: "hero", title: "The last degree", highlight: "degree", imagePrompt: "Earth at night, glowing cities" }),
        slide({ look: "cards", items: [{ heading: "Fossil fuels", text: "Coal, oil and gas." }], bullets: ["ignored"], visual: "orbs" }),
        slide({ look: "closing", imagePrompt: "" }),
      ]),
    );
    expect(deck.style).toBe("cinematic");
    expect(deck.slides.map((s) => s.layout)).toEqual(["hero", "left", "hero"]);
    expect(missing).toEqual([0, 2]); // a closing slide without a prompt gets one from its title
    expect(deck.slides[2].cine!.imagePrompt).toContain("There is a way");
    expect(deck.slides[1].bullets).toEqual([]); // only the bullets look keeps bullets
    expect(deck.slides[1].cine!.items).toHaveLength(1);
    expect(deck.slides[0].cine!.visual).toBe("none"); // image slides use no CSS visual
    // A new deck ends on the Thank-you slide.
    expect(deck.settings.thankYou.enabled).toBe(true);
  });

  it("survives validation unchanged (the engine upgrade must not turn it into a 3D deck)", () => {
    const { deck } = made(spec([slide({ look: "hero", imagePrompt: "x" })]));
    const again = validateDeck(JSON.parse(JSON.stringify(deck)));
    expect(again.ok && again.deck).toEqual(deck);
  });

  it("keeps only safe images and highlights that are in the title", () => {
    const { deck } = made(spec([slide({ highlight: "nowhere" })]));
    const check = (image: string) => {
      const v = validateDeck({ ...deck, slides: [{ ...deck.slides[0], cine: { ...deck.slides[0].cine!, image } }] });
      return v.ok ? v.deck.slides[0].cine!.image : null;
    };
    expect(deck.slides[0].cine!.highlight).toBe("");
    expect(check("/deckmedia/cproject123/abcdefghijkl.webp")).toBe("/deckmedia/cproject123/abcdefghijkl.webp");
    expect(check("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(check("javascript:alert(1)")).toBe("");
    expect(check("http://insecure.example.com/a.jpg")).toBe("");
    expect(check("/deckmedia/../secret.webp")).toBe("");
  });

  it("keeps the painted image of a slide whose prompt did not change in an edit", () => {
    const first = made(spec([slide({ look: "hero", imagePrompt: "Earth at night" }), slide({ look: "image", title: "Ice falls", imagePrompt: "Glacier collapsing" })]));
    const painted: DeckSpec = { ...first.deck, slides: first.deck.slides.map((s, i) => ({ ...s, cine: { ...s.cine!, image: `/deckmedia/cproject123/image${i}abcdef.webp` } })) };
    const edited = made(spec([slide({ look: "hero", imagePrompt: "Earth  at NIGHT" }), slide({ look: "image", title: "Ice falls", imagePrompt: "A burning forest" })]), painted);
    expect(edited.deck.slides[0].cine!.image).toBe("/deckmedia/cproject123/image0abcdef.webp");
    expect(edited.deck.slides[1].cine!.image).toBe("");
    expect(edited.missing).toEqual([1]);
  });

  it("gives the model back what it wrote when editing", () => {
    const s = spec([slide({ look: "timeline", items: [{ heading: "NOW", text: "Start" }] })]);
    const back = cineForPrompt(made(s).deck);
    expect(CineSpecSchema.safeParse(back).success).toBe(true);
    expect(back.slides[0]).toMatchObject({ look: "timeline", items: [{ heading: "NOW", text: "Start" }], tone: "#4fd8e0" });
  });

  it("uses the two design colours as alternating glow tones", () => {
    const { deck } = made(spec([slide({}), slide({}), slide({})]));
    const changed = applyDeckDesign(deck, { primary: "#111111", secondary: "#222222" });
    expect(changed.slides.map((s) => s.cine!.tone)).toEqual(["#111111", "#222222", "#111111"]);
    expect(deckColors(changed)).toMatchObject({ primary: "#111111", secondary: "#222222" });
  });

  it("has exactly the 3D engine's full-screen controls (only the slides differ)", () => {
    const { deck } = made(spec([slide({})]));
    const cine = deckToProjectFiles(deck)[0].content;
    const threeD = deckToProjectFiles(validateDeck({ ...deck, style: undefined }).ok ? { ...deck, style: undefined } : deck)[0].content;
    // The controls' markup, from the progress bar to the dots bar.
    const chrome = (html: string) => html.slice(html.indexOf('<div class="progress"'), html.indexOf("</nav>") + 6);
    expect(chrome(cine)).toBe(chrome(threeD));
    // Every control rule of the 3D engine is in the cinematic one, unchanged.
    const rules = threeD.split("\n").filter((l) => /^(\.pill|#chip|#counter|#hint|\.hud|#dots|\.dot|\.nav-btn|\.progress|#progress|#notes|body\.show-notes|#play\.playing|#brand)\b/.test(l));
    expect(rules.length).toBeGreaterThan(15);
    for (const rule of rules) expect(cine).toContain(rule);
  });

  it("is rendered by the cinematic engine, built in-process like any generated deck", () => {
    const { deck } = made(spec([slide({ look: "hero", title: `<img src=x onerror=alert(1)>`, imagePrompt: "x" })]));
    const files = deckToProjectFiles(deck);
    expect(files.map((f) => f.path)).toEqual(["index.html", "deck.json", "main.js"]);
    expect(files[0].content).toContain("Bebas+Neue");
    expect(files[0].content).not.toContain("<img src=x");
    expect(files[2].content).toContain("deck3d-preview"); // the same protocol as the 3D engine
    expect(files[2].content).not.toContain("three");
    expect(isGeneratedDeck(files)).toBe(true);
  });
});

async function run(userId: string, projectId: string, prompt: string) {
  const conv = (await db.conversation.findFirst({ where: { projectId } })) ?? (await db.conversation.create({ data: { userId, projectId, title: prompt } }));
  await db.chatMessage.create({ data: { conversationId: conv.id, role: "user", content: prompt } });
  const provider = new MockTextProvider();
  const jobId = await startJob({ userId, projectId, kind: "project-generate", provider: provider.name, input: {} }, (ctx) =>
    runCinePipeline(ctx, provider, { userId, projectId, conversationId: conv.id, prompt, mode: "auto" }),
  );
  const job = await waitForJob(jobId, 120_000);
  return { job, result: job.output as unknown as PipelineResult };
}

describe("cinematic generation", () => {
  it("writes the story, paints every image at once, and edits only what was asked", async () => {
    const u = await createUser();
    const p = await createProject(u.id, { name: "Untitled presentation", category: "presentation", framework: "cinematic" });
    const first = await run(u.id, p.id, "Global warming and the technology that can stop it");
    expect(first.job.status).toBe("succeeded");
    expect(first.result.buildStatus).toBe("succeeded");
    const events = first.job.events as { type: string; status?: string; message?: string; stage?: string; state?: string }[];
    // Shown first with the slides' colours, then rebuilt with the images.
    expect(events.filter((e) => e.type === "build" && e.status === "succeeded")).toHaveLength(2);
    expect(events.some((e) => e.type === "log" && /Painting 2 images at the same time/.test(e.message ?? ""))).toBe(true);
    expect(events.some((e) => e.type === "stage" && e.stage === "images" && e.state === "done")).toBe(true);

    const files = await getFiles(p.id);
    const deck = JSON.parse(files.find((f) => f.path === "deck.json")!.content) as DeckSpec;
    expect(deck.style).toBe("cinematic");
    const images = deck.slides.map((s) => s.cine!.image).filter(Boolean);
    expect(images).toHaveLength(2);
    for (const url of images) {
      expect(url).toMatch(/^\/deckmedia\/[^/]+\/[A-Za-z0-9_-]+\.png$/);
      expect(await storage().get(url.slice(1))).not.toBeNull();
    }
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(project.framework).toBe("cinematic");
    expect(project.name).toContain("Global warming");

    // An edit keeps the images of slides it did not change: nothing is painted again.
    const second = await run(u.id, p.id, 'Change the title of slide 4 to "But there is hope"');
    expect(second.result.buildStatus).toBe("succeeded");
    expect(second.result.changedFiles).toEqual(["deck.json"]);
    const deck2 = JSON.parse((await getFiles(p.id)).find((f) => f.path === "deck.json")!.content) as DeckSpec;
    expect(deck2.slides[3].title).toBe("But there is hope");
    expect(deck2.slides.map((s) => s.cine!.image).filter(Boolean)).toEqual(images);
    const events2 = second.job.events as { type: string; stage?: string }[];
    expect(events2.some((e) => e.type === "stage" && e.stage === "images")).toBe(false);
  });
});
