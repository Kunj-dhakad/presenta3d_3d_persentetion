import { describe, expect, it, vi } from "vitest";

// Route handlers are called directly here, outside a Next.js request.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
const { POST } = await import("@/app/api/presenter/avatar-image/route");

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/presenter/avatar-image", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), {
    params: Promise.resolve({}),
  });

describe("AI avatar portrait (Presenter panel: Create with AI)", () => {
  it("returns the portrait as an image data URL", async () => {
    const res = await call({ description: "A friendly woman with short dark hair in a navy blazer" });
    expect(res.status).toBe(200);
    const { image } = (await res.json()) as { image: string };
    expect(image).toMatch(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);
  });

  it("asks for a description", async () => {
    const res = await call({ description: " " });
    expect(res.status).toBe(400);
  });

  it("refuses a token that is not the PHP app's", async () => {
    const res = await call({ description: "A presenter" }, { "x-access-token": "not-a-token" });
    expect(res.status).toBe(401);
  });
});
