import { z } from "zod";
import { api, HttpError, readJson } from "@/server/http/api";
import { getFiles, getOwnedProject, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { activeProjectJob } from "@/server/jobs/runner";
import { buildProject } from "@/server/build/builder";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { ENVIRONMENTS, validateDeck, type DeckSpec } from "@/lib/schemas/deck";
import { applyDeckDesign, deckColors } from "@/lib/deck-design";

type P = { id: string };

async function loadDeck(projectId: string): Promise<DeckSpec> {
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

/** What the Design panel shows: the look and the owner's settings (no slide content). */
const view = (deck: DeckSpec) => ({ title: deck.title, theme: deck.theme, colors: deckColors(deck), settings: deck.settings, slideCount: deck.slides.length });

export const GET = api<P>(async ({ user, params }) => {
  await getOwnedProject(user.id, params.id);
  return { deck: view(await loadDeck(params.id)) };
});

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");
const Patch = z.object({
  design: z
    .object({
      environment: z.enum(ENVIRONMENTS),
      font: z.enum(["sans", "serif", "display", "mono"]),
      background: Hex,
      text: Hex,
      accent: Hex,
      primary: Hex,
      secondary: Hex,
    })
    .partial()
    .optional(),
  // Normalized (lengths, safe links) by validateDeck below.
  settings: z
    .object({
      thankYou: z.object({ enabled: z.boolean(), title: z.string().max(200), message: z.string().max(1000), buttons: z.array(z.object({ label: z.string().max(100), url: z.string().max(1000) })).max(10) }),
      footer: z.object({ enabled: z.boolean(), logoUrl: z.string().max(1000), name: z.string().max(200), link: z.string().max(1000) }),
      autoplay: z.object({ enabled: z.boolean(), seconds: z.number() }),
    })
    .optional(),
});

/**
 * Change the deck's look or settings by hand (no AI): rewrite the
 * presentation, rebuild it and save a version, so the change can be undone
 * from the version history like a chat edit.
 */
export const PATCH = api<P>(
  async ({ req, user, params }) => {
    const project = await getOwnedProject(user.id, params.id);
    const body = await readJson(req, Patch, 64 * 1024);
    // A chat edit in progress would overwrite this change (or this one its result).
    if (await activeProjectJob(project.id)) throw new HttpError(409, "Wait until the presentation has finished generating.", "JOB_RUNNING");
    let deck = await loadDeck(project.id);
    if (body.design) deck = applyDeckDesign(deck, body.design);
    if (body.settings) deck = { ...deck, settings: body.settings };
    const v = validateDeck(deck);
    if (!v.ok) throw new HttpError(400, v.errors[0] ?? "Invalid presentation", "VALIDATION");
    deck = v.deck;

    const files = deckToProjectFiles(deck);
    await writeFileSet(project.id, files);
    const build = await buildProject({ projectId: project.id, framework: "three", files });
    if (build.status === "succeeded") {
      const version = await snapshot(project.id, "auto", { summary: body.design ? "Design changed" : "Settings changed", files });
      await markWorkingVersion(project.id, version.id);
    }
    return { deck: view(deck), build };
  },
  { rateLimit: { bucket: "build", perMinute: 30 } },
);
