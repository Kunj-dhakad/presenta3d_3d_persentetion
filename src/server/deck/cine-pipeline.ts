import "server-only";
import { randomInt } from "node:crypto";
import { db } from "@/server/db/client";
import type { Prisma } from "@/generated/mysql-prisma/client";
import { CONTINUE, type JobContext } from "@/server/jobs/runner";
import { AIError, type TextModelProvider } from "@/server/ai/types";
import type { DeckSpec } from "@/lib/schemas/deck";
import { CineSpecSchema, cineForPrompt, cineToDeck, imagePromptFor } from "@/lib/schemas/cine";
import { ENVIRONMENTS, ENVIRONMENT_HINTS } from "@/lib/schemas/deck";
import { diffStats, toFileMap } from "@/lib/vfs/apply";
import { getFiles, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { formatDiagnostic, type BuildSummary } from "@/lib/build-types";
import { storage } from "@/server/storage/storage";
import { deckToProjectFiles } from "./codegen";
import { conversation, currentDeck, retryOnce } from "./pipeline";
import { ImagePainter, type ImageQuality } from "./cine-images";
import type { PipelineInput, PipelineResult } from "@/server/pipeline/generate";

export const CINE_SYSTEM = `You are the presentation designer of Present 3D. You create cinematic image-led presentations.
You do not write code. You write a CineSpec: the content and art direction of each slide. Each slide will receive a unique AI-generated topic-specific image, derived from the slide's own words; the presentation engine animates the image and text with smooth transitions.

Write a strong story: an opening hero slide, a clear arc, and a closing slide. Use 5-10 slides unless the user asks otherwise. Do not write a "Thank you" slide: the engine adds its own.
Content rules: titles at most ~8 words; at most 4 bullets per slide, each at most ~12 words; real, specific copy (no lorem ipsum, no placeholders). Write in the language the user writes in.
Layouts: "hero" for the opening (and optionally the closing), "left"/"right" for explanatory slides (alternate them), "center" for a single big statement, "stats" for 2-4 headline numbers. Choose layouts that leave a calm, dark area behind the text while showing the slide's subject clearly.
Each slide gets its own cinematic motion (slide.motion), chosen from its content: the text animation (glitch for tech and disruption, zoom for big statements, split for contrasts, rotate3d for products and reveals, wipe for data and clean corporate points, letters for short powerful titles and names, fadeUp for calm storytelling), the slow image move while it is shown, the transition into it, and the pace. Make every slide feel different: never repeat a text style or transition on consecutive slides, and use at least four different text styles in a deck of five or more slides. Open with a strong reveal and close with a calm one.
theme.environment is the image's overall atmospheric treatment:
${ENVIRONMENTS.map((e) => `- ${e}: ${ENVIRONMENT_HINTS[e]}`).join("\n")}
Art direction: a dark theme.background (near black, tinted toward the palette), light theme.text, one vivid theme.accent.
Every deck must feel designed for its own topic: derive the palette, environment and font from the subject, not from habit. Do not default to cyan/blue or the grid environment.
Narration: every slide's notes is what a presenter says over it (read aloud with subtitles): 2-4 warm, spoken sentences, never empty.
Names: use the names the user gives. If you must invent a product or company name, make it specific to the topic; avoid generic names like "Pulse", "Nova", "Nexus", "Aura" or "Vertex".`;

export const CINE_EDIT_RULES = `You are editing an existing cinematic deck. Return the COMPLETE updated deck.
Apply exactly what the user asks; keep every other slide, word and setting unchanged (a slide whose words and colours do not change keeps its painted image; changed words get a new one). If the user refers to a slide by number, slides are numbered from 1.`;

/**
 * A random art-direction starting point for a new deck. The model adapts it
 * to the topic; it exists so that two decks never come out looking the same.
 */
function cineBrief(): string {
  const pick = <T,>(xs: readonly T[]) => xs[randomInt(xs.length)];
  const palettes = [
    "warm sunset: amber, coral and deep plum",
    "emerald and gold on a dark green-black",
    "ice: pale blue, silver and white",
    "magenta and violet neon",
    "lime and teal on charcoal",
    "crimson and soft rose on near-black",
    "copper and sand on dark brown",
    "ocean: turquoise and deep navy",
    "pastel lavender and mint",
    "electric orange and graphite",
  ];
  return [
    "Image art direction for this deck (a fresh starting point; adapt anything that clashes with the topic):",
    `- palette idea: ${pick(palettes)}`,
    `- environment idea: ${pick(ENVIRONMENTS)}`,
  ].join("\n");
}

/** Steps (rounds) the images get; the last round paints at low quality, which is much faster. */
const MAX_IMAGE_ROUNDS = 3;
/** Images start only with this much time left in a step (a low-quality image takes about 11 s). */
const MIN_IMAGE_WINDOW_MS = 18_000;
/** With this much time left, the first round may paint at medium quality (about 25-30 s, measured). */
const MEDIUM_WINDOW_MS = 36_000;
const MIN_FINAL_WINDOW_MS = 15_000;
const MAX_DECK_ATTEMPTS = 3;

type Checkpoint = {
  v: 1;
  t0: number;
  deckAttempts: number;
  deck?: DeckSpec;
  /** Slides still waiting for their image. */
  missing?: number[];
  /** Image rounds done so far. */
  imageRounds?: number;
  /** Why images failed (shown in the chat reply). */
  imageErrors?: string[];
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

  const painter = new ImagePainter(input.projectId);
  const warn = (message: string) => ctx.emit({ type: "log", level: "warn", message });

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

    log(`Asking ${provider.name} · ${provider.model} to ${existing ? "edit the slides" : "write the story and slides"}`);
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
    const missing = made.missing;
    log(`Received “${deck.title}”: ${deck.slides.length} slides · ${made.missing.length} image${made.missing.length === 1 ? "" : "s"} to paint`);
    ctx.emit({ type: "stage", stage: "generate", state: "done", detail: `${deck.slides.length} slides` });
    ctx.progress(0.35);

    if (missing.length) log(`${missing.length} image${missing.length > 1 ? "s" : ""} to paint with ${painter.model}, all at once, as soon as the preview is ready`);

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
      imageRounds: 0,
      imageErrors: [],
      existing: Boolean(existing),
      preVersionId: pre?.id ?? null,
      before: Object.fromEntries(files),
      rebuild: missing.length > 0,
      firstBuild: first.build,
    };
    if (stepped) await saveCheckpoint(ctx.jobId, cp);
    progressed = true;
  }

  // ─── Images: ALL started at once, within one step (resumable) ─────────
  let deck = cp.deck!;
  if (cp.missing?.length) {
    // An image cannot outlive its request: start them in a step with enough time left.
    if (progressed && left() < MIN_IMAGE_WINDOW_MS) return pause(cp);
    const round = (cp.imageRounds ?? 0) + 1;
    // Medium quality only in the first round and with time to spare; low otherwise, so a round always fits its step.
    const quality: ImageQuality = round === 1 && (!stepped || left() >= MEDIUM_WINDOW_MS) ? "medium" : "low";
    const errors = [...(cp.imageErrors ?? [])];
    ctx.emit({ type: "stage", stage: "images", state: "start", detail: `${cp.missing.length} at once` });
    log(`Painting ${cp.missing.length} image${cp.missing.length > 1 ? "s" : ""} at the same time with ${painter.model} (${quality} quality${round > 1 ? `, round ${round}` : ""})`);
    const stop = new AbortController();
    const signal = AbortSignal.any([ctx.signal, stop.signal]);
    const painted = new Map<number, string>();
    const failed = new Set<number>();
    const tasks = cp.missing.map(async (i) => {
      try {
        painted.set(i, await painter.paint(imagePromptFor(deck, i), quality, signal));
      } catch (err) {
        if (signal.aborted) return; // out of time: the next round paints it again
        const e = err as AIError;
        // A temporary problem (rate limit, timeout, server error) gets another round; anything else is final.
        if (e instanceof AIError && e.retryable) return;
        failed.add(i);
        errors.push(e.message.slice(0, 300));
        warn(`Slide ${i + 1}: the image could not be painted (${e.message.slice(0, 300)}); the slide uses its colours`);
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Without a step deadline (one long run) every image is simply awaited; setTimeout(Infinity) would fire at once.
    if (stepped) await Promise.race([Promise.all(tasks), new Promise((r) => (timer = setTimeout(r, Math.max(0, ctx.deadline - 3_000 - Date.now()))))]);
    else await Promise.all(tasks);
    clearTimeout(timer);
    stop.abort();
    if (ctx.signal.aborted) throw new DOMException("cancelled", "AbortError");
    if (painted.size) log(`${painted.size} image${painted.size > 1 ? "s" : ""} ready`);
    deck = withImages(deck, painted);
    const waiting = cp.missing.filter((i) => !painted.has(i) && !failed.has(i));
    cp = { ...cp, deck, missing: waiting, imageRounds: round, imageErrors: errors.slice(0, 10) };
    progressed = true;
    if (waiting.length) {
      if (round < MAX_IMAGE_ROUNDS) {
        log(`${waiting.length} image${waiting.length > 1 ? "s" : ""} not finished in time; painting ${waiting.length > 1 ? "them" : "it"} again in the next step`);
        return pause(cp);
      }
      warn(`${waiting.length} image${waiting.length > 1 ? "s" : ""} took too long; those slides use their colours`);
      cp = { ...cp, missing: [], imageErrors: [...(cp.imageErrors ?? []), "the image took too long"] };
    }
    const count = deck.slides.filter((s) => s.cine?.image).length;
    ctx.emit({ type: "stage", stage: "images", state: count ? "done" : "failed", detail: `${count} painted` });
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
  const wanted = deck.slides.filter((s) => s.cine?.imagePrompt).length;
  const imageNote = images < wanted && cp.imageErrors?.length ? ` ${wanted - images} image${wanted - images > 1 ? "s" : ""} could not be made: ${cp.imageErrors[0]}` : "";
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
          content: (buildStatus === "failed" ? `${summary} The preview could not be built: ${formatDiagnostic(build.errors[0])}` : summary) + imageNote,
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
