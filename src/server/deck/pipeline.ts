import "server-only";
import { db } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import type { JobContext } from "@/server/jobs/runner";
import { AIError, type TextModelProvider } from "@/server/ai/types";
import { DeckSpecSchema, SCENE_KINDS, SCENE_KIND_HINTS, validateDeck, type DeckSpec } from "@/lib/schemas/deck";
import { diffStats, toFileMap } from "@/lib/vfs/apply";
import { getFiles, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { formatDiagnostic } from "@/lib/build-types";
import { deckToProjectFiles } from "./codegen";
import type { PipelineInput, PipelineResult } from "@/server/pipeline/generate";

export const DECK_SYSTEM = `You are the presentation designer of Strata. You create cinematic 3D presentations.
You do not write code. You write a DeckSpec: the content and art direction of each slide. A fixed three.js engine renders it with animated 3D scenes, glow and smooth transitions.

Write a strong story: an opening hero slide, a clear arc, and a closing slide. Use 5-10 slides unless the user asks otherwise.
Content rules: titles at most ~8 words; at most 4 bullets per slide, each at most ~12 words; real, specific copy (no lorem ipsum, no placeholders). Write in the language the user writes in.
Layouts: "hero" for the opening (and optionally the closing), "left"/"right" for explanatory slides (alternate them), "center" for a single big statement, "stats" for 2-4 headline numbers.
Each slide picks a 3D scene that matches its meaning:
${SCENE_KINDS.map((k) => `- ${k}: ${SCENE_KIND_HINTS[k]}`).join("\n")}
Vary the scenes; avoid repeating the same kind on consecutive slides. For "bars", put 3-8 numbers in scene.values.
Art direction: a dark theme.background (near black, slightly tinted), light theme.text, one vivid theme.accent. Pick scene.primary/secondary colours that harmonise with the accent; keep the palette consistent across the deck.
scene.speed 0.6-1.4 and scene.density 0.4-0.9 are good defaults. Colors are #rrggbb.`;

export const DECK_EDIT_RULES = `You are editing an existing deck. Return the COMPLETE updated deck.
Apply exactly what the user asks; keep every other slide, word and setting unchanged. If the user refers to a slide by number, slides are numbered from 1.`;

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

/**
 * Generate or edit a 3D presentation: the model writes a validated DeckSpec,
 * the deterministic engine turns it into a runnable project.
 */
export async function runDeckPipeline(ctx: JobContext, provider: TextModelProvider, input: PipelineInput): Promise<PipelineResult> {
  const project = await db.project.findUniqueOrThrow({ where: { id: input.projectId } });
  const files = toFileMap(await getFiles(input.projectId));
  const existing = currentDeck(files);
  const history = await conversation(input.conversationId);
  const pre = files.size ? await snapshot(input.projectId, "pre-ai", { summary: `Before: ${input.prompt.slice(0, 100)}` }) : null;

  ctx.emit({ type: "stage", stage: "understand", state: "start" });
  ctx.emit({ type: "understanding", text: existing ? `Updating your presentation: ${input.prompt.slice(0, 160)}` : `Designing a 3D presentation: ${input.prompt.slice(0, 160)}` });
  ctx.emit({ type: "stage", stage: "understand", state: "done" });
  ctx.emit({ type: "stage", stage: "plan", state: "done", detail: existing ? `${existing.slides.length} slides` : "story, slides and 3D scenes" });
  ctx.emit({ type: "stage", stage: "generate", state: "start", detail: existing ? "Editing slides" : "Writing slides" });
  ctx.progress(0.1);

  const ask = async (extra: string) =>
    (
      await provider.structured({
        operation: existing ? "deck.edit" : "deck.generate",
        schema: DeckSpecSchema,
        schemaName: "deck_spec",
        system: existing ? `${DECK_SYSTEM}\n\n${DECK_EDIT_RULES}` : DECK_SYSTEM,
        input: [
          history ? `Conversation so far:\n${history}` : "",
          existing ? `Current deck (JSON):\n${JSON.stringify(existing)}` : "",
          `User request:\n${input.prompt}`,
          extra,
        ]
          .filter(Boolean)
          .join("\n\n"),
        maxOutputTokens: 16_000,
        signal: ctx.signal,
        userId: input.userId,
        jobId: ctx.jobId,
        onProgress: (chars) => ctx.emit({ type: "stream", taskId: "deck", chars }),
      })
    ).data;

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
  const deck = v.deck;
  ctx.emit({ type: "stage", stage: "generate", state: "done", detail: `${deck.slides.length} slides` });
  ctx.progress(0.7);

  // Write the project (deck.json + engine) and report changed files.
  const nextFiles = deckToProjectFiles(deck);
  const changed: { path: string; kind: "created" | "modified" | "deleted"; added: number; removed: number }[] = [];
  for (const f of nextFiles) {
    const before = files.get(f.path) ?? null;
    if (before === f.content) continue;
    const c = { path: f.path, kind: before === null ? ("created" as const) : ("modified" as const), ...diffStats(before, f.content) };
    changed.push(c);
    ctx.emit({ type: "file", ...c });
  }
  await writeFileSet(input.projectId, nextFiles);
  await db.project.update({
    where: { id: input.projectId },
    data: {
      name: project.name === "Untitled project" || project.name === "Untitled presentation" ? deck.title.slice(0, 120) : project.name,
      description: deck.slides[0]?.subtitle.slice(0, 500) ?? "",
      category: "presentation",
      framework: "three",
    },
  });

  ctx.emit({ type: "stage", stage: "build", state: "start" });
  const build = await buildProject({ projectId: input.projectId, framework: "three", files: nextFiles });
  ctx.emit({ type: "build", status: build.status === "succeeded" ? "succeeded" : "failed", buildId: build.buildId, previewUrl: build.previewUrl, errors: build.errors, warnings: build.warnings, attempt: 0 });
  ctx.emit({ type: "stage", stage: "build", state: build.status === "succeeded" ? "done" : "failed", detail: build.status === "succeeded" ? `${build.durationMs} ms` : formatDiagnostic(build.errors[0]) });

  ctx.emit({ type: "stage", stage: "finalize", state: "start" });
  const post = changed.length ? await snapshot(input.projectId, "ai", { summary: `${deck.title} (${deck.slides.length} slides)` }) : null;
  if (post && build.status === "succeeded") await markWorkingVersion(input.projectId, post.id);
  const buildStatus = build.status === "succeeded" ? ("succeeded" as const) : ("failed" as const);
  const summary = existing
    ? `Updated “${deck.title}” — ${deck.slides.length} slides.`
    : `Created “${deck.title}” — ${deck.slides.length} slides with 3D scenes. Use the arrow keys or click to move through it.`;
  const message = await db.chatMessage.create({
    data: {
      conversationId: input.conversationId,
      role: "assistant",
      content: buildStatus === "failed" ? `${summary} The preview could not be built: ${formatDiagnostic(build.errors[0])}` : summary,
      meta: { jobId: ctx.jobId, changedFiles: changed, preVersionId: pre?.id ?? null, postVersionId: post?.id ?? null, buildStatus, buildId: build.buildId, slides: deck.slides.length } as Prisma.InputJsonValue,
    },
  });
  await db.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
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
