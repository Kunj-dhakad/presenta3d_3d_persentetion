import "server-only";
import { env } from "@/server/env";
import { openaiClient, mapOpenAIError } from "@/server/ai/openai-provider";
import { AIError } from "@/server/ai/types";
import type { MediaKind, MediaProviderInfo, MediaRequest } from "@/lib/media";

export type MediaOutput = { data: Uint8Array; mimeType: string; ext: string; metadata: Record<string, unknown> };

export type MediaContext = {
  signal: AbortSignal;
  progress: (p: number) => void;
  log: (message: string) => void;
  /** Persist an external job id so the job record shows it. */
  setExternalId: (id: string) => void;
};

export interface MediaProvider {
  info(): MediaProviderInfo;
  generate(req: MediaRequest, ctx: MediaContext): Promise<MediaOutput>;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new AIError("CANCELLED", "Cancelled"));
    });
  });

// ─── OpenAI (images, materials, speech, video) ───────────────────────────

const IMAGE_SIZES: Record<string, "1024x1024" | "1536x1024" | "1024x1536"> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "16:9": "1536x1024",
  "2:3": "1024x1536",
  "9:16": "1024x1536",
};

class OpenAIMediaProvider implements MediaProvider {
  info(): MediaProviderInfo {
    const e = env();
    const kinds: MediaKind[] = [];
    if (e.OPENAI_IMAGE_MODEL) kinds.push("image", "material");
    if (e.OPENAI_TTS_MODEL) kinds.push("audio");
    if (e.OPENAI_VIDEO_MODEL) kinds.push("video");
    const configured = Boolean(e.OPENAI_API_KEY);
    return {
      id: "openai",
      label: "OpenAI",
      kinds: configured ? kinds : [],
      configured: configured && kinds.length > 0,
      reason: !configured
        ? "Set OPENAI_API_KEY on the server."
        : kinds.length === 0
          ? "Set OPENAI_IMAGE_MODEL, OPENAI_TTS_MODEL and/or OPENAI_VIDEO_MODEL to enable media generation."
          : null,
      model: [e.OPENAI_IMAGE_MODEL, e.OPENAI_TTS_MODEL, e.OPENAI_VIDEO_MODEL].filter(Boolean).join(", ") || null,
      notes: "Images and materials via the Images API, speech via the Audio API, video via the Videos API (asynchronous). Availability depends on your account.",
    };
  }

  async generate(req: MediaRequest, ctx: MediaContext): Promise<MediaOutput> {
    const e = env();
    const client = openaiClient();
    try {
      if (req.kind === "image" || req.kind === "material") {
        if (!e.OPENAI_IMAGE_MODEL) throw new AIError("NOT_CONFIGURED", "OPENAI_IMAGE_MODEL is not set");
        const format = req.options.format === "jpeg" || req.options.format === "webp" ? req.options.format : "png";
        const prompt =
          req.kind === "material"
            ? `Seamless, tileable, physically based texture (albedo map) of: ${req.prompt}. Flat lighting, no perspective, no shadows, edges tile perfectly.`
            : req.prompt;
        ctx.progress(0.2);
        const res = await client.images.generate(
          {
            model: e.OPENAI_IMAGE_MODEL,
            prompt,
            size: req.kind === "material" ? "1024x1024" : IMAGE_SIZES[req.options.aspect ?? "1:1"],
            quality: req.options.quality ?? "medium",
            output_format: format,
            n: 1,
          },
          { signal: ctx.signal },
        );
        const b64 = res.data?.[0]?.b64_json;
        if (!b64) throw new AIError("INVALID_OUTPUT", "The image API returned no image data");
        return {
          data: new Uint8Array(Buffer.from(b64, "base64")),
          mimeType: `image/${format}`,
          ext: format === "jpeg" ? "jpg" : format,
          metadata: { model: e.OPENAI_IMAGE_MODEL, revisedPrompt: res.data?.[0]?.revised_prompt ?? null, usage: res.usage ?? null },
        };
      }
      if (req.kind === "audio") {
        if (!e.OPENAI_TTS_MODEL) throw new AIError("NOT_CONFIGURED", "OPENAI_TTS_MODEL is not set");
        const format = req.options.format === "wav" ? "wav" : "mp3";
        ctx.progress(0.2);
        const res = await client.audio.speech.create(
          { model: e.OPENAI_TTS_MODEL, voice: req.options.voice ?? "alloy", input: req.prompt.slice(0, 4096), response_format: format },
          { signal: ctx.signal },
        );
        const buf = new Uint8Array(await res.arrayBuffer());
        return { data: buf, mimeType: format === "wav" ? "audio/wav" : "audio/mpeg", ext: format, metadata: { model: e.OPENAI_TTS_MODEL, voice: req.options.voice ?? "alloy" } };
      }
      if (req.kind === "video") {
        if (!e.OPENAI_VIDEO_MODEL) throw new AIError("NOT_CONFIGURED", "OPENAI_VIDEO_MODEL is not set");
        const size = req.options.aspect === "9:16" ? "720x1280" : "1280x720";
        let video = await client.videos.create({ model: e.OPENAI_VIDEO_MODEL, prompt: req.prompt, seconds: req.options.seconds ?? "4", size }, { signal: ctx.signal });
        ctx.setExternalId(video.id);
        ctx.log(`Video job ${video.id} accepted (${video.status})`);
        const deadline = Date.now() + 20 * 60_000;
        while (video.status === "queued" || video.status === "in_progress") {
          if (Date.now() > deadline) throw new AIError("TIMEOUT", "Video generation did not finish within 20 minutes");
          await sleep(5000, ctx.signal);
          video = await client.videos.retrieve(video.id, { signal: ctx.signal });
          ctx.progress(Math.min(0.95, (video.progress ?? 0) / 100));
        }
        if (video.status !== "completed") throw new AIError("UPSTREAM", `Video generation failed: ${video.error?.message ?? video.status}`);
        const content = await client.videos.downloadContent(video.id, undefined, { signal: ctx.signal });
        const buf = new Uint8Array(await content.arrayBuffer());
        return { data: buf, mimeType: "video/mp4", ext: "mp4", metadata: { model: e.OPENAI_VIDEO_MODEL, videoId: video.id, seconds: video.seconds, size: video.size } };
      }
      throw new AIError("BAD_REQUEST", `OpenAI does not provide ${req.kind} generation`);
    } catch (err) {
      throw err instanceof AIError ? err : mapOpenAIError(err);
    }
  }
}

// ─── External adapters for modalities OpenAI does not offer ──────────────
// Implemented against the providers' public HTTP APIs. They are disabled until
// the corresponding key is configured and have not been exercised against the
// live services in this repository's automated tests.

class MeshyProvider implements MediaProvider {
  info(): MediaProviderInfo {
    const key = env().MESHY_API_KEY;
    return {
      id: "meshy",
      label: "Meshy (external)",
      kinds: key ? ["model3d"] : [],
      configured: Boolean(key),
      reason: key ? null : "3D model generation needs an external provider. Set MESHY_API_KEY to enable the Meshy adapter.",
      model: key ? "text-to-3d (preview)" : null,
      notes: "Text-to-3D via Meshy's API; returns a GLB model. OpenAI does not offer 3D model generation.",
    };
  }
  async generate(req: MediaRequest, ctx: MediaContext): Promise<MediaOutput> {
    const key = env().MESHY_API_KEY;
    if (!key) throw new AIError("NOT_CONFIGURED", "MESHY_API_KEY is not set");
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const created = await fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: "preview", prompt: req.prompt.slice(0, 600) }),
      signal: ctx.signal,
    });
    if (!created.ok) throw new AIError("UPSTREAM", `Meshy rejected the request (${created.status})`);
    const { result: id } = (await created.json()) as { result: string };
    ctx.setExternalId(id);
    const deadline = Date.now() + 15 * 60_000;
    for (;;) {
      if (Date.now() > deadline) throw new AIError("TIMEOUT", "3D model generation did not finish within 15 minutes");
      await sleep(5000, ctx.signal);
      const r = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${encodeURIComponent(id)}`, { headers, signal: ctx.signal });
      if (!r.ok) throw new AIError("UPSTREAM", `Meshy status check failed (${r.status})`);
      const task = (await r.json()) as { status: string; progress?: number; model_urls?: { glb?: string }; task_error?: { message?: string } };
      ctx.progress(Math.min(0.95, (task.progress ?? 0) / 100));
      if (task.status === "SUCCEEDED") {
        const url = task.model_urls?.glb;
        if (!url) throw new AIError("INVALID_OUTPUT", "Meshy returned no GLB model");
        const file = await fetch(url, { signal: ctx.signal });
        if (!file.ok) throw new AIError("UPSTREAM", "Could not download the generated model");
        return { data: new Uint8Array(await file.arrayBuffer()), mimeType: "model/gltf-binary", ext: "glb", metadata: { provider: "meshy", taskId: id } };
      }
      if (task.status === "FAILED" || task.status === "CANCELED") throw new AIError("UPSTREAM", `Meshy task ${task.status.toLowerCase()}: ${task.task_error?.message ?? ""}`);
    }
  }
}

class ElevenLabsSfxProvider implements MediaProvider {
  info(): MediaProviderInfo {
    const key = env().ELEVENLABS_API_KEY;
    return {
      id: "elevenlabs",
      label: "ElevenLabs (external)",
      kinds: key ? ["sfx"] : [],
      configured: Boolean(key),
      reason: key ? null : "Sound-effect generation needs an external provider. Set ELEVENLABS_API_KEY to enable the ElevenLabs adapter.",
      model: key ? "sound-generation" : null,
      notes: "Text-to-sound-effect via ElevenLabs. OpenAI's audio API generates speech, not sound effects.",
    };
  }
  async generate(req: MediaRequest, ctx: MediaContext): Promise<MediaOutput> {
    const key = env().ELEVENLABS_API_KEY;
    if (!key) throw new AIError("NOT_CONFIGURED", "ELEVENLABS_API_KEY is not set");
    ctx.progress(0.2);
    const r = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: req.prompt.slice(0, 1000), duration_seconds: req.options.durationSeconds ?? null }),
      signal: ctx.signal,
    });
    if (!r.ok) throw new AIError("UPSTREAM", `ElevenLabs rejected the request (${r.status})`);
    return { data: new Uint8Array(await r.arrayBuffer()), mimeType: "audio/mpeg", ext: "mp3", metadata: { provider: "elevenlabs" } };
  }
}

/**
 * Test-only provider (registered only when AI_PROVIDER=mock). It renders a
 * small solid-colour PNG so asset-job state transitions can be tested offline.
 * It is labelled as a test fixture everywhere it appears.
 */
class TestFixtureMediaProvider implements MediaProvider {
  info(): MediaProviderInfo {
    return { id: "test-fixture", label: "Test fixture (offline)", kinds: ["image"], configured: true, reason: null, model: "solid-color-png", notes: "Automated-test provider. Produces a solid colour PNG, not a generated image." };
  }
  async generate(req: MediaRequest, ctx: MediaContext): Promise<MediaOutput> {
    ctx.progress(0.5);
    if (/\[simulate-failure\]/.test(req.prompt)) throw new AIError("UPSTREAM", "Simulated provider failure");
    return { data: solidPng(8, 8, [124, 140, 255]), mimeType: "image/png", ext: "png", metadata: { fixture: true } };
  }
}

function solidPng(w: number, h: number, [r, g, b]: [number, number, number]): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("node:zlib") as typeof import("node:zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const PROVIDERS: Record<string, MediaProvider> = {
  openai: new OpenAIMediaProvider(),
  meshy: new MeshyProvider(),
  elevenlabs: new ElevenLabsSfxProvider(),
};

/** Which provider ids can serve each kind (whether or not configured). */
export const PROVIDERS_FOR_KIND: Record<MediaKind, string[]> = {
  image: ["openai"],
  material: ["openai"],
  audio: ["openai"],
  video: ["openai"],
  sfx: ["elevenlabs"],
  model3d: ["meshy"],
};

function testMode() {
  return env().AI_PROVIDER === "mock";
}

export function mediaProvider(id: string): MediaProvider | null {
  if (id === "test-fixture") return testMode() ? new TestFixtureMediaProvider() : null;
  return PROVIDERS[id] ?? null;
}

function providerIdsFor(kind: MediaKind): string[] {
  return testMode() && kind === "image" ? [...PROVIDERS_FOR_KIND[kind], "test-fixture"] : PROVIDERS_FOR_KIND[kind];
}

export function isProviderForKind(id: string, kind: MediaKind) {
  return providerIdsFor(kind).includes(id);
}

export function mediaProviderStatus() {
  return Object.fromEntries(
    (Object.keys(PROVIDERS_FOR_KIND) as MediaKind[]).map((kind) => [
      kind,
      providerIdsFor(kind).map((id) => {
        const info = mediaProvider(id)!.info();
        return { ...info, availableForKind: info.configured && info.kinds.includes(kind) };
      }),
    ]),
  ) as Record<MediaKind, (MediaProviderInfo & { availableForKind: boolean })[]>;
}
