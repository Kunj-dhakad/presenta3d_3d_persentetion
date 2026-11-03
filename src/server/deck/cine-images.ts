import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "@/server/env";
import { mediaProvider } from "@/server/media/providers";
import { storage } from "@/server/storage/storage";
import { AIError } from "@/server/ai/types";

/** The look every slide image shares (added to the slide's own prompt). */
const STYLE =
  "Cinematic film still, photorealistic, 16:9 widescreen, dramatic volumetric lighting, rich colour grade, deep shadows and dark edges, shallow depth of field, epic sense of scale. Absolutely no text, letters, numbers, captions, watermarks or logos. Keep the left third calmer and darker so a title can be read over it.";

type PainterOptions = {
  projectId: string;
  signal: AbortSignal;
  log: (message: string, level?: "info" | "warn") => void;
};

/** Which image provider paints slides: OpenAI, or the offline fixture in automated tests. */
function painterProvider() {
  return mediaProvider(env().AI_PROVIDER === "mock" ? "test-fixture" : "openai");
}

/** True when slide images can be painted (an image model is configured). */
export function canPaintImages(): boolean {
  const p = painterProvider();
  return Boolean(p && p.info().configured && p.info().kinds.includes("image"));
}

/**
 * Paints the images of a cinematic deck with OpenAI, ALL AT ONCE: every slide's
 * image is requested in parallel the moment the slides are known (no queue), so
 * a deck takes about as long as its slowest image. Each image is stored under
 * deckmedia/<projectId>/ and served by /deckmedia/… (see app/deckmedia).
 * A failed image leaves its slide on the deck's colours (the slide still works).
 */
export class ImagePainter {
  private tasks = new Map<number, Promise<string | null>>();
  private finished = new Map<number, string | null>();

  constructor(private opts: PainterOptions) {}

  has(index: number) {
    return this.tasks.has(index);
  }

  get started() {
    return this.tasks.size;
  }

  /** Start painting slide `index` (no-op if already started). */
  start(index: number, prompt: string) {
    if (this.tasks.has(index) || this.opts.signal.aborted) return;
    const task = this.paint(index, prompt).catch((err) => {
      if (!this.opts.signal.aborted) this.opts.log(`Slide ${index + 1}: the image could not be painted (${(err as Error).message.slice(0, 160)}); the slide uses its colours instead`, "warn");
      return null;
    });
    void task.then((url) => this.finished.set(index, url));
    this.tasks.set(index, task);
  }

  /** Images finished so far: their URL, or null when painting failed. */
  settled(): Map<number, string | null> {
    return new Map(this.finished);
  }

  /** Wait until every started image has finished, or until `deadline` (ms epoch). */
  async until(deadline: number): Promise<void> {
    const all = Promise.all(this.tasks.values()).then(() => {});
    if (deadline === Infinity) return all;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([all, new Promise<void>((r) => (timer = setTimeout(r, Math.max(0, deadline - Date.now()))))]);
    clearTimeout(timer);
    await new Promise((r) => setImmediate(r));
  }

  private async paint(index: number, prompt: string): Promise<string> {
    const provider = painterProvider();
    if (!provider) throw new Error("no image provider");
    const request = { kind: "image" as const, providerId: "openai", prompt: `${prompt.slice(0, 2600)}\n\n${STYLE}`, options: { aspect: "16:9" as const, quality: "medium" as const, format: "webp" as const } };
    const ctx = { signal: this.opts.signal, progress: () => {}, log: (m: string) => this.opts.log(m), setExternalId: () => {} };
    // Many images at once can hit the account's rate limit: wait a moment and try again (twice).
    let out;
    for (let attempt = 0; ; attempt++) {
      try {
        out = await provider.generate(request, ctx);
        break;
      } catch (err) {
        const retry = err instanceof AIError && err.retryable && attempt < 2 && !this.opts.signal.aborted;
        if (!retry) throw err;
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1) + Math.random() * 1500));
      }
    }
    const ext = out.ext === "jpg" || out.ext === "png" || out.ext === "webp" ? out.ext : "webp";
    const name = randomBytes(12).toString("base64url");
    await storage().put(`deckmedia/${this.opts.projectId}/${name}.${ext}`, out.data, out.mimeType);
    return `/deckmedia/${this.opts.projectId}/${name}.${ext}`;
  }
}
