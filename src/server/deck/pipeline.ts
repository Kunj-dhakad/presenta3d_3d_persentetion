import "server-only";
import { db } from "@/server/db/client";
import type { Prisma } from "@/generated/mysql-prisma/client";
import type { JobContext } from "@/server/jobs/runner";
import { AIError, type TextModelProvider } from "@/server/ai/types";
import { randomInt } from "node:crypto";
import { DeckSpecSchema, ENVIRONMENTS, ENVIRONMENT_HINTS, diversifyDeck, validateDeck, type DeckSpec } from "@/lib/schemas/deck";
import { SCENE_PRESETS, presetCatalog } from "@/lib/deck-presets";
import { diffStats, toFileMap } from "@/lib/vfs/apply";
import { getFiles, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { formatDiagnostic } from "@/lib/build-types";
import { storage } from "@/server/storage/storage";
import { deckToProjectFiles } from "./codegen";
import { SceneWriter, asSceneSlide, completedSlides, deckForPrompt, reuseScenes, withScenes } from "./scene-code";
import type { PipelineInput, PipelineResult } from "@/server/pipeline/generate";

export const DECK_SYSTEM = `You are the presentation designer of 3D Presentation. You create cinematic 3D presentations.
You do not write code. You write a DeckSpec: the content and art direction of each slide. A fixed three.js engine renders it with animated 3D scenes, glow and smooth transitions.

Write a strong story: an opening hero slide, a clear arc, and a closing slide. Use 5-10 slides unless the user asks otherwise.
Content rules: titles at most ~8 words; at most 4 bullets per slide, each at most ~12 words; real, specific copy (no lorem ipsum, no placeholders). Write in the language the user writes in.
Layouts: "hero" for the opening (and optionally the closing), "left"/"right" for explanatory slides (alternate them), "center" for a single big statement, "stats" for 2-4 headline numbers.
Each slide gets its own 3D scene: set scene.preset to the preset from this catalog (name: tags) whose tags best express that slide's specific idea:
${presetCatalog()}
Use a different preset on every slide; never repeat one within a deck, and vary shapes and arrangements from slide to slide. Use "bar-chart" (with 3-8 numbers in scene.values) for slides about numbers.
theme.environment is the world the camera travels through:
${ENVIRONMENTS.map((e) => `- ${e}: ${ENVIRONMENT_HINTS[e]}`).join("\n")}
theme.transition: always "side".
Art direction: a dark theme.background (near black, tinted toward the palette), light theme.text, one vivid theme.accent. Pick scene.primary/secondary colours that harmonise with the accent; keep the palette consistent across the deck.
Every deck must feel designed for its own topic: derive the palette, environment, font and scenes from the subject, not from habit. Do not default to cyan/blue or the grid environment.
Names: use the names the user gives. If you must invent a product or company name, make it specific to the topic; avoid generic names like "Pulse", "Nova", "Nexus", "Aura" or "Vertex".
scene.speed 0.6-1.4 and scene.density 0.4-0.9 are good defaults. Colors are #rrggbb.`;

const PALETTES = [
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

/**
 * A random art-direction starting point for a new deck. The model adapts it
 * to the topic; it exists so that two decks never come out looking the same.
 */
export function designBrief(): string {
  const pick = <T,>(xs: readonly T[]) => xs[randomInt(xs.length)];
  const scenes = SCENE_PRESETS.filter((p) => p.kind !== "bars")
    .map((p) => ({ name: p.name, r: randomInt(100000) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, 4)
    .map((x) => x.name);
  return [
    "Design brief for this deck (a fresh starting point; adapt anything that clashes with the topic):",
    `- palette idea: ${pick(PALETTES)}`,
    `- environment idea: ${pick(ENVIRONMENTS)}`,
    `- consider opening with one of these presets if it fits: ${scenes.join(", ")}`,
  ].join("\n");
}

export const DECK_EDIT_RULES = `You are editing an existing deck. Return the COMPLETE updated deck.
Apply exactly what the user asks; keep every other slide, word and setting unchanged. If the user refers to a slide by number, slides are numbered from 1.
Exception: if the user asks for a presentation about a different topic (a new deck, not a change to this one), replace the whole deck: write a new story and a new design for the new topic, with a different palette, environment, font and scenes from the current deck (see the design brief). Do not keep the old colours or world.`;

function currentDeck(files: Map<string, string>): DeckSpec | null {
  const raw = files.get("deck.json");
  if (!raw) return null;
  try {
    const v = validateDeck(JSON.parse(raw));
    return v.ok ? v.deck : null;
  } catch {
    return null;
  }
}

async function conversation(conversationId: string) {
  const msgs = await db.chatMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 9, select: { role: true, content: true } });
  return msgs
    .slice(1)
    .reverse()
    .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
    .join("\n");
}

/** Run `fn`, and once more if it fails (e.g. a database connection dropped by the network). */
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 500));
    return fn();
  }
}

/**
 * Generate or edit a 3D presentation: the model writes a validated DeckSpec,
 * the deterministic engine turns it into a runnable project.
 */
export async function runDeckPipeline(ctx: JobContext, provider: TextModelProvider, input: PipelineInput): Promise<PipelineResult> {
  // Live log lines shown while the presentation is being made (and saved with the job).
  const t0 = Date.now();
  const log = (message: string) => ctx.emit({ type: "log", level: "info", message: `${((Date.now() - t0) / 1000).toFixed(1)}s · ${message}` });

  ctx.emit({ type: "stage", stage: "understand", state: "start" });
  log("Loading the project and conversation");
  // Independent reads run in parallel: each one is a network round trip to the database.
  const [project, fileList, history] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: input.projectId } }),
    getFiles(input.projectId),
    conversation(input.conversationId),
  ]);
  const files = toFileMap(fileList);
  const existing = currentDeck(files);
  if (existing) log(`Found the current deck (${existing.slides.length} slides); saving a restore point`);
  const pre = files.size ? await snapshot(input.projectId, "pre-ai", { summary: `Before: ${input.prompt.slice(0, 100)}`, files: fileList }) : null;

  ctx.emit({ type: "understanding", text: existing ? `Updating your presentation: ${input.prompt.slice(0, 160)}` : `Designing a 3D presentation: ${input.prompt.slice(0, 160)}` });
  ctx.emit({ type: "stage", stage: "understand", state: "done" });
  ctx.emit({ type: "stage", stage: "plan", state: "done", detail: existing ? `${existing.slides.length} slides` : "story, slides and 3D scenes" });
  ctx.emit({ type: "stage", stage: "generate", state: "start", detail: existing ? "Editing slides" : "Writing slides" });
  ctx.progress(0.1);

  // Custom 3D scenes are written in the background, starting as soon as each
  // slide's text is known, so they overlap with the rest of the deck being written.
  const writer = new SceneWriter(provider, {
    userId: input.userId,
    jobId: ctx.jobId,
    signal: ctx.signal,
    log: (m, level = "info") => (level === "info" ? log(m) : ctx.emit({ type: "log", level, message: m })),
  });
  let scanned = 0;
  const onText = existing
    ? undefined // edits reuse unchanged scenes; changed slides are known only once the edit is complete
    : (text: string) => {
        if (text.length - scanned < 120) return; // scan in steps, not on every token
        scanned = text.length;
        const { head, slides } = completedSlides(text);
        if (!head) return;
        slides.forEach((raw, i) => {
          if (writer.has(i)) return;
          const slide = asSceneSlide(raw);
          if (!slide) return;
          if (writer.started === 0) log(`Designing custom 3D scenes with ${provider.model} while the slides are written`);
          writer.start(head, slide, i);
        });
      };

  const brief = designBrief();
  const ask = async (extra: string) =>
    (
      await provider.structured({
        operation: existing ? "deck.edit" : "deck.generate",
        schema: DeckSpecSchema,
        schemaName: "deck_spec",
        system: existing ? `${DECK_SYSTEM}\n\n${DECK_EDIT_RULES}` : DECK_SYSTEM,
        input: [
          history ? `Conversation so far:\n${history}` : "",
          // Scene code is left out: it is large and the model does not need it to edit slides.
          existing ? `Current deck (JSON):\n${JSON.stringify(deckForPrompt(existing))}` : "",
          `User request:\n${input.prompt}`,
          // For edits the brief is used only if the request turns out to be a new topic (see DECK_EDIT_RULES).
          existing ? `${brief}\n(Use this brief only if you are replacing the deck with a new topic.)` : brief,
          extra,
        ]
          .filter(Boolean)
          .join("\n\n"),
        maxOutputTokens: 16_000,
        // Writing slide copy needs little deliberation; low effort roughly halves generation time.
        reasoningEffort: "low",
        signal: ctx.signal,
        userId: input.userId,
        jobId: ctx.jobId,
        onProgress: (chars) => ctx.emit({ type: "stream", taskId: "deck", chars }),
        onText,
      })
    ).data;

  log(`Asking ${provider.name} · ${provider.model} to ${existing ? "edit the slides" : "write the story and slides"}`);
  let raw: unknown;
  try {
    raw = await ask("");
  } catch (err) {
    if (err instanceof AIError && err.retryable && !ctx.signal.aborted) {
      ctx.emit({ type: "log", level: "warn", message: `${err.message}. Retrying once.` });
      raw = await ask("");
    } else throw err;
  }
  let v = validateDeck(raw);
  if (!v.ok) {
    ctx.emit({ type: "stage", stage: "repair", state: "start", detail: v.errors[0] });
    raw = await ask(`Your previous answer was invalid:\n${v.errors.join("\n")}\nReturn a corrected, complete deck.`);
    v = validateDeck(raw);
    if (!v.ok) throw new Error(`The presentation could not be generated: ${v.errors.slice(0, 3).join("; ")}`);
    ctx.emit({ type: "stage", stage: "repair", state: "done" });
  }
  // No two slides may look alike, whatever the model chose.
  const reused = reuseScenes(diversifyDeck(v.deck), existing);
  let deck = reused.deck;
  log(`Received “${deck.title}”: ${deck.slides.length} slides · ${deck.theme.environment} world · ${deck.theme.transition} transition · ${deck.theme.font} font`);
  ctx.emit({ type: "stage", stage: "generate", state: "done", detail: `${deck.slides.length} slides` });
  ctx.progress(0.4);

  // Scenes for slides not started while streaming (and changed slides of an edit).
  const info = { title: deck.title, theme: deck.theme, slideCount: deck.slides.length };
  if (reused.missing.some((i) => !writer.has(i)) && writer.started === 0) log(`Designing ${reused.missing.length} custom 3D scene${reused.missing.length > 1 ? "s" : ""} with ${provider.model}`);
  for (const i of reused.missing) writer.start(info, deck.slides[i], i);
  const scenesPending = writer.started > 0;

  const meta = {
    name: project.name === "Untitled project" || project.name === "Untitled presentation" ? deck.title.slice(0, 120) : project.name,
    description: deck.slides[0]?.subtitle.slice(0, 500) ?? "",
    category: "presentation",
    framework: "three",
  };
  const saveAndBuild = async (d: DeckSpec, first: boolean) => {
    const out = deckToProjectFiles(d);
    await writeFileSet(input.projectId, out, first ? meta : {});
    ctx.emit({ type: "stage", stage: "build", state: "start" });
    const b = await buildProject({ projectId: input.projectId, framework: "three", files: out });
    ctx.emit({ type: "build", status: b.status === "succeeded" ? "succeeded" : "failed", buildId: b.buildId, previewUrl: b.previewUrl, errors: b.errors, warnings: b.warnings, attempt: 0 });
    ctx.emit({ type: "stage", stage: "build", state: b.status === "succeeded" ? "done" : "failed", detail: b.status === "succeeded" ? "ready" : formatDiagnostic(b.errors[0]) });
    return { files: out, build: b };
  };

  // 1) Show the presentation right away (scenes still being written use their catalog scene).
  log(`Building the 3D presentation and uploading it to ${storage().driver === "s3" ? "S3" : "local storage"}`);
  // Slides whose custom scene is still being written show only the world until it arrives.
  const pendingDeck = { ...deck, slides: deck.slides.map((s, i) => (writer.has(i) ? { ...s, scene: { ...s.scene, pending: true } } : s)) };
  let { files: nextFiles, build } = await saveAndBuild(pendingDeck, true);
  log(build.status === "succeeded" ? (scenesPending ? "Preview is ready — custom 3D scenes are added as they finish" : "Preview is ready") : `Preview build failed: ${formatDiagnostic(build.errors[0])}`);
  ctx.progress(0.55);

  // 2) Swap in the custom scenes once they are written.
  if (scenesPending) {
    ctx.emit({ type: "stage", stage: "review", state: "start", detail: "one per slide" });
    const codes = await writer.results();
    ctx.emit({ type: "stage", stage: "review", state: "done", detail: `${codes.size + deck.slides.length - reused.missing.length}/${deck.slides.length} custom` });
    // Always rebuild: slides marked pending get their custom scene, or their catalog scene if writing it failed.
    {
      const withCustom = withScenes(deck, codes);
      log("Adding the custom 3D scenes to the presentation");
      try {
        ({ files: nextFiles, build } = await saveAndBuild(withCustom, false));
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        // A transient database error: try once more, the scenes are already written.
        ctx.emit({ type: "log", level: "warn", message: `Saving the scenes failed (${(err as Error).message.split("\n").find(Boolean)?.slice(0, 120)}); retrying` });
        ({ files: nextFiles, build } = await saveAndBuild(withCustom, false));
      }
      deck = withCustom;
    }
  }
  ctx.progress(0.9);

  // Changed files relative to before this request.
  const changed: { path: string; kind: "created" | "modified" | "deleted"; added: number; removed: number }[] = [];
  for (const f of nextFiles) {
    const before = files.get(f.path) ?? null;
    if (before === f.content) continue;
    const c = { path: f.path, kind: before === null ? ("created" as const) : ("modified" as const), ...diffStats(before, f.content) };
    changed.push(c);
    ctx.emit({ type: "file", ...c });
  }

  ctx.emit({ type: "stage", stage: "finalize", state: "start" });
  log("Saving a version and the chat reply");
  // Retried once: by now the presentation is built, a transient database error must not lose it.
  const post = changed.length ? await retryOnce(() => snapshot(input.projectId, "ai", { summary: `${deck.title} (${deck.slides.length} slides)`, files: nextFiles })) : null;
  if (post && build.status === "succeeded") await retryOnce(() => markWorkingVersion(input.projectId, post.id));
  const buildStatus = build.status === "succeeded" ? ("succeeded" as const) : ("failed" as const);
  const summary = existing
    ? `Updated “${deck.title}” — ${deck.slides.length} slides.`
    : `Created “${deck.title}” — ${deck.slides.length} slides with 3D scenes. Use the arrow keys or click to move through it.`;
  const [message] = await retryOnce(() => Promise.all([
    db.chatMessage.create({
      data: {
        conversationId: input.conversationId,
        role: "assistant",
        content: buildStatus === "failed" ? `${summary} The preview could not be built: ${formatDiagnostic(build.errors[0])}` : summary,
        meta: { jobId: ctx.jobId, changedFiles: changed, preVersionId: pre?.id ?? null, postVersionId: post?.id ?? null, buildStatus, buildId: build.buildId, slides: deck.slides.length } as Prisma.InputJsonValue,
      },
    }),
    db.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }),
  ]));
  const result: PipelineResult = {
    summary,
    changedFiles: changed.map((c) => c.path),
    preVersionId: pre?.id ?? null,
    postVersionId: post?.id ?? null,
    buildStatus,
    buildId: build.buildId,
    previewUrl: build.previewUrl,
    assistantMessageId: message.id,
  };
  ctx.emit({ type: "result", ...result });
  ctx.emit({ type: "stage", stage: "finalize", state: "done" });
  return result;
}
