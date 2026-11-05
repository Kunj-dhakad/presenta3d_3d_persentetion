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

  it("replaces a slide's visual: a 3D scene, or a new picture on a cinematic slide", async () => {
    const user = await userForToken(null)!;
    const project = await createProject(user.id, { name: "Visuals", category: "presentation", framework: "three", files: deckToProjectFiles(sampleDeck("Visuals")) });
    const before = (await deckOf(project.id)).slides[1].scene.preset;
    const scene = await call(project.id, { text: "slide 2 picture: a spinning globe" });
    expect(scene.body).toMatchObject({ applied: true, needsAi: false });
    expect((await deckOf(project.id)).slides[1].scene.preset).not.toBe(before);

    const cineDeck = sampleDeck("Cine visuals");
    const cine = {
      ...cineDeck,
      style: "cinematic" as const,
      slides: cineDeck.slides.map((s) => ({ ...s, cine: { text: "fadeUp" as const, camera: "push" as const, transition: "glide" as const, pace: "normal" as const, imagePrompt: "old prompt", image: "" } })),
    };
    const cp = await createProject(user.id, { name: "Cine visuals", category: "presentation", framework: "cinematic", files: deckToProjectFiles(cine) });
    const pic = await call(cp.id, { text: "slide 1 picture: a city skyline at night" });
    expect(pic.body).toMatchObject({ applied: true, needsAi: false });
    const slide = (await deckOf(cp.id)).slides[0];
    expect(slide.cine.image).toMatch(new RegExp(`^/deckmedia/${cp.id}/`));
    // The stored prompt stays, so a later AI edit that keeps the slide's words keeps this picture.
    expect(slide.cine.imagePrompt).toBe("old prompt");
  });
});
