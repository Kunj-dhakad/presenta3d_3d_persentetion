import { api, HttpError } from "@/server/http/api";
import { createProject, getOwnedProject } from "@/server/services/projects";
import { serializeProject } from "@/server/services/serialize";
import { validateScene } from "@/lib/schemas/scene";
import { sceneToProjectFiles } from "@/server/scene-codegen/codegen";

/** Convert a scene into a standalone three.js code project that can be edited in Chat and published. */
export const POST = api<{ id: string }>(async ({ user, params }) => {
  const p = await getOwnedProject(user.id, params.id);
  const v = validateScene(p.sceneSpec);
  if (!v.ok) throw new HttpError(400, `Scene is invalid: ${v.errors[0]}`, "INVALID_SCENE");
  const project = await createProject(user.id, {
    name: `${p.name} (code)`.slice(0, 120),
    description: v.scene.description,
    category: v.scene.controls.mode === "player" ? "game" : "scene3d",
    framework: "three",
    files: sceneToProjectFiles(v.scene),
  });
  return { project: serializeProject(project) };
});
