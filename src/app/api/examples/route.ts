import { api } from "@/server/http/api";
import { EXAMPLE_PROJECTS } from "@/server/examples";
import { SCENE_TEMPLATES } from "@/lib/scene/templates";

/** Built-in example projects and 3D scene templates. */
export const GET = api(async () => ({
  projects: EXAMPLE_PROJECTS.map(({ id, name, description, category, framework }) => ({ id, name, description, category, framework })),
  scenes: SCENE_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
}));
