import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "@/server/env";
import { openaiClient, mapOpenAIError } from "@/server/ai/openai-provider";
import { mediaProvider } from "@/server/media/providers";
import { storage } from "@/server/storage/storage";

/** The look every slide image shares (added to the slide's own prompt). */
const STYLE =
  "Cinematic film still, photorealistic, 16:9 widescreen, dramatic volumetric lighting, rich colour grade, deep shadows and dark edges, shallow depth of field, epic sense of scale. Absolutely no text, letters, numbers, captions, watermarks or logos. Keep the left third calmer and darker so a title can be read over it.";

/** Image model when OPENAI_IMAGE_MODEL is not set (the image_generation tool's own default). */
export const DEFAULT_IMAGE_MODEL = "gpt-image-1";

/**
 * Models that may host the image_generation tool in background mode, tried in
 * order. Not every text model can (OPENAI_MODEL answered "does not exist" for
 * this kind of request), so a refused model is skipped and the one that works
 * is remembered for this server instance.
 */
function hostModels(): string[] {
  const e = env();
  return [...new Set([e.OPENAI_IMAGE_HOST_MODEL, "gpt-4.1-mini", "gpt-4.1", e.OPENAI_MODEL].filter((m): m is string => Boolean(m)))];
}
let workingHost: string | null = null;

/** OpenAI refused the host model (unknown, or not usable for this request), not the image. */
function refusedHostModel(err: unknown, host: string): boolean {
  const status = (err as { status?: number }).status;
  const message = String((err as Error)?.message ?? "");
  return (status === 400 || status === 404 || status === 403) && message.includes(host);
}

export type ImageCheck = { state: "pending" } | { state: "done"; url: string } | { state: "failed"; error: string };

/**
 * Paints the images of a cinematic deck with OpenAI.
 *
 * Every image is started at once with the Responses API in background mode
 * (the image_generation tool): starting one takes a second or two and returns
 * an id, and OpenAI keeps painting after the request ends. The deck job saves
 * the ids in its checkpoint and collects the finished images in this or a
 * later step, so an image that takes longer than a step (serverless requests
 * are cut off after a minute) is not lost or started again.
 *
 * Finished images are stored under deckmedia/<projectId>/ and served by
 * /deckmedia/… (see app/deckmedia). Automated tests (AI_PROVIDER=mock) use the
 * offline fixture instead, which finishes at once.
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

  /** Start painting one image; returns its job id. Throws with OpenAI's message when it is refused. */
  async start(prompt: string, signal: AbortSignal): Promise<string> {
    const input = `${prompt.slice(0, 2600)}\n\n${STYLE}`;
    if (this.mock) {
      const fixture = mediaProvider("test-fixture");
      if (!fixture) throw new Error("no test image provider");
      const out = await fixture.generate(
        { kind: "image", providerId: "test-fixture", prompt: input, options: {} },
        { signal, progress: () => {}, log: () => {}, setExternalId: () => {} },
      );
      return `fixture:${await this.store(out.data, out.ext, out.mimeType)}`;
    }
    const hosts = workingHost ? [workingHost, ...hostModels().filter((m) => m !== workingHost)] : hostModels();
    let last: unknown = null;
    for (const host of hosts) {
      try {
        const res = await openaiClient().responses.create(
          {
            model: host,
            input: `Create this image: ${input}`,
            tools: [{ type: "image_generation", model: this.model, size: "1536x1024", quality: "medium", output_format: "webp", output_compression: 85 }],
            tool_choice: { type: "image_generation" },
            background: true,
            store: true,
          },
          { signal },
        );
        workingHost = host;
        return res.id;
      } catch (err) {
        last = err;
        // Only a refused host model is worth another try; any other refusal (e.g. the image model) is final.
        if (!refusedHostModel(err, host)) break;
      }
    }
    throw mapOpenAIError(last);
  }

  /** Has this image finished? Stores it when it has. */
  async check(jobId: string, signal: AbortSignal): Promise<ImageCheck> {
    if (jobId.startsWith("fixture:")) return { state: "done", url: jobId.slice("fixture:".length) };
    let res;
    try {
      res = await openaiClient().responses.retrieve(jobId, {}, { signal });
    } catch (err) {
      const mapped = mapOpenAIError(err);
      // A network hiccup while checking: try again on the next check.
      return mapped.retryable ? { state: "pending" } : { state: "failed", error: mapped.message };
    }
    if (res.status === "queued" || res.status === "in_progress") return { state: "pending" };
    const call = res.output?.find((o) => o.type === "image_generation_call");
    const b64 = call && call.type === "image_generation_call" ? call.result : null;
    if (res.status === "completed" && b64) {
      const url = await this.store(new Uint8Array(Buffer.from(b64, "base64")), "webp", "image/webp");
      return { state: "done", url };
    }
    const reason = res.error?.message || res.incomplete_details?.reason || (res.status === "completed" ? "no image was returned" : res.status);
    return { state: "failed", error: String(reason).slice(0, 300) };
  }

  /** Stop images that are no longer wanted (best effort). */
  async cancel(jobIds: string[]) {
    if (this.mock) return;
    await Promise.all(jobIds.map((id) => openaiClient().responses.cancel(id).catch(() => {})));
  }

  private async store(data: Uint8Array, ext: string, mimeType: string): Promise<string> {
    const safeExt = ext === "jpg" || ext === "png" || ext === "webp" ? ext : "webp";
    const name = randomBytes(12).toString("base64url");
    await storage().put(`deckmedia/${this.projectId}/${name}.${safeExt}`, data, mimeType);
    return `/deckmedia/${this.projectId}/${name}.${safeExt}`;
  }
}
