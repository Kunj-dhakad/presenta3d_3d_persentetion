import { beforeEach, describe, expect, it, vi } from "vitest";

// The real OpenAI path of the painter (Images API), against a fake client (no network).
const calls: { body: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
let reply: () => unknown = () => ({ data: [{ b64_json: Buffer.from("fake-image-bytes").toString("base64") }] });
vi.mock("@/server/ai/openai-provider", async (orig) => {
  const actual = await orig<typeof import("@/server/ai/openai-provider")>();
  return {
    ...actual,
    openaiClient: () => ({
      images: {
        generate: async (body: Record<string, unknown>, opts: Record<string, unknown>) => {
          calls.push({ body, opts });
          return reply();
        },
      },
    }),
  };
});
let imageModel: string | undefined;
vi.mock("@/server/env", async (orig) => {
  const actual = await orig<typeof import("@/server/env")>();
  return { ...actual, env: () => ({ ...actual.env(), AI_PROVIDER: "openai", OPENAI_IMAGE_MODEL: imageModel }) };
});

const { ImagePainter, DEFAULT_IMAGE_MODEL } = await import("@/server/deck/cine-images");
const { storage } = await import("@/server/storage/storage");
const { AIError } = await import("@/server/ai/types");

describe("cinematic image painter (OpenAI Images API)", () => {
  beforeEach(() => {
    calls.length = 0;
    imageModel = undefined;
    reply = () => ({ data: [{ b64_json: Buffer.from("fake-image-bytes").toString("base64") }] });
  });

  it("paints with the Images API, the image model only (no text model), and stores the image", async () => {
    const painter = new ImagePainter("cprojectabc12345");
    expect(painter.model).toBe(DEFAULT_IMAGE_MODEL);
    const url = await painter.paint("A glacier collapsing at dusk", "medium", new AbortController().signal);
    expect(calls[0].body).toMatchObject({ model: "gpt-image-2", size: "1280x720", quality: "medium", output_format: "webp", n: 1 });
    expect(String(calls[0].body.prompt)).toContain("A glacier collapsing at dusk");
    expect(calls[0].opts.maxRetries).toBe(0); // the job retries in its next step instead
    expect(calls[0].opts.timeout).toBe(120_000); // not OPENAI_TIMEOUT_MS
    expect(url).toMatch(/^\/deckmedia\/cprojectabc12345\/[A-Za-z0-9_-]+\.webp$/);
    expect(Buffer.from((await storage().get(url.slice(1)))!).toString()).toBe("fake-image-bytes");
  });

  it("uses OPENAI_IMAGE_MODEL when it is set", async () => {
    imageModel = "gpt-image-1";
    await new ImagePainter("cprojectabc12345").paint("x", "low", new AbortController().signal);
    expect(calls[0].body).toMatchObject({ model: "gpt-image-1", quality: "low", size: "1536x1024" }); // older models: fixed sizes only
  });

  it("reports OpenAI's message when an image is refused, and an empty reply as an error", async () => {
    reply = () => {
      throw Object.assign(new Error("Your organization must be verified to use the model `gpt-image-2`"), { status: 403 });
    };
    const err = await new ImagePainter("cprojectabc12345").paint("x", "medium", new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err.message).toMatch(/organization must be verified/);
    reply = () => ({ data: [] });
    await expect(new ImagePainter("cprojectabc12345").paint("x", "medium", new AbortController().signal)).rejects.toThrow(/no image/);
  });
});
