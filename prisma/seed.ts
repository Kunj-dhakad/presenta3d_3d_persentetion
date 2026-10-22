/**
 * Seeds example data for the local single-user account: the four example code
 * projects, three 3D scene templates and a starter canvas. Idempotent: items
 * that already exist (by name) are skipped.
 *
 * Run with: npm run db:seed   (uses the react-server condition so server-only modules load)
 */
import "dotenv/config";
import { db } from "@/server/db/client";
import { createProject } from "@/server/services/projects";
import { localModeUser } from "@/server/auth/local-user";
import { EXAMPLE_PROJECTS } from "@/server/examples";
import { SCENE_TEMPLATES } from "@/lib/scene/templates";
import { emptyCanvas, makeNode } from "@/lib/schemas/canvas";

async function main() {
  const user = await localModeUser();
  const existing = new Set((await db.project.findMany({ where: { ownerId: user.id }, select: { name: true } })).map((p) => p.name));

  for (const ex of EXAMPLE_PROJECTS) {
    if (existing.has(ex.name)) continue;
    await createProject(user.id, { name: ex.name, description: ex.description, category: ex.category, framework: ex.framework, files: ex.files() });
    console.log(`project  ${ex.name}`);
  }
  for (const id of ["solar-system", "futuristic-city", "collector-game"]) {
    const t = SCENE_TEMPLATES.find((s) => s.id === id)!;
    const scene = t.build();
    if (existing.has(scene.title)) continue;
    await createProject(user.id, { name: scene.title, description: scene.description, category: "scene3d", framework: "three", sceneSpec: scene });
    console.log(`scene    ${scene.title}`);
  }
  if (!(await db.canvasDocument.findFirst({ where: { ownerId: user.id, name: "Moodboard" } }))) {
    const doc = emptyCanvas();
    doc.pages[0].nodes = [
      makeNode("frame", "hero", { name: "Hero", x: 0, y: 0, w: 720, h: 420 }),
      makeNode("text", "hero-title", { name: "Title", x: 48, y: 64, w: 560, h: 72, text: "Describe it. Build it.", fontSize: 52, fontWeight: 700, frameId: "hero" }),
      makeNode("text", "hero-sub", { name: "Subtitle", x: 48, y: 156, w: 480, h: 60, text: "Select this frame and press Generate to redesign it with AI.", fontSize: 18, fontWeight: 400, color: "#a1a1aa", frameId: "hero" }),
      makeNode("rect", "hero-cta", { name: "Button", x: 48, y: 252, w: 168, h: 44, fill: "#8b9cff", radius: 10, frameId: "hero" }),
      makeNode("frame", "pricing", { name: "Pricing", x: 800, y: 0, w: 720, h: 420 }),
    ];
    await db.canvasDocument.create({ data: { ownerId: user.id, name: "Moodboard", data: doc } });
    console.log("canvas   Moodboard");
  }
  console.log(`Seeded for ${user.email}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
