import { z } from "zod";
import { api, HttpError, readJson } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { activeProjectJob } from "@/server/jobs/runner";
import { textProviderOrThrow } from "@/server/services/generation";
import { loadDeck, saveDeck } from "@/server/deck/store";
import { applyDeckCommand, DECK_COMMAND_SYSTEM, DeckCommandSchema, deckForCommand } from "@/lib/deck-commands";

const Body = z.object({
  text: z.string().trim().min(1, "Say or type what to change").max(500, "Keep commands under 500 characters"),
  // The slide the presenter is on (1-based), for "this slide".
  slide: z.number().int().min(1).max(200).nullable().optional(),
});

/**
 * Edit the presentation with a spoken or typed command (PRD 3), from the
 * editor's chat or while presenting (PHP's Present page, through PHP).
 * Simple changes (text size, colours, font, 3D world, auto-play, slide words)
 * are applied at once: rebuilt and saved as a version (preVersionId undoes it).
 * Others answer { applied: false, needsAi: true } for the chat's full AI edit.
 */
export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const project = await getOwnedProject(user.id, params.id);
    const body = await readJson(req, Body, 16 * 1024);
    if (await activeProjectJob(project.id)) throw new HttpError(409, "Wait until the presentation has finished generating.", "JOB_RUNNING");
    const deck = await loadDeck(project.id);
    const { data } = await textProviderOrThrow().structured({
      operation: "deck.command",
      schema: DeckCommandSchema,
      schemaName: "deck_command",
      system: DECK_COMMAND_SYSTEM,
      input: `Presentation:\n${deckForCommand(deck, body.slide ?? null)}\n\nCommand:\n${body.text}`,
      maxOutputTokens: 3000,
      reasoningEffort: "minimal",
      userId: user.id,
    });
    if (data.action !== "edit") return { applied: false, needsAi: data.action === "ai", reply: data.reply };
    const { deck: next, changed } = applyDeckCommand(deck, data);
    if (!changed.length) return { applied: false, needsAi: false, reply: data.reply || "Nothing to change." };
    const saved = await saveDeck(project.id, next, `Command: ${body.text.slice(0, 120)}`);
    if (saved.build.status !== "succeeded") throw new HttpError(500, "The change was saved, but the preview could not be rebuilt.", "BUILD_FAILED");
    return { applied: true, needsAi: false, reply: data.reply, changed, preVersionId: project.lastWorkingVersionId, build: saved.build };
  },
  { rateLimit: { bucket: "command", perMinute: 20 } },
);
