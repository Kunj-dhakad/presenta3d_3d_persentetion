import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { createProject } from "@/server/services/projects";
import { startDeckGeneration, textProviderOrThrow } from "@/server/services/generation";
import { aiDraftTitle } from "@/server/deck/draft-title";
import { env } from "@/server/env";

const Body = z.object({
  prompt: z.string().trim().min(1, "Describe your presentation").max(8000, "Keep requests under 8,000 characters"),
  /** Shown while the slides are written (e.g. a file name); without it the AI writes a short title. The deck title replaces it. */
  name: z.string().trim().max(120).optional(),
  /** "cinematic": AI images and trailer-style titles instead of 3D scenes (see server/deck/cine-pipeline.ts). */
  style: z.enum(["3d", "cinematic"]).optional(),
  /** The AI model to write it with (lib/ai-models.ts); missing: OPENAI_MODEL. */
  model: z.string().max(60).optional(),
});

/**
 * Create a presentation and queue its generation in one request, so the
 * user lands in the workspace with progress already running (each separate
 * request would be another round trip to the database).
 */
export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(req, Body, 64 * 1024);
    const provider = textProviderOrThrow(body.model);
    // A short, professional title written by the AI (not the user's prompt itself); the deck title replaces it later.
    const draftName = body.name || (await aiDraftTitle(provider, body.prompt, user.id));
    const project = await createProject(user.id, { name: draftName, category: "presentation", framework: body.style === "cinematic" ? "cinematic" : "three" });
    const started = await startDeckGeneration({ userId: user.id, projectId: project.id, provider, request: { prompt: body.prompt, mode: "auto", draftName }, isNew: true });
    return { projectId: project.id, ...started };
  },
  { rateLimit: { bucket: "generate", perMinute: () => env().GENERATION_RATE_LIMIT_PER_MIN } },
);
