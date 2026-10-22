import { z } from "zod";
import { api, HttpError, readJson } from "@/server/http/api";
import { getOwnedCanvas } from "@/server/services/canvas";
import { startCanvasJob } from "@/server/services/ai-tasks";
import { AIError } from "@/server/ai/types";
import { env } from "@/server/env";

const Body = z.object({
  instruction: z.string().trim().min(3).max(4000),
  frames: z
    .array(
      z.object({
        id: z.string().max(64),
        name: z.string().max(120),
        w: z.number().min(40).max(8000),
        h: z.number().min(40).max(8000),
        existing: z.string().max(8000),
      }),
    )
    .min(1, "Select at least one frame")
    .max(12, "Select at most 12 frames at a time"),
});

/** Generate content for the selected frames; each frame is an independent, concurrently executed task. */
export const POST = api<{ id: string }>(
  async ({ req, user, params }) => {
    await getOwnedCanvas(user.id, params.id);
    const body = await readJson(req, Body, 256 * 1024);
    try {
      const jobId = await startCanvasJob(user.id, { canvasId: params.id, instruction: body.instruction, frames: body.frames });
      return { jobId };
    } catch (err) {
      if (err instanceof AIError && err.code === "NOT_CONFIGURED") throw new HttpError(503, err.message, "AI_NOT_CONFIGURED");
      throw err;
    }
  },
  { rateLimit: { bucket: "generate", perMinute: () => env().GENERATION_RATE_LIMIT_PER_MIN } },
);
