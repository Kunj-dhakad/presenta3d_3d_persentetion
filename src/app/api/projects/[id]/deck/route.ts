import { z } from "zod";
import { api, HttpError, readJson } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { activeProjectJob } from "@/server/jobs/runner";
import { loadDeck, saveDeck } from "@/server/deck/store";
import { ENVIRONMENTS, type DeckSpec } from "@/lib/schemas/deck";
import { applyDeckDesign, deckColors } from "@/lib/deck-design";

type P = { id: string };

/** What the Design panel shows: the look and the owner's settings (no slide content). */
const view = (deck: DeckSpec) => ({ title: deck.title, style: deck.style ?? "3d", theme: deck.theme, colors: deckColors(deck), settings: deck.settings, slideCount: deck.slides.length });

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
      textScale: z.number().optional(),
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
    // Merged: a client that does not know a setting (textScale, set by commands) keeps it.
    if (body.settings) deck = { ...deck, settings: { ...deck.settings, ...body.settings, textScale: body.settings.textScale ?? deck.settings.textScale } };
    const saved = await saveDeck(project.id, deck, body.design ? "Design changed" : "Settings changed");
    return { deck: view(saved.deck), build: saved.build };
  },
  { rateLimit: { bucket: "build", perMinute: 30 } },
);
