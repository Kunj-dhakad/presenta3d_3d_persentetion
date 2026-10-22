import type { ProjectSpec } from "@/lib/schemas/project";
import { validateProjectPath } from "@/lib/vfs/paths";
import { isAllowedSpecifier } from "../../../preview-runner/registry.mjs";
import type { AgentRole, TaskSpec } from "@/server/orchestrator/orchestrator";

export const MAX_PLANNED_FILES = 16;
const MAX_GROUP_SIZE = 4;
const ENTRY_RE = /^(index\.html|src\/main\.(t|j)sx?|src\/index\.(t|j)sx?|src\/App\.(t|j)sx|main\.(j|t)s|app\.js|script\.js)$/;

export type NormalizedSpec = { spec: ProjectSpec; warnings: string[] };

/** Make planner output safe and buildable: valid paths, an entry file, allowed packages, bounded groups. */
export function normalizeSpec(raw: ProjectSpec): NormalizedSpec {
  const warnings: string[] = [];
  const seen = new Set<string>();
  let files: ProjectSpec["files"] = [];
  for (const f of raw.files) {
    const v = validateProjectPath(f.path.replace(/^\.\//, ""));
    if (!v.ok) {
      warnings.push(`dropped planned file "${f.path}": ${v.error}`);
      continue;
    }
    if (seen.has(v.path.toLowerCase())) continue;
    seen.add(v.path.toLowerCase());
    files.push({ ...f, path: v.path, group: (f.group || "main").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32) || "main" });
  }
  if (files.length > MAX_PLANNED_FILES) {
    warnings.push(`plan trimmed from ${files.length} to ${MAX_PLANNED_FILES} files`);
    files = files.slice(0, MAX_PLANNED_FILES);
  }

  const isReact = raw.framework === "react-ts" || raw.framework === "react-js";
  const ensure = (path: string, purpose: string, exportsContract: string) => {
    if (!files.some((f) => f.path === path)) {
      files.unshift({ path, purpose, exports: exportsContract, group: "entry" });
      warnings.push(`added missing entry file ${path}`);
    }
  };
  if (isReact) {
    const ext = raw.framework === "react-ts" ? "tsx" : "jsx";
    if (!files.some((f) => /^src\/(main|index)\.(t|j)sx?$/.test(f.path))) ensure(`src/main.${ext}`, "React entry: mounts <App/> into #root", "none");
  } else {
    ensure("index.html", "HTML entry document", "loads the project's module scripts and stylesheets with relative paths");
  }
  for (const f of files) if (ENTRY_RE.test(f.path)) f.group = "entry";

  // Split oversized groups so one call never has to emit too much code.
  const byGroup = new Map<string, ProjectSpec["files"]>();
  for (const f of files) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f]);
  for (const [g, list] of byGroup) {
    if (list.length <= MAX_GROUP_SIZE) continue;
    list.forEach((f, i) => (f.group = `${g}-${Math.floor(i / MAX_GROUP_SIZE) + 1}`));
  }

  const packages = [...new Set(raw.packages)].filter((p) => {
    if (isAllowedSpecifier(p)) return true;
    warnings.push(`package "${p}" is not available in the preview runtime and was removed from the plan`);
    return false;
  });

  return { spec: { ...raw, title: raw.title.slice(0, 80) || "Untitled project", files, packages }, warnings };
}

export type GenerationTaskInput = { files: ProjectSpec["files"]; group: string };

function roleFor(spec: ProjectSpec, files: ProjectSpec["files"]): AgentRole {
  if (files.every((f) => f.path.endsWith(".css"))) return "design";
  const text = files.map((f) => `${f.path} ${f.purpose}`).join(" ").toLowerCase();
  if (spec.framework === "three" || /three|scene|webgl|3d|shader|r3f|canvas/.test(text)) return "threeD";
  return "frontend";
}

/** One generation task per group; the entry group depends on every other group. */
export function tasksFromSpec(spec: ProjectSpec): TaskSpec<GenerationTaskInput>[] {
  const groups = new Map<string, ProjectSpec["files"]>();
  for (const f of spec.files) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  const ids = [...groups.keys()].map((g) => `gen-${g}`);
  return [...groups.entries()].map(([group, files]) => {
    const id = `gen-${group}`;
    return {
      id,
      role: roleFor(spec, files),
      description: `Write ${files.map((f) => f.path).join(", ")}`,
      inputs: { files, group },
      dependsOn: group === "entry" ? ids.filter((x) => x !== id) : [],
      writes: files.map((f) => f.path),
    };
  });
}
