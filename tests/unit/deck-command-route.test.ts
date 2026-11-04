import { describe, expect, it, vi } from "vitest";

// Route handlers are called directly here, outside a Next.js request; the AI is the offline mock (tests/support/setup.ts).
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
// The build itself is covered elsewhere: here only what the command changes.
vi.mock("@/server/build/builder", () => ({ buildProject: async () => ({ id: "build-test", status: "succeeded", error: null }) }));
const { POST } = await import("@/app/api/projects/[id]/command/route");
const { userForToken } = await import("@/server/auth/php-token");
const { createProject, getFiles } = await import("@/server/services/projects");
const { sampleDeck } = await import("@/lib/schemas/deck");
const { deckToProjectFiles } = await import("@/server/deck/codegen");

const call = async (projectId: string, body: unknown) => {
  const res = await POST(new Request(`http://localhost/api/projects/${projectId}/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: projectId }),
  });
  return { status: res.status, body: (await res.json()) as { applied: boolean; needsAi: boolean; reply: string; preVersionId?: string | null } };
};
const deckOf = async (projectId: string) => JSON.parse((await getFiles(projectId)).find((f) => f.path === "deck.json")!.content);

describe("editing a presentation with commands", () => {
  it("applies simple changes at once and sends the rest to the AI editor", async () => {
    const user = await userForToken(null)!;
    const project = await createProject(user.id, { name: "Commands", category: "presentation", framework: "three", files: deckToProjectFiles(sampleDeck("Commands")) });

    const bigger = await call(project.id, { text: "make the text bigger", slide: 1 });
    expect(bigger.status).toBe(200);
    expect(bigger.body).toMatchObject({ applied: true, needsAi: false, reply: "Made the text larger." });
    expect((await deckOf(project.id)).settings.textScale).toBe(1.15);

    const title = await call(project.id, { text: "slide 2 title: Pricing" });
    expect(title.body.applied).toBe(true);
    expect((await deckOf(project.id)).slides[1].title).toBe("Pricing");

    // New slides, images and scenes are the full AI edit's job.
    expect((await call(project.id, { text: "add a new slide about the team" })).body).toMatchObject({ applied: false, needsAi: true });
    // Not a change: nothing happens, and the presenter is asked what to change.
    expect((await call(project.id, { text: "hello" })).body).toMatchObject({ applied: false, needsAi: false });
    expect((await deckOf(project.id)).settings.textScale).toBe(1.15);

    expect((await call(project.id, { text: "" })).status).toBe(400);
  });
});
