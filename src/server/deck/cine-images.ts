import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "@/server/env";
import { openaiClient, mapOpenAIError } from "@/server/ai/openai-provider";
import { mediaProvider } from "@/server/media/providers";
import { storage } from "@/server/storage/storage";

/** Image model when OPENAI_IMAGE_MODEL is not set: the one the image-led editor (research/3dppt) uses. */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";

export type ImageQuality = "low" | "medium" | "high";

/**
 * Paints cinematic slide images with OpenAI's Images API (images.generate),
 * the same call the image-led editor uses on this account; no text model is
 * involved. The deck job starts every image at once and waits for them within
 * a job step (see cine-pipeline.ts). Finished images are stored under
 * deckmedia/<projectId>/ and served by /deckmedia/… (see app/deckmedia).
 * Automated tests (AI_PROVIDER=mock) use the offline fixture.
 */
export class ImagePainter {
  constructor(private projectId: string) {}

  private get mock() {
    return env().AI_PROVIDER === "mock";
  }

  /** The image model used (shown in the live log). */
  get model(): string {
    return this.mock ? "test fixture" : env().OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  }

  /**
   * Slides are 16:9. gpt-image-2 paints any size: 1280×720 is the real shape
   * (nothing cropped) and quick (measured: medium ≈ 25-30 s even 4 at once,
   * low ≈ 11 s). Older models only paint fixed sizes; 3:2 is the nearest.
   */
  get size(): "1280x720" | "1536x1024" {
    return /^gpt-image-2/.test(this.model) ? "1280x720" : "1536x1024";
  }

  /**
   * Paint one image from its full prompt (subject, deck style and composition:
   * lib/schemas/cine.ts imagePromptFor) and store it; returns its address.
   * Throws an AIError with OpenAI's message.
   */
  async paint(prompt: string, quality: ImageQuality, signal: AbortSignal): Promise<string> {
    const input = prompt.slice(0, 3800);
    if (this.mock) {
      const fixture = mediaProvider("test-fixture");
      if (!fixture) throw new Error("no test image provider");
      const out = await fixture.generate(
        { kind: "image", providerId: "test-fixture", prompt: input, options: {} },
        { signal, progress: () => {}, log: () => {}, setExternalId: () => {} },
      );
      return this.store(out.data, out.ext, out.mimeType);
    }
    let b64: string | undefined;
    try {
      const res = await openaiClient().images.generate(
        { model: this.model, prompt: input, size: this.size, quality, output_format: "webp", output_compression: 85, n: 1 },
        // One attempt per image: the job retries unfinished images in its next step. Its own
        // timeout, so a short OPENAI_TIMEOUT_MS on the server cannot cut an image off.
        { signal, maxRetries: 0, timeout: 120_000 },
      );
      b64 = res.data?.[0]?.b64_json;
    } catch (err) {
      throw mapOpenAIError(err);
    }
    if (!b64) throw new Error("OpenAI returned no image");
    return this.store(new Uint8Array(Buffer.from(b64, "base64")), "webp", "image/webp");
  }

  private async store(data: Uint8Array, ext: string, mimeType: string): Promise<string> {
    const safeExt = ext === "jpg" || ext === "png" || ext === "webp" ? ext : "webp";
    const name = randomBytes(12).toString("base64url");
    await storage().put(`deckmedia/${this.projectId}/${name}.${safeExt}`, data, mimeType);
    return `/deckmedia/${this.projectId}/${name}.${safeExt}`;
  }
}
