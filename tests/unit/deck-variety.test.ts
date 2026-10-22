import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { ENVIRONMENTS, sampleDeck, validateDeck } from "@/lib/schemas/deck";
import { designBrief } from "@/server/deck/pipeline";
import { deckToProjectFiles } from "@/server/deck/codegen";
import { cancelJob } from "@/server/jobs/runner";
import { createUser } from "../support/helpers";

describe("presentation variety", () => {
  it("keeps decks saved before environments existed valid, with their original look", () => {
    const legacy = sampleDeck("Old deck") as unknown as { theme: Record<string, unknown> };
    delete legacy.theme.environment;
    delete legacy.theme.transition;
    const v = validateDeck(legacy);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.deck.theme).toMatchObject({ environment: "grid", transition: "side" });
  });

  it("rejects unknown environments", () => {
    const deck = sampleDeck("X");
    const v = validateDeck({ ...deck, theme: { ...deck.theme, environment: "volcano" } });
    expect(v.ok).toBe(false);
  });

  it("gives each new deck a different design brief", () => {
    const briefs = new Set(Array.from({ length: 12 }, () => designBrief()));
    expect(briefs.size).toBeGreaterThan(8);
    expect(designBrief()).toMatch(/palette idea: .+\n- environment idea: (grid|space|ocean|aurora|horizon|studio); transition: (side|dive)/);
  });

  it("ships an engine that renders every environment and both transitions", () => {
    const main = deckToProjectFiles(sampleDeck("Engine")).find((f) => f.path === "main.js")!.content;
    for (const env of ENVIRONMENTS) expect(main).toContain(`"${env}"`);
    expect(main).toContain('deck.theme.transition === "dive"');
  });
});

describe("job control across instances", () => {
  it("cancels a job that is not running in this process through the database", async () => {
    const user = await createUser();
    const job = await db.generationJob.create({ data: { userId: user.id, kind: "project-generate", provider: "mock", input: {}, status: "running" } });
    expect(await cancelJob(job.id)).toBe(true);
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
    expect(await cancelJob(job.id)).toBe(false);
  });
});
