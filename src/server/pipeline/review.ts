import type { FileMap } from "@/lib/vfs/apply";
import type { Framework } from "@/lib/schemas/project";

/**
 * Project reviewer agent (deterministic, no model call). Its measurable output
 * is a list of concrete problems found in the merged project before building.
 */
export function reviewProject(files: FileMap, framework: Framework, plannedFiles: string[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isReact = framework === "react-ts" || framework === "react-js";

  for (const p of plannedFiles) {
    if (!files.has(p)) warnings.push(`planned file ${p} was not produced`);
  }
  for (const [p, c] of files) {
    if (c.trim().length === 0) errors.push(`${p} is empty`);
    if (/\b(TODO: implement|\.\.\. rest of|\/\/ \.\.\.$)/m.test(c)) warnings.push(`${p} contains placeholder text`);
  }
  if (isReact) {
    const entry = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx"].find((e) => files.has(e));
    if (!entry) errors.push("React project has no src/main.tsx or src/main.jsx entry file");
    else if (!/createRoot|hydrateRoot/.test(files.get(entry)!)) errors.push(`${entry} never mounts the app with createRoot`);
    const html = files.get("index.html");
    if (html && !/id=["']root["']/.test(html)) warnings.push('index.html has no element with id="root"');
  } else {
    const html = files.get("index.html");
    if (!html) errors.push("index.html is missing");
    else if (!/<script/i.test(html) && [...files.keys()].some((p) => /\.(m?js|ts)$/.test(p))) warnings.push("index.html does not load any script");
  }
  return { errors, warnings };
}
