import { api, readJson } from "@/server/http/api";
import { MediaRequestSchema } from "@/lib/media";
import { startMediaJob } from "@/server/services/media";

/** Start a media generation job (image, video, speech, sound effect, 3D model, material). */
export const POST = api(
  async ({ req, user }) => {
    const body = await readJson(req, MediaRequestSchema, 16 * 1024);
    const jobId = await startMediaJob(user.id, body);
    return { jobId };
  },
  { rateLimit: { bucket: "media", perMinute: 10 } },
);
