import { z } from "zod";
import { api, HttpError, readJson } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { activeProjectJob } from "@/server/jobs/runner";
import { textProviderOrThrow } from "@/server/services/generation";
import { loadDeck, saveDeck } from "@/server/deck/store";
import { applyDeckCommand, DECK_COMMAND_SYSTEM, DeckCommandSchema, deckForCommand } from "@/lib/deck-commands";
import { presetCatalog } from "@/lib/deck-presets";
import { cinePicturePrompt } from "@/lib/schemas/cine";
import { ImagePainter } from "@/server/deck/cine-images";

const Body = z.object({
  text: z.string().trim().min(1, "Say or type what to change").max(500, "Keep commands under 500 characters"),
  // The slide the presenter is on (1-based), for "this slide".
  slide: z.number().int().min(1).max(200).nullable().optional(),
  /** The model chosen in the chat's dropdown (lib/ai-models.ts); missing: OPENAI_MODEL. */
  model: z.string().max(60).optional(),
});

/**
 * Edit the presentation with a spoken or typed command (PRD 3), from the
 * editor's chat or while presenting (PHP's Present page, through PHP).
 * Simple changes (text size, colours, font, 3D world, auto-play, slide words,
 * a slide's 3D scene or a new cinematic picture, painted here) are applied at
 * once: rebuilt and saved as a version (preVersionId undoes it).
 * Others answer { applied: false, needsAi: true } for the chat's full AI edit.
 */
export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const project = await getOwnedProject(user.id, params.id);
    const body = await readJson(req, Body, 16 * 1024);
    if (await activeProjectJob(project.id)) throw new HttpError(409, "Wait until the presentation has finished generating.", "JOB_RUNNING");
    const deck = await loadDeck(project.id);
    const { data } = await textProviderOrThrow(body.model).structured({
      operation: "deck.command",
      schema: DeckCommandSchema,
      schemaName: "deck_command",
      system: DECK_COMMAND_SYSTEM,
      input:
        `Presentation:\n${deckForCommand(deck, body.slide ?? null)}\n\n` +
        // 3D decks: the scenes a slide may get ("name: tags").
        (deck.style === "cinematic" ? "" : `Scene catalog:\n${presetCatalog()}\n\n`) +
        `Command:\n${body.text}`,
      maxOutputTokens: 3000,
      reasoningEffort: "minimal",
      userId: user.id,
    });
    if (data.action !== "edit") return { applied: false, needsAi: data.action === "ai", reply: data.reply };
    const { deck: next, changed, pictures } = applyDeckCommand(deck, data);
    if (!changed.length) return { applied: false, needsAi: false, reply: data.reply || "Nothing to change." };
    // New cinematic pictures, painted now (the slide's image prompt stays: an AI edit that keeps the slide's words keeps the picture).
    let reply = data.reply;
    if (pictures.length) {
      const painter = new ImagePainter(project.id);
      const signal = AbortSignal.timeout(90_000); // PHP waits 140 s for the whole command
      const painted = await Promise.allSettled(pictures.map((p) => painter.paint(cinePicturePrompt(next, p.slide, p.subject), "medium", signal)));
      let failed = 0;
      painted.forEach((r, k) => {
        const i = pictures[k].slide;
        if (r.status === "fulfilled") next.slides[i] = { ...next.slides[i], cine: { ...next.slides[i].cine!, image: r.value } };
        else {
          failed++;
          console.warn(`[command] picture for slide ${i + 1} of ${project.id} failed: ${String(r.reason)}`);
        }
      });
      if (failed === pictures.length && changed.length === pictures.length) throw new HttpError(502, "The new picture could not be made. Please try again.", "PICTURE_FAILED");
      if (failed) reply = `${reply} (${failed === 1 ? "one picture" : "the pictures"} could not be made)`;
    }
    const saved = await saveDeck(project.id, next, `Command: ${body.text.slice(0, 120)}`);
    if (saved.build.status !== "succeeded") throw new HttpError(500, "The change was saved, but the preview could not be rebuilt.", "BUILD_FAILED");
    return { applied: true, needsAi: false, reply, changed, preVersionId: project.lastWorkingVersionId, build: saved.build };
  },
  { rateLimit: { bucket: "command", perMinute: 20 } },
);
