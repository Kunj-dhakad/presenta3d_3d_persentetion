import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { startJob } from "@/server/jobs/runner";
import { runCinePipeline } from "@/server/deck/cine-pipeline";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { isGeneratedDeck } from "@/server/build/builder";
import { MockTextProvider } from "@/server/ai/mock-provider";
import { createProject, getFiles } from "@/server/services/projects";
import { storage } from "@/server/storage/storage";
import { contrastRatio, validateDeck, type DeckSpec } from "@/lib/schemas/deck";
import { CineSpecSchema, cineForPrompt, cineToDeck, imagePromptFor, type CineSpec } from "@/lib/schemas/cine";
import { deckColors } from "@/lib/deck-design";
import type { PipelineResult } from "@/server/pipeline/generate";
import { createUser, waitForJob } from "../support/helpers";

type SpecSlide = CineSpec["slides"][number];
const slide = (over: Omit<Partial<SpecSlide>, "motion"> & { motion?: Partial<SpecSlide["motion"]> }): SpecSlide => ({
  layout: "center",
  kicker: "",
  title: "There is a way",
  subtitle: "",
  bullets: [],
  stats: [],
  notes: "Narration.",
  ...over,
  motion: { text: "zoom", camera: "push", transition: "glide", pace: "normal", ...over.motion },
});
const spec = (slides: SpecSlide[], environment: CineSpec["theme"]["environment"] = "space"): CineSpec => ({
  title: "The Last Degree",
  theme: { background: "#030608", text: "#f6f1ea", accent: "#ff7a1a", font: "display", environment },
  slides,
});

function made(s: CineSpec, previous: DeckSpec | null = null) {
  const r = cineToDeck(s, previous);
  if (!r.deck.ok) throw new Error(r.deck.errors.join("; "));
  return { deck: r.deck.deck, missing: r.missing };
}

describe("cinematic decks", () => {
  it("gives EVERY slide an image prompt from its own words, and keeps layouts and motion", () => {
    const { deck, missing } = made(
      spec([
        slide({ layout: "hero", title: "The last degree", subtitle: "One degree decides everything." }),
        slide({ layout: "left", title: "Store and move", bullets: ["Grid batteries", "Electric trucks"], motion: { text: "split", transition: "whip" } }),
        slide({ layout: "stats", title: "Numbers", stats: [{ value: "64%", label: "of emissions" }], motion: { text: "wipe", transition: "rise" } }),
        slide({ layout: "center", title: "But there is hope", motion: { text: "letters", transition: "zoom" } }),
      ]),
    );
    expect(deck.style).toBe("cinematic");
    expect(deck.slides.map((s) => s.layout)).toEqual(["hero", "left", "stats", "center"]);
    expect(missing).toEqual([0, 1, 2, 3]); // every slide needs its image
    // The prompt is derived from the slide's own words, never written by the model.
    expect(deck.slides[0].cine!.imagePrompt).toContain("The last degree");
    expect(deck.slides[0].cine!.imagePrompt).toContain("One degree decides everything");
    expect(deck.slides[1].cine!.imagePrompt).toContain("Grid batteries; Electric trucks");
    expect(deck.slides[1].cine).toMatchObject({ text: "split", transition: "whip" });
    // Stats stay only on the stats layout.
    expect(deck.slides[2].stats).toHaveLength(1);
    // A new deck ends on the Thank-you slide.
    expect(deck.settings.thankYou.enabled).toBe(true);
  });

  it("builds each image prompt from the slide's layout, theme and environment", () => {
    const { deck } = made(
      spec(
        [
          slide({ layout: "hero", title: "Cedar Flow", subtitle: "Payments for small shops" }),
          slide({ layout: "left", title: "Fraud down 60%", bullets: ["Checks in seconds"] }),
          slide({ layout: "right", title: "The plan" }),
        ],
        "ocean",
      ),
    );
    const hero = imagePromptFor(deck, 0);
    expect(hero).toContain("Presentation topic: Cedar Flow.");
    expect(hero).toContain("Key idea: Payments for small shops.");
    expect(hero).toContain("#ff7a1a");
    expect(hero).toMatch(/rolling sea of glowing points/); // the ocean environment hint
    expect(hero).toMatch(/darker, low-detail central area/);
    expect(hero).toMatch(/No words, letters, labels/);
    // left/right layouts place the subject on the free half.
    expect(imagePromptFor(deck, 1)).toContain("Place the main subject on the RIGHT half");
    expect(imagePromptFor(deck, 2)).toContain("Place the main subject on the LEFT half");
  });

  it("never lets neighbouring slides share a text style or transition", () => {
    const same = Array.from({ length: 5 }, (_, i) => slide({ title: `Slide ${i + 1}` })); // the model repeated zoom/glide
    const { deck } = made(spec(same));
    for (let i = 1; i < deck.slides.length; i++) {
      expect(deck.slides[i].cine!.text).not.toBe(deck.slides[i - 1].cine!.text);
      expect(deck.slides[i].cine!.transition).not.toBe(deck.slides[i - 1].cine!.transition);
    }
  });

  it("survives validation unchanged (the engine upgrade must not turn it into a 3D deck)", () => {
    const { deck } = made(spec([slide({ layout: "hero" }), slide({ layout: "left", motion: { text: "letters" } })]));
    const again = validateDeck(JSON.parse(JSON.stringify(deck)));
    expect(again.ok && again.deck).toEqual(deck);
  });

  it("always keeps text readable on the background (dark on light, light on dark)", () => {
    const fix = (background: string, text: string, accent: string) => {
      const v = validateDeck({ ...made(spec([slide({})])).deck, theme: { background, text, accent, font: "display", environment: "space", transition: "side" } });
      if (!v.ok) throw new Error(v.errors.join(";"));
      return v.deck.theme;
    };
    // Dark text on a dark background turns light; light text on a light background turns dark.
    const dark = fix("#05060a", "#1a1a1a", "#202030");
    expect(contrastRatio(dark.text, dark.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.accent, dark.background)).toBeGreaterThanOrEqual(3);
    const light = fix("#f7f4ee", "#eeeeee", "#ffe08a");
    expect(contrastRatio(light.text, light.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.accent, light.background)).toBeGreaterThanOrEqual(3);
    // Readable colours are left exactly as chosen.
    expect(fix("#05060a", "#f2f3f7", "#ff8a5b")).toMatchObject({ text: "#f2f3f7", accent: "#ff8a5b" });
  });

  it("measures each image where its text sits and sets dark or light text for it", () => {
    const main = deckToProjectFiles(made(spec([slide({})])).deck)[2].content;
    expect(main).toContain("backdropFor(measure(");
    const html = deckToProjectFiles(made(spec([slide({})])).deck)[0].content;
    expect(html).toContain('.slide[data-backdrop="light"]');
    expect(html).toContain('.slide[data-backdrop="dark"]');
  });

  it("keeps only safe images", () => {
    const { deck } = made(spec([slide({})]));
    const check = (image: string) => {
      const v = validateDeck({ ...deck, slides: [{ ...deck.slides[0], cine: { ...deck.slides[0].cine!, image } }] });
      return v.ok ? v.deck.slides[0].cine!.image : null;
    };
    expect(check("/deckmedia/cproject123/abcdefghijkl.webp")).toBe("/deckmedia/cproject123/abcdefghijkl.webp");
    expect(check("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(check("javascript:alert(1)")).toBe("");
    expect(check("http://insecure.example.com/a.jpg")).toBe("");
    expect(check("/deckmedia/../secret.webp")).toBe("");
  });

  it("keeps the painted image of a slide whose words did not change in an edit", () => {
    const first = made(spec([slide({ layout: "hero", title: "Earth at night" }), slide({ layout: "left", title: "Ice falls" })]));
    const painted: DeckSpec = { ...first.deck, slides: first.deck.slides.map((s, i) => ({ ...s, cine: { ...s.cine!, image: `/deckmedia/cproject123/image${i}abcdef.webp` } })) };
    const edited = made(spec([slide({ layout: "hero", title: "Earth at night" }), slide({ layout: "left", title: "A burning forest" })]), painted);
    expect(edited.deck.slides[0].cine!.image).toBe("/deckmedia/cproject123/image0abcdef.webp");
    expect(edited.deck.slides[1].cine!.image).toBe("");
    expect(edited.missing).toEqual([1]);
  });

  it("gives the model back what it wrote when editing", () => {
    const s = spec([slide({ layout: "stats", stats: [{ value: "64%", label: "of invoices" }], motion: { text: "wipe", camera: "crane", transition: "rise", pace: "energetic" } })]);
    const back = cineForPrompt(made(s).deck);
    expect(CineSpecSchema.safeParse(back).success).toBe(true);
    expect(back.slides[0]).toMatchObject({ layout: "stats", stats: [{ value: "64%", label: "of invoices" }], motion: { text: "wipe", camera: "crane", transition: "rise", pace: "energetic" } });
    expect(back.theme.environment).toBe("space");
  });

  it("shows the theme's colours in the Design panel", () => {
    const { deck } = made(spec([slide({})]));
    expect(deckColors(deck)).toEqual({ background: "#030608", text: "#f6f1ea", accent: "#ff7a1a", primary: "#ff7a1a", secondary: "#ff7a1a" });
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

  it("is rendered by the image engine, built in-process like any generated deck", () => {
    const { deck } = made(spec([slide({ layout: "hero", title: `<img src=x onerror=alert(1)>` })]));
    const files = deckToProjectFiles(deck);
    expect(files.map((f) => f.path)).toEqual(["index.html", "deck.json", "main.js"]);
    expect(files[0].content).toContain("slide-art"); // the photograph fills the screen
    expect(files[0].content).not.toContain("<img src=x");
    expect(files[2].content).toContain("deck3d-preview"); // the same protocol as the 3D engine
    expect(files[2].content).toContain('from "gsap"');
    expect(files[2].content).not.toContain('from "three"'); // image-led: no 3D
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
    expect(events.some((e) => e.type === "log" && /Painting 6 images at the same time/.test(e.message ?? ""))).toBe(true);
    expect(events.some((e) => e.type === "stage" && e.stage === "images" && e.state === "done")).toBe(true);

    const files = await getFiles(p.id);
    const deck = JSON.parse(files.find((f) => f.path === "deck.json")!.content) as DeckSpec;
    expect(deck.style).toBe("cinematic");
    // Every slide has its own image.
    const images = deck.slides.map((s) => s.cine!.image).filter(Boolean);
    expect(images).toHaveLength(deck.slides.length);
    expect(new Set(images).size).toBe(images.length);
    for (const url of images) {
      expect(url).toMatch(/^\/deckmedia\/[^/]+\/[A-Za-z0-9_-]+\.png$/);
      expect(await storage().get(url.slice(1))).not.toBeNull();
    }
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(project.framework).toBe("cinematic");
    expect(project.name).toContain("Global warming");

    // An edit repaints only the slide whose words changed; every other image is kept.
    const second = await run(u.id, p.id, 'Change the title of slide 4 to "But there is hope"');
    expect(second.result.buildStatus).toBe("succeeded");
    expect(second.result.changedFiles).toEqual(["deck.json"]);
    const deck2 = JSON.parse((await getFiles(p.id)).find((f) => f.path === "deck.json")!.content) as DeckSpec;
    expect(deck2.slides[3].title).toBe("But there is hope");
    const images2 = deck2.slides.map((s) => s.cine!.image);
    expect(images2[3]).not.toBe(images[3]); // its words changed: painted again
    expect(images2.filter((_, i) => i !== 3)).toEqual(images.filter((_, i) => i !== 3));
    const events2 = second.job.events as { type: string; message?: string }[];
    expect(events2.some((e) => e.type === "log" && /Painting 1 image at the same time/.test(e.message ?? ""))).toBe(true);
  }, 120_000);
});
