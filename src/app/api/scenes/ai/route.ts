import { z } from "zod";
import { api, HttpError, readJson } from "@/server/http/api";
import { startSceneJob } from "@/server/services/ai-tasks";
import { validateScene } from "@/lib/schemas/scene";
import { AIError } from "@/server/ai/types";
import { env } from "@/server/env";

const Body = z.object({ prompt: z.string().trim().min(3).max(4000), current: z.unknown().nullable().default(null) });

/** Generate a new scene, or edit the provided one, with the AI 3D specialist. */
export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(req, Body, 2 * 1024 * 1024);
    let current = null;
    if (body.current) {
      const v = validateScene(body.current);
      if (!v.ok) throw new HttpError(400, `Current scene is invalid: ${v.errors[0]}`, "INVALID_SCENE");
      current = v.scene;
    }
    try {
      const jobId = await startSceneJob(user.id, { prompt: body.prompt, current });
      return { jobId };
    } catch (err) {
      if (err instanceof AIError && err.code === "NOT_CONFIGURED") throw new HttpError(503, err.message, "AI_NOT_CONFIGURED");
      throw err;
    }
  },
  { rateLimit: { bucket: "generate", perMinute: () => env().GENERATION_RATE_LIMIT_PER_MIN } },
);
