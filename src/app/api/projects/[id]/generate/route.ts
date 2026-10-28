import { z } from "zod";
import { api, HttpError, readJson } from "@/server/http/api";
import { getOwnedProject } from "@/server/services/projects";
import { activeProjectJob } from "@/server/jobs/runner";
// Presentation mode: chat generates 3D presentations (DeckSpec → presentation engine,
// run by @/server/jobs/deferred). The general code-generation pipeline
// (`runProjectPipeline` in @/server/pipeline/generate) is kept but not wired to the UI.
import { startDeckGeneration, textProviderOrThrow } from "@/server/services/generation";
import { env } from "@/server/env";

const GenerateBody = z.object({
  prompt: z.string().trim().min(1, "Describe what you want to build").max(8000, "Keep requests under 8,000 characters"),
  conversationId: z.string().max(40).nullable().optional(),
  mode: z.enum(["auto", "repair"]).default("auto"),
  runtimeErrors: z.array(z.string().max(2000)).max(20).optional(),
});

/**
 * Start a generation job for a project (create, edit, or repair). Returns
 * immediately with a job id; the client runs it with /api/jobs/[id]/run and
 * follows progress with /api/jobs/[id]/poll.
 */
export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    const provider = textProviderOrThrow();
    const [project, body] = await Promise.all([getOwnedProject(user.id, params.id), readJson(req, GenerateBody, 64 * 1024)]);
    // The client follows the running job in the chat (details.jobId) instead of starting a second one.
    const running = await activeProjectJob(project.id);
    if (running) throw new HttpError(409, "A generation is already running for this project", "JOB_RUNNING", { jobId: running.id });
    return startDeckGeneration({ userId: user.id, projectId: project.id, provider, request: body });
  },
  { rateLimit: { bucket: "generate", perMinute: () => env().GENERATION_RATE_LIMIT_PER_MIN } },
);
