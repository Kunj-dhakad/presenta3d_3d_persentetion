import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/server/db/client";
import type { Prisma } from "@/generated/mysql-prisma/client";
import { CONTINUE, type JobContext } from "@/server/jobs/runner";
import { AIError, type TextModelProvider } from "@/server/ai/types";
import type { DeckSpec } from "@/lib/schemas/deck";
import { CineSpecSchema, cineForPrompt, cineToDeck } from "@/lib/schemas/cine";
import { diffStats, toFileMap } from "@/lib/vfs/apply";
import { getFiles, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { formatDiagnostic, type BuildSummary } from "@/lib/build-types";
import { storage } from "@/server/storage/storage";
import { deckToProjectFiles } from "./codegen";
import { conversation, currentDeck, retryOnce } from "./pipeline";
import { ImagePainter, canPaintImages } from "./cine-images";
import type { PipelineInput, PipelineResult } from "@/server/pipeline/generate";

export const CINE_SYSTEM = `You are the director of Present 3D's cinematic presentations: slide decks that feel like a film trailer.
You do not write code. You write a CineSpec: the story, the words and the art direction. A fixed engine renders it: full-bleed AI images with slow camera motion, huge condensed titles that zoom or rise in, glowing particles, and a blur-and-flash cut between slides.

Story: write it like a trailer, in acts: a gripping opening (hero, over an image), the stakes or the problem, a turn ("BUT / THERE IS A WAY"), the solutions or the offer, the plan, and a closing line over an image. Use 7-10 slides unless the user asks otherwise. Do not write a "Thank you" slide: the engine adds its own.
Words: titles are 2-7 punchy words written for huge capitals (e.g. "THE LAST DEGREE", "ICE FALLS. SEAS RISE. FORESTS BURN."). Kickers are short scene labels ("THE CAUSE", "SOLUTION 01", "THIS NOVEMBER · A PLANET ON FIRE"). Subtitles are one short sentence. Real, specific facts and copy, never placeholders. Write in the language the user writes in.
highlight: on most slides pick the key word(s) of the title, copied exactly, to glow in the slide's tone.
Looks: vary them; never put the same look on neighbouring slides, except image slides may follow each other once.
- hero (first slide) and closing (last slide) and 1-3 "image" slides are drawn over a full-bleed AI image: write their imagePrompt.
- statement: one huge centred turning-point line, no image.
- stats: 2-3 huge numbers (value + short label) with a visual.
- cards: exactly 3 numbered items (heading + one sentence).
- timeline: 3-4 milestones (heading = when, e.g. "NOW", "2030"; text = 2-5 words).
- bullets: 2-4 short bullets with a visual.
Visuals for slides without an image: planet, spiral, orbs, pulse (vary them), or none for statements.
Image prompts: describe one striking photorealistic scene that carries the slide's idea (subject, setting, light, colour grade, camera angle), cinematic and dramatic, with darker calm space on the left for the title. Never ask for text, words, logos or UI in the image. Keep the deck's colour grade consistent.
Colour: theme.background near black; theme.text warm off-white; theme.accent one vivid kicker colour used on every slide. Each slide's tone is its glow colour: shift it with the story (e.g. ember orange for danger, cyan for technology, green for hope) but keep 2-3 tones per deck.
textEffect: vary it; "zoom" for big openings, "letters" for short powerful titles, "rise", "slide", "blur", "flip" elsewhere.
Narration: every slide's notes is what a presenter says over it (read aloud with subtitles): 2-4 warm, spoken sentences, never empty.
Names: use the names the user gives; if you must invent one, make it specific to the topic.`;

export const CINE_EDIT_RULES = `You are editing an existing cinematic deck. Return the COMPLETE updated deck.
Apply exactly what the user asks; keep every other slide, word, image prompt and colour unchanged (an unchanged imagePrompt keeps its painted image; a changed one is painted again). Slides are numbered from 1.
If the user asks for a presentation about a different topic, write a new deck for the new topic with new image prompts and colours.`;

const GRADES = [
  "ember orange and teal, like a disaster epic",
  "cold steel blue and white, like a space drama",
  "golden hour amber and deep shadow",
  "neon magenta and cyan night city",
  "emerald green and gold, lush and hopeful",
  "crimson and charcoal, intense and dramatic",
  "desert sand and burnt copper",
  "deep ocean blue with bioluminescent cyan",
];

function cineBrief(): string {
  return `Art direction idea for this deck (adapt it to the topic): colour grade ${GRADES[randomInt(GRADES.length)]}.`;
}

/** Rounds (steps) the images get before the slides that are still missing one are left on their colours. */
const MAX_IMAGE_ROUNDS = 3;
/** An image round starts only with this much time left in the step (an image takes 15-40 s). */
const MIN_IMAGE_WINDOW_MS = 25_000;
const MIN_FINAL_WINDOW_MS = 15_000;
const MAX_DECK_ATTEMPTS = 3;

type Checkpoint = {
  v: 1;
  t0: number;
  deckAttempts: number;
  deck?: DeckSpec;
  /** Slides still waiting for their image. */
  missing?: number[];
  rounds?: number;
  existing?: boolean;
  preVersionId?: string | null;
  before?: Record<string, string>;
  /** The first preview was built before the images: build again at the end. */
  rebuild?: boolean;
  firstBuild?: BuildSummary;
};

const checkpointKey = (jobId: string) => `jobs/${jobId}/checkpoint.json`;

async function loadCheckpoint(jobId: string): Promise<Checkpoint | null> {
  try {
    const raw = await storage().get(checkpointKey(jobId));
    const cp = raw ? (JSON.parse(Buffer.from(raw).toString("utf8")) as Checkpoint) : null;
    return cp?.v === 1 ? cp : null;
  } catch {
    return null;
  }
}

function saveCheckpoint(jobId: string, cp: Checkpoint) {
  return retryOnce(() => storage().put(checkpointKey(jobId), Buffer.from(JSON.stringify(cp), "utf8"), "application/json"));
}

/** Put the painted images into the deck (index → URL). */
function withImages(deck: DeckSpec, images: Map<number, string>): DeckSpec {
  return { ...deck, slides: deck.slides.map((s, i) => (images.has(i) && s.cine ? { ...s, cine: { ...s.cine, image: images.get(i)! } } : s)) };
}

/**
 * Generate or edit a cinematic presentation: the model writes the story and
 * image prompts (CineSpec), the deck is built and shown at once, and every
 * slide image is painted by OpenAI in parallel; the deck is built again with
 * them. Same steps, checkpoints, versions and chat reply as the 3D pipeline
 * (server/deck/pipeline.ts), so the editor treats both alike.
 */
export async function runCinePipeline(ctx: JobContext, provider: TextModelProvider, input: PipelineInput): Promise<PipelineResult | typeof CONTINUE> {
  const stepped = Number.isFinite(ctx.deadline);
  const saved = stepped ? await loadCheckpoint(ctx.jobId) : null;
  const t0 = saved?.t0 ?? Date.now();
  const log = (message: string) => ctx.emit({ type: "log", level: "info", message: `${((Date.now() - t0) / 1000).toFixed(1)}s · ${message}` });
  const left = () => ctx.deadline - Date.now();
  let progressed = false;
  const pause = async (cp: Checkpoint): Promise<typeof CONTINUE> => {
    await saveCheckpoint(ctx.jobId, cp);
    return CONTINUE;
  };

  // Images still being painted when a step ends are stopped and painted again by the next step.
  const stopImages = new AbortController();
  const painter = new ImagePainter({
    projectId: input.projectId,
    signal: AbortSignal.any([ctx.signal, stopImages.signal]),
    log: (m, level = "info") => (level === "info" ? log(m) : ctx.emit({ type: "log", level, message: m })),
  });
  const paintable = canPaintImages();
  const paintAll = (deck: DeckSpec, indexes: number[]) => {
    for (const i of indexes) {
      const prompt = deck.slides[i]?.cine?.imagePrompt;
      if (prompt) painter.start(i, prompt);
    }
  };

  const meta = (name: string, deck: DeckSpec) => ({
    name: name === "Untitled project" || name === "Untitled presentation" || (input.draftName && name === input.draftName) ? deck.title.slice(0, 120) : name,
    description: deck.slides[0]?.subtitle.slice(0, 500) ?? "",
    category: "presentation",
    framework: "cinematic",
  });
  const saveAndBuild = async (d: DeckSpec, projectData: Prisma.ProjectUpdateInput) => {
    await ctx.ensureLease();
    const out = deckToProjectFiles(d);
    await writeFileSet(input.projectId, out, projectData);
    ctx.emit({ type: "stage", stage: "build", state: "start" });
    const b = await buildProject({ projectId: input.projectId, framework: "cinematic", files: out });
    ctx.emit({ type: "build", status: b.status === "succeeded" ? "succeeded" : "failed", buildId: b.buildId, previewUrl: b.previewUrl, errors: b.errors, warnings: b.warnings, attempt: 0 });
    ctx.emit({ type: "stage", stage: "build", state: b.status === "succeeded" ? "done" : "failed", detail: b.status === "succeeded" ? "ready" : formatDiagnostic(b.errors[0]) });
    return { files: out, build: b };
  };

  let cp: Checkpoint;
  if (saved?.deck) {
    cp = saved;
    log(`Resuming: ${cp.missing?.length ?? 0} image${cp.missing?.length === 1 ? "" : "s"} still to paint`);
  } else {
    // ─── Step 1: write the story, start every image, show the first preview ──
    const deckAttempts = (saved?.deckAttempts ?? 0) + 1;
    if (deckAttempts > MAX_DECK_ATTEMPTS) throw new Error("Writing the slides was interrupted several times. Please try again.");
    if (stepped) await saveCheckpoint(ctx.jobId, { v: 1, t0, deckAttempts });
    if (deckAttempts > 1) log("Resuming: the previous attempt was cut off, writing the slides again");

    ctx.emit({ type: "stage", stage: "understand", state: "start" });
    log("Loading the project and conversation");
    const [project, fileList, history] = await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: input.projectId } }),
      getFiles(input.projectId),
      conversation(input.conversationId),
    ]);
    const files = toFileMap(fileList);
    const found = currentDeck(files);
    // Only a cinematic deck is edited as one; anything else is replaced by a new cinematic deck.
    const existing = found?.style === "cinematic" ? found : null;
    if (existing) log(`Found the current deck (${existing.slides.length} slides); saving a restore point`);
    const pre = files.size ? await snapshot(input.projectId, "pre-ai", { summary: `Before: ${input.prompt.slice(0, 100)}`, files: fileList }) : null;

    ctx.emit({ type: "understanding", text: existing ? `Updating your cinematic presentation: ${input.prompt.slice(0, 160)}` : `Designing a cinematic presentation: ${input.prompt.slice(0, 160)}` });
    ctx.emit({ type: "stage", stage: "understand", state: "done" });
    ctx.emit({ type: "stage", stage: "plan", state: "done", detail: existing ? `${existing.slides.length} slides` : "story, slides and images" });
    ctx.emit({ type: "stage", stage: "generate", state: "start", detail: existing ? "Editing slides" : "Writing slides" });
    ctx.progress(0.1);

    const ask = async (extra: string) =>
      (
        await provider.structured({
          operation: existing ? "cine.edit" : "cine.generate",
          schema: CineSpecSchema,
          schemaName: "cine_spec",
          system: existing ? `${CINE_SYSTEM}\n\n${CINE_EDIT_RULES}` : CINE_SYSTEM,
          input: [
            history ? `Conversation so far:\n${history}` : "",
            existing ? `Current deck (JSON):\n${JSON.stringify(cineForPrompt(existing))}` : "",
            `User request:\n${input.prompt}`,
            existing ? "" : cineBrief(),
            extra,
          ]
            .filter(Boolean)
            .join("\n\n"),
          maxOutputTokens: 16_000,
          reasoningEffort: "low",
          signal: ctx.signal,
          userId: input.userId,
          jobId: ctx.jobId,
          onProgress: (chars) => ctx.emit({ type: "stream", taskId: "deck", chars }),
        })
      ).data;

    log(`Asking ${provider.name} · ${provider.model} to ${existing ? "edit the slides" : "write the story, slides and image prompts"}`);
    let raw;
    try {
      raw = await ask("");
    } catch (err) {
      if (err instanceof AIError && err.retryable && !ctx.signal.aborted) {
        ctx.emit({ type: "log", level: "warn", message: `${err.message}. Retrying once.` });
        raw = await ask("");
      } else throw err;
    }
    let made = cineToDeck(raw, existing);
    if (!made.deck.ok) {
      ctx.emit({ type: "stage", stage: "repair", state: "start", detail: made.deck.errors[0] });
      raw = await ask(`Your previous answer was invalid:\n${made.deck.errors.join("\n")}\nReturn a corrected, complete deck.`);
      made = cineToDeck(raw, existing);
      if (!made.deck.ok) throw new Error(`The presentation could not be generated: ${made.deck.errors.slice(0, 3).join("; ")}`);
      ctx.emit({ type: "stage", stage: "repair", state: "done" });
    }
    const deck = made.deck.deck;
    const missing = paintable ? made.missing : [];
    log(`Received “${deck.title}”: ${deck.slides.length} slides · ${made.missing.length} image${made.missing.length === 1 ? "" : "s"} to paint`);
    ctx.emit({ type: "stage", stage: "generate", state: "done", detail: `${deck.slides.length} slides` });
    ctx.progress(0.35);

    // Every image starts now, together; the slides show their colours until it arrives.
    if (missing.length) {
      ctx.emit({ type: "stage", stage: "images", state: "start", detail: `${missing.length} at once` });
      log(`Painting ${missing.length} cinematic image${missing.length > 1 ? "s" : ""} at the same time`);
      paintAll(deck, missing);
    } else if (made.missing.length) {
      ctx.emit({ type: "log", level: "warn", message: "No image model is configured (OPENAI_IMAGE_MODEL); the slides use their colours instead of images" });
    }

    log(`Building the presentation and uploading it to ${storage().driver === "s3" ? "S3" : "local storage"}`);
    const first = await saveAndBuild(deck, meta(project.name, deck));
    log(first.build.status === "succeeded" ? (missing.length ? "Preview is ready — images appear as they finish" : "Preview is ready") : `Preview build failed: ${formatDiagnostic(first.build.errors[0])}`);
    ctx.progress(0.5);
    cp = {
      v: 1,
      t0,
      deckAttempts,
      deck,
      missing,
      rounds: 0,
      existing: Boolean(existing),
      preVersionId: pre?.id ?? null,
      before: Object.fromEntries(files),
      rebuild: missing.length > 0,
      firstBuild: first.build,
    };
    if (stepped) await saveCheckpoint(ctx.jobId, cp);
    progressed = true;
  }

  // ─── Images (all in parallel; resumable) ─────────────────────────────
  let deck = cp.deck!;
  if (cp.missing?.length) {
    const inFlight = cp.missing.filter((i) => painter.has(i));
    if (progressed && !inFlight.length && left() < MIN_IMAGE_WINDOW_MS) return pause(cp);
    ctx.emit({ type: "stage", stage: "images", state: "start", detail: `${cp.missing.length} at once` });
    const toStart = cp.missing.filter((i) => !painter.has(i));
    if (toStart.length) log(`Painting ${toStart.length} image${toStart.length > 1 ? "s" : ""} at the same time${cp.rounds ? ` (round ${cp.rounds + 1})` : ""}`);
    paintAll(deck, toStart);
    await painter.until(ctx.deadline - 2_000);
    if (ctx.signal.aborted) throw new DOMException("cancelled", "AbortError");
    const settled = painter.settled();
    deck = withImages(deck, new Map([...settled].filter((e): e is [number, string] => Boolean(e[1]))));
    const unfinished = cp.missing.filter((i) => !settled.has(i));
    cp = { ...cp, deck, missing: unfinished, rounds: (cp.rounds ?? 0) + 1 };
    progressed = true;
    if (unfinished.length) {
      stopImages.abort();
      if (cp.rounds! < MAX_IMAGE_ROUNDS) {
        log(`${settled.size} image${settled.size === 1 ? "" : "s"} ready; continuing with the other ${unfinished.length}`);
        return pause(cp);
      }
      ctx.emit({ type: "log", level: "warn", message: `${unfinished.length} image${unfinished.length > 1 ? "s" : ""} took too long; those slides use their colours` });
      cp = { ...cp, missing: [] };
    }
    const painted = deck.slides.filter((s) => s.cine?.image).length;
    ctx.emit({ type: "stage", stage: "images", state: "done", detail: `${painted} painted` });
  }
  ctx.progress(0.8);

  // ─── Final: build with the images, save a version and the chat reply ──
  if (progressed && left() < MIN_FINAL_WINDOW_MS) return pause(cp);
  let nextFiles = deckToProjectFiles(deck);
  let build = cp.firstBuild!;
  if (cp.rebuild) {
    log("Adding the images to the presentation");
    try {
      ({ files: nextFiles, build } = await saveAndBuild(deck, {}));
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      ctx.emit({ type: "log", level: "warn", message: `Saving the images failed (${(err as Error).message.split("\n").find(Boolean)?.slice(0, 120)}); retrying` });
      ({ files: nextFiles, build } = await saveAndBuild(deck, {}));
    }
  }
  ctx.progress(0.9);

  const before = new Map(Object.entries(cp.before ?? {}));
  const changed: { path: string; kind: "created" | "modified" | "deleted"; added: number; removed: number }[] = [];
  for (const f of nextFiles) {
    const prev = before.get(f.path) ?? null;
    if (prev === f.content) continue;
    const c = { path: f.path, kind: prev === null ? ("created" as const) : ("modified" as const), ...diffStats(prev, f.content) };
    changed.push(c);
    ctx.emit({ type: "file", ...c });
  }
  // Files of a former 3D deck (scenes/…) are not part of a cinematic one.
  for (const path of before.keys()) {
    if (nextFiles.some((f) => f.path === path)) continue;
    ctx.emit({ type: "file", path, kind: "deleted", added: 0, removed: 0 });
  }

  ctx.emit({ type: "stage", stage: "finalize", state: "start" });
  log("Saving a version and the chat reply");
  await ctx.ensureLease();
  const post = changed.length ? await retryOnce(() => snapshot(input.projectId, "ai", { summary: `${deck.title} (${deck.slides.length} slides)`, files: nextFiles })) : null;
  if (post && build.status === "succeeded") await retryOnce(() => markWorkingVersion(input.projectId, post.id));
  const buildStatus = build.status === "succeeded" ? ("succeeded" as const) : ("failed" as const);
  const images = deck.slides.filter((s) => s.cine?.image).length;
  const summary = cp.existing
    ? `Updated “${deck.title}” — ${deck.slides.length} slides.`
    : `Created “${deck.title}” — a cinematic presentation with ${deck.slides.length} slides${images ? ` and ${images} AI image${images > 1 ? "s" : ""}` : ""}. Use the arrow keys or click to move through it.`;
  const preVersionId = cp.preVersionId ?? null;
  const [message] = await retryOnce(() =>
    Promise.all([
      db.chatMessage.create({
        data: {
          conversationId: input.conversationId,
          role: "assistant",
          content: buildStatus === "failed" ? `${summary} The preview could not be built: ${formatDiagnostic(build.errors[0])}` : summary,
          meta: { jobId: ctx.jobId, changedFiles: changed, preVersionId, postVersionId: post?.id ?? null, buildStatus, buildId: build.buildId, slides: deck.slides.length } as Prisma.InputJsonValue,
        },
      }),
      db.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }),
    ]),
  );
  const result: PipelineResult = {
    summary,
    changedFiles: changed.map((c) => c.path),
    preVersionId,
    postVersionId: post?.id ?? null,
    buildStatus,
    buildId: build.buildId,
    previewUrl: build.previewUrl,
    assistantMessageId: message.id,
  };
  ctx.emit({ type: "result", ...result });
  ctx.emit({ type: "stage", stage: "finalize", state: "done" });
  if (stepped) void storage().deletePrefix(`jobs/${ctx.jobId}/`).catch(() => {});
  return result;
}
