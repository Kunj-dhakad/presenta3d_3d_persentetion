import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { createProject } from "@/server/services/projects";
import { startDeckGeneration, textProviderOrThrow } from "@/server/services/generation";
import { env } from "@/server/env";

const Body = z.object({
  prompt: z.string().trim().min(1, "Describe your presentation").max(8000, "Keep requests under 8,000 characters"),
});

/**
 * Create a presentation and queue its generation in one request, so the
 * user lands in the workspace with progress already running (each separate
 * request would be another round trip to the database).
 */
export const POST = api(
  async ({ req, user }) => {
    const provider = textProviderOrThrow();
    const body = await readJson(req, Body, 64 * 1024);
    const project = await createProject(user.id, { name: "Untitled presentation", category: "presentation", framework: "three" });
    const started = await startDeckGeneration({ userId: user.id, projectId: project.id, provider, request: { prompt: body.prompt, mode: "auto" }, isNew: true });
    return { projectId: project.id, ...started };
  },
  { rateLimit: { bucket: "generate", perMinute: () => env().GENERATION_RATE_LIMIT_PER_MIN } },
);
