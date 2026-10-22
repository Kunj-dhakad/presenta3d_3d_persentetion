import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { SceneSpec } from "@/lib/schemas/scene";

const RUNTIME_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "server", "scene-codegen", "runtime.js.txt");

/** Deterministic SceneSpec → three.js project conversion (no model call). */
export function sceneToProjectFiles(scene: SceneSpec): { path: string; content: string }[] {
  const runtime = fs.readFileSync(RUNTIME_PATH, "utf8");
  const title = scene.title.replace(/[<>&"]/g, "");
  return [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <canvas id="scene" aria-label="${title}"></canvas>
  <div id="labels" aria-hidden="true"></div>
  <div id="hud" hidden></div>
  <script type="module" src="./main.js"></script>
</body>
</html>
`,
    },
    {
      path: "style.css",
      content: `html, body { margin: 0; height: 100%; background: ${scene.environment.background}; overflow: hidden; font-family: system-ui, sans-serif; }
#scene { display: block; width: 100vw; height: 100vh; touch-action: none; }
#labels { position: fixed; inset: 0; pointer-events: none; }
.label { position: absolute; left: 0; top: 0; padding: 3px 8px; border-radius: 6px; background: rgba(10, 10, 14, 0.72); color: #f2f2f5; font-size: 12px; white-space: nowrap; border: 1px solid rgba(255, 255, 255, 0.12); }
#hud { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; background: rgba(10, 10, 14, 0.8); color: #fff; font-size: 14px; border: 1px solid rgba(255, 255, 255, 0.15); }
`,
    },
    { path: "scene.json", content: JSON.stringify(scene, null, 2) },
    { path: "main.js", content: runtime },
  ];
}
