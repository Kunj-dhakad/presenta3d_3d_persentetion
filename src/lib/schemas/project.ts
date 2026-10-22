import { z } from "zod";

export const PROJECT_CATEGORIES = [
  "website",
  "react-app",
  "dashboard",
  "scene3d",
  "game",
  "ui-design",
  "data-viz",
  "creative-asset",
  "presentation",
] as const;
export const ProjectCategory = z.enum(PROJECT_CATEGORIES);
export type ProjectCategory = z.infer<typeof ProjectCategory>;

export const CATEGORY_LABELS: Record<ProjectCategory, string> = {
  website: "Website",
  "react-app": "React app",
  dashboard: "Dashboard",
  scene3d: "3D scene",
  game: "Game",
  "ui-design": "UI design",
  "data-viz": "Data viz",
  "creative-asset": "Creative asset",
  presentation: "Presentation",
};

/**
 * Frameworks the preview builder knows how to bundle.
 * - react-ts / react-js: esbuild bundle from src/main.(t|j)sx
 * - vanilla: static HTML/CSS/JS, ES modules allowed
 * - three: vanilla + three.js import map (alias of vanilla for the builder)
 */
export const FRAMEWORKS = ["react-ts", "react-js", "vanilla", "three"] as const;
export const Framework = z.enum(FRAMEWORKS);
export type Framework = z.infer<typeof Framework>;

export const ProjectStatus = z.enum(["active", "archived"]);

export const ProjectFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type ProjectFileData = z.infer<typeof ProjectFileSchema>;

/** Planner output: the project specification (Step B). */
export const ProjectSpecSchema = z.object({
  understanding: z.string().describe("One or two sentences restating what the user wants."),
  title: z.string().describe("Short project name, max 60 chars."),
  category: ProjectCategory,
  framework: Framework,
  goal: z.string(),
  designSystem: z.object({
    palette: z.array(z.string()).describe("Hex colors, background first."),
    typography: z.string(),
    style: z.string(),
  }),
  files: z
    .array(
      z.object({
        path: z.string().describe("Relative path inside the project, e.g. src/App.tsx"),
        purpose: z.string(),
        exports: z.string().describe("Public contract: exported names / DOM ids other files rely on. Empty string if none."),
        group: z.string().describe("Generation group id; files that must be written together share a group."),
      }),
    ),
  components: z.array(z.string()),
  packages: z.array(z.string()).describe("Bare npm specifiers imported by the code. Must be from the allowed list."),
  interactions: z.array(z.string()),
  responsive: z.string(),
  acceptanceTests: z.array(z.string()),
});
export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;

/** Edit planner output for follow-up turns on an existing project. */
export const EditPlanSchema = z.object({
  understanding: z.string(),
  summary: z.string().describe("What will change, for the user."),
  targets: z
    .array(
      z.object({
        path: z.string(),
        action: z.enum(["modify", "create", "delete"]),
        instructions: z.string(),
      }),
    ),
  packages: z.array(z.string()),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

/**
 * File-oriented code generation contract (Step C). Every model call that writes
 * code must return this shape; it is validated before anything touches the VFS.
 */
export const FileOperationSchema = z.object({
  path: z.string(),
  operation: z.enum(["create", "replace", "patch", "delete"]),
  content: z.string().describe("Full file content for create/replace. Empty string for patch/delete."),
  patches: z
    .array(
      z.object({
        search: z.string().describe("Exact, unique snippet from the current file."),
        replace: z.string(),
      }),
    )
    .describe("Search/replace hunks for operation=patch. Empty array otherwise."),
  explanation: z.string(),
});
export type FileOperation = z.infer<typeof FileOperationSchema>;

export const FileOperationsResultSchema = z.object({
  operations: z.array(FileOperationSchema),
  dependencies: z.array(z.string()),
  validation: z.array(z.string()).describe("How to verify these changes work."),
  complete: z.boolean().describe("false if you could not finish every requested file."),
});
export type FileOperationsResult = z.infer<typeof FileOperationsResultSchema>;
