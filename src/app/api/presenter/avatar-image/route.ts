import { z } from "zod";
import { api, readJson, HttpError } from "@/server/http/api";
import { env } from "@/server/env";
import { openaiClient, mapOpenAIError } from "@/server/ai/openai-provider";
import { mediaProvider } from "@/server/media/providers";
import { DEFAULT_IMAGE_MODEL } from "@/server/deck/cine-images";

const Body = z.object({
  description: z.string().trim().min(3, "Describe your presenter").max(500, "Keep the description under 500 characters"),
});

/** A medium-quality portrait takes about 20-30 s. */
export const maxDuration = 60;

/**
 * The portrait a talking avatar needs (DupDub animates one face): looking into
 * the camera, the whole face visible and nothing covering the mouth.
 */
function avatarPrompt(description: string): string {
  return [
    `Professional head-and-shoulders portrait photograph of a presenter: ${description}.`,
    "Looking straight into the camera with a friendly, natural expression, mouth closed, the whole face visible and centred.",
    "Soft even studio lighting, a plain softly blurred background, sharp focus on the face. Photorealistic. Exactly one person.",
    "No text, logos or watermarks; no sunglasses, hands, microphones or objects in front of the face.",
  ].join(" ");
}

/**
 * POST /api/presenter/avatar-image { description } → { image: data URL }:
 * an AI portrait for the Presenter panel's "Create with AI". The panel then
 * stores it in the business's avatar library through the PHP app
 * (3d-view/settings action avatar_upload), like an uploaded photo.
 */
export const POST = api(
  async ({ req }) => {
    const { description } = await readJson(req, Body, 8 * 1024);
    const prompt = avatarPrompt(description);
    if (env().AI_PROVIDER === "mock") {
      const fixture = mediaProvider("test-fixture");
      if (!fixture) throw new HttpError(500, "No test image provider", "AI_ERROR");
      const out = await fixture.generate({ kind: "image", providerId: "test-fixture", prompt, options: {} }, { signal: req.signal, progress: () => {}, log: () => {}, setExternalId: () => {} });
      return { image: `data:${out.mimeType};base64,${Buffer.from(out.data).toString("base64")}` };
    }
    let b64: string | undefined;
    try {
      const res = await openaiClient().images.generate(
        { model: env().OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL, prompt, size: "1024x1024", quality: "medium", output_format: "jpeg", output_compression: 90, n: 1 },
        { signal: req.signal, maxRetries: 0, timeout: 55_000 },
      );
      b64 = res.data?.[0]?.b64_json;
    } catch (err) {
      throw new HttpError(502, mapOpenAIError(err).message, "AI_ERROR");
    }
    if (!b64) throw new HttpError(502, "The AI returned no picture. Please try again.", "AI_ERROR");
    return { image: `data:image/jpeg;base64,${b64}` };
  },
  { rateLimit: { bucket: "avatar-image", perMinute: 4 } },
);
