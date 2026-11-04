import "server-only";
import { HttpError } from "@/server/http/api";
import { getFiles, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { validateDeck, type DeckSpec } from "@/lib/schemas/deck";

/** A project's deck.json, validated. Errors are worded for the owner. */
export async function loadDeck(projectId: string): Promise<DeckSpec> {
  const raw = (await getFiles(projectId)).find((f) => f.path === "deck.json")?.content;
  if (!raw) throw new HttpError(409, "This presentation has no slides yet. Create it in the chat first.", "NO_DECK");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(409, "The presentation file is damaged. Regenerate it in the chat.", "BAD_DECK");
  }
  const v = validateDeck(parsed);
  if (!v.ok) throw new HttpError(409, "The presentation file is damaged. Regenerate it in the chat.", "BAD_DECK");
  return v.deck;
}

/**
 * Save a deck changed without the AI pipeline (Design panel, commands):
 * rewrite the presentation, rebuild it and save a version, so the change can
 * be undone from the version history like a chat edit.
 */
export async function saveDeck(projectId: string, changed: DeckSpec, summary: string) {
  const v = validateDeck(changed);
  if (!v.ok) throw new HttpError(400, v.errors[0] ?? "Invalid presentation", "VALIDATION");
  const deck = v.deck;
  const files = deckToProjectFiles(deck);
  await writeFileSet(projectId, files);
  const build = await buildProject({ projectId, framework: "three", files });
  if (build.status === "succeeded") {
    const version = await snapshot(projectId, "auto", { summary, files });
    await markWorkingVersion(projectId, version.id);
  }
  return { deck, build };
}
