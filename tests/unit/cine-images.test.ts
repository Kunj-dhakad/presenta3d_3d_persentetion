import { beforeEach, describe, expect, it, vi } from "vitest";

// The real OpenAI path of the painter, against a fake client (no network).
const calls: { create: unknown[]; retrieve: string[]; cancel: string[] } = { create: [], retrieve: [], cancel: [] };
let replies: Record<string, unknown[]> = {};
let refusedHosts: string[] = [];
vi.mock("@/server/ai/openai-provider", async (orig) => {
  const actual = await orig<typeof import("@/server/ai/openai-provider")>();
  return {
    ...actual,
    openaiClient: () => ({
      responses: {
        create: async (body: unknown) => {
          calls.create.push(body);
          const host = (body as { model: string }).model;
          if (refusedHosts.includes(host)) throw Object.assign(new Error(`400 The model '${host}' does not exist.`), { status: 400 });
          if (String((body as { input: string }).input).includes("[refuse]")) {
            throw Object.assign(new Error("Your organization must be verified to use the model"), { status: 403 });
          }
          return { id: `resp_${calls.create.length}`, status: "queued" };
        },
        retrieve: async (id: string) => {
          calls.retrieve.push(id);
          const queue = replies[id] ?? [];
          return queue.length > 1 ? queue.shift() : queue[0];
        },
        cancel: async (id: string) => {
          calls.cancel.push(id);
        },
      },
    }),
  };
});
vi.mock("@/server/env", async (orig) => {
  const actual = await orig<typeof import("@/server/env")>();
  return { ...actual, env: () => ({ ...actual.env(), AI_PROVIDER: "openai", OPENAI_MODEL: "gpt-test", OPENAI_IMAGE_MODEL: undefined }) };
});

const { ImagePainter, DEFAULT_IMAGE_MODEL } = await import("@/server/deck/cine-images");
const { storage } = await import("@/server/storage/storage");

const PNG_B64 = Buffer.from("fake-image-bytes").toString("base64");

describe("cinematic image painter (OpenAI background mode)", () => {
  beforeEach(() => {
    calls.create = [];
    calls.retrieve = [];
    calls.cancel = [];
    replies = {};
    refusedHosts = [];
  });

  it("starts a background image job with the default image model when none is configured", async () => {
    const painter = new ImagePainter("cprojectabc12345");
    expect(painter.model).toBe(DEFAULT_IMAGE_MODEL);
    const id = await painter.start("A glacier collapsing at dusk", new AbortController().signal);
    expect(id).toBe("resp_1");
    const body = calls.create[0] as { background: boolean; store: boolean; model: string; tools: { type: string; model: string; size: string }[]; tool_choice: unknown };
    expect(body.background).toBe(true);
    expect(body.store).toBe(true);
    expect(body.model).toBe("gpt-4.1-mini"); // a model known to host the image tool, before OPENAI_MODEL
    expect(body.tools[0]).toMatchObject({ type: "image_generation", model: "gpt-image-1", size: "1536x1024" });
    expect(body.tool_choice).toEqual({ type: "image_generation" });
  });

  it("reports pending, then stores the finished image and returns its address", async () => {
    const painter = new ImagePainter("cprojectabc12345");
    replies.resp_9 = [
      { status: "in_progress", output: [] },
      { status: "completed", output: [{ type: "message" }, { type: "image_generation_call", status: "completed", result: PNG_B64 }] },
    ];
    expect(await painter.check("resp_9", new AbortController().signal)).toEqual({ state: "pending" });
    const done = await painter.check("resp_9", new AbortController().signal);
    expect(done.state).toBe("done");
    const url = (done as { url: string }).url;
    expect(url).toMatch(/^\/deckmedia\/cprojectabc12345\/[A-Za-z0-9_-]+\.webp$/);
    expect(Buffer.from((await storage().get(url.slice(1)))!).toString()).toBe("fake-image-bytes");
  });

  it("reports OpenAI's reason when an image fails or is refused", async () => {
    const painter = new ImagePainter("cprojectabc12345");
    replies.resp_bad = [{ status: "failed", error: { message: "Your request was rejected by the safety system" }, output: [] }];
    expect(await painter.check("resp_bad", new AbortController().signal)).toEqual({ state: "failed", error: "Your request was rejected by the safety system" });
    replies.resp_empty = [{ status: "completed", output: [{ type: "message" }] }];
    expect(await painter.check("resp_empty", new AbortController().signal)).toEqual({ state: "failed", error: "no image was returned" });
    await expect(painter.start("[refuse] anything", new AbortController().signal)).rejects.toThrow(/organization must be verified/);
  });

  it("tries the next host model when OpenAI refuses one, and stops at an image refusal", async () => {
    refusedHosts = ["gpt-4.1-mini", "gpt-4.1"];
    const painter = new ImagePainter("cprojectabc12345");
    await painter.start("A city at night", new AbortController().signal);
    expect(calls.create.map((b) => (b as { model: string }).model)).toEqual(["gpt-4.1-mini", "gpt-4.1", "gpt-test"]);
    // The working host is remembered: the next image goes straight to it.
    calls.create = [];
    await painter.start("Another", new AbortController().signal);
    expect(calls.create.map((b) => (b as { model: string }).model)).toEqual(["gpt-test"]);
    // An image refusal is not retried with other hosts.
    calls.create = [];
    await expect(painter.start("[refuse] x", new AbortController().signal)).rejects.toThrow(/verified/);
    expect(calls.create).toHaveLength(1);
  });

  it("cancels jobs that are no longer wanted", async () => {
    await new ImagePainter("cprojectabc12345").cancel(["resp_1", "resp_2"]);
    expect(calls.cancel).toEqual(["resp_1", "resp_2"]);
  });
});
