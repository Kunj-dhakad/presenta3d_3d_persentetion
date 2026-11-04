import { describe, expect, it, vi } from "vitest";

// Route handlers are called directly here, outside a Next.js request.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
const { POST } = await import("@/app/api/projects/[id]/thumbnail/route");
const { db } = await import("@/server/db/client");
const { userForToken } = await import("@/server/auth/php-token");
const { createProject } = await import("@/server/services/projects");
const { storage } = await import("@/server/storage/storage");

/** A JPEG-looking payload (SOI marker, then filler) as a data URL. */
const jpeg = (bytes = 4096) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes)]).toString("base64")}`;

const call = (projectId: string, body: unknown) =>
  POST(new Request(`http://localhost/api/projects/${projectId}/thumbnail`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: projectId }),
  });

describe("slide-1 thumbnails for the presentation listing", () => {
  it("stores the picture of a project's build as deckmedia/<project>/thumb-<build>.jpg", async () => {
    // Without a PHP token the app runs as its guest user.
    const user = await userForToken(null)!;
    const project = await createProject(user.id, { name: "Deck", category: "presentation", framework: "three" });
    const buildId = `b${Date.now().toString(36)}thumbtest`;
    await db.build.create({ data: { id: buildId, projectId: project.id, status: "succeeded", versionDigest: "x" } });

    const res = await call(project.id, { buildId, image: jpeg() });
    expect(res.status).toBe(200);
    const stored = await storage().get(`deckmedia/${project.id}/thumb-${buildId}.jpg`);
    expect(stored?.[0]).toBe(0xff);

    // Only real JPEGs of the project's own builds.
    expect((await call(project.id, { buildId: "notthisprojectsbuild", image: jpeg() })).status).toBe(400);
    expect((await call(project.id, { buildId, image: `data:image/jpeg;base64,${Buffer.alloc(4096, 1).toString("base64")}` })).status).toBe(400);
    expect((await call(project.id, { buildId, image: "data:image/png;base64,AAAA" })).status).toBe(400);
  });
});
