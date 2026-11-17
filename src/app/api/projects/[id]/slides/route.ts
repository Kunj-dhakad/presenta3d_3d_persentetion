import { z } from "zod";
import { api, HttpError, readJson } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { activeProjectJob } from "@/server/jobs/runner";
import { loadDeck, saveDeck } from "@/server/deck/store";
import { SlideEditSchema, slidesView, withSlideEdit } from "@/server/deck/slide-edit";

type P = { id: string };

/** The slides' words (and cinematic pictures) for the Slide content panel. */
export const GET = api<P>(async ({ user, params }) => {
  await getOwnedProject(user.id, params.id);
  return slidesView(await loadDeck(params.id));
});

const Patch = z.object({
  /** The slide (0-based). */
  index: z.number().int().min(0).max(199),
  slide: SlideEditSchema,
});

/**
 * Change one slide's words and layout by hand (no AI): rebuilt and saved as a version, so the change
 * can be undone from the version history like a chat edit.
 */
export const PATCH = api<P>(
  async ({ req, user, params }) => {
    const project = await getOwnedProject(user.id, params.id);
    const body = await readJson(req, Patch, 64 * 1024);
    // A chat edit in progress would overwrite this change (or this one its result).
    if (await activeProjectJob(project.id)) throw new HttpError(409, "Wait until the presentation has finished generating.", "JOB_RUNNING");
    const deck = await loadDeck(project.id);
    const saved = await saveDeck(project.id, withSlideEdit(deck, body.index, body.slide), `Slide ${body.index + 1} edited`);
    if (saved.build.status !== "succeeded") throw new HttpError(500, "The change was saved, but the preview could not be rebuilt.", "BUILD_FAILED");
    return { ...slidesView(saved.deck), build: saved.build };
  },
  { rateLimit: { bucket: "build", perMinute: 30 } },
);
