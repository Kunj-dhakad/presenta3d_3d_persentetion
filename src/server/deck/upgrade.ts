import "server-only";
import { db } from "@/server/db/client";
import { getFiles, markWorkingVersion, snapshot, writeFileSet } from "@/server/services/projects";
import { buildProject } from "@/server/build/builder";
import { validateDeck } from "@/lib/schemas/deck";
import { deckToProjectFiles } from "./codegen";

const inFlight = new Map<string, Promise<boolean>>();

/**
 * Presentations store a copy of the engine (main.js, index.html, style.css)
 * next to their deck.json. When the engine improves, regenerate those files
 * from the unchanged deck.json and rebuild, so older presentations get the
 * new behaviour too. The slides themselves are never modified.
 * Returns true if the presentation was upgraded.
 */
export function ensureDeckEngineCurrent(projectId: string): Promise<boolean> {
  const running = inFlight.get(projectId);
  if (running) return running;
  const p = (async () => {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { category: true } });
    if (project?.category !== "presentation") return false;
    const files = await getFiles(projectId);
    const deckFile = files.find((f) => f.path === "deck.json");
    if (!deckFile) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(deckFile.content);
    } catch {
      return false;
    }
    const v = validateDeck(parsed);
    if (!v.ok) return false;
    const next = deckToProjectFiles(v.deck).map((f) => (f.path === "deck.json" ? deckFile : f));
    const current = new Map(files.map((f) => [f.path, f.content]));
    const upToDate = next.length === files.length && next.every((f) => current.get(f.path) === f.content);
    if (upToDate) return false;
    await writeFileSet(projectId, next);
    const build = await buildProject({ projectId, framework: "three", files: next });
    if (build.status === "succeeded") {
      const version = await snapshot(projectId, "auto", { summary: "Presentation engine update", files: next });
      await markWorkingVersion(projectId, version.id);
    }
    return true;
  })()
    // Best effort: a failed upgrade (e.g. a transient database error) must not
    // break opening the presentation; the last working build is shown and the
    // upgrade is retried on the next visit.
    .catch((err) => {
      console.error("[deck-upgrade]", projectId, err instanceof Error ? err.message : err);
      return false;
    })
    .finally(() => inFlight.delete(projectId));
  inFlight.set(projectId, p);
  return p;
}
