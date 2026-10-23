import "server-only";
import type { Framework, ProjectCategory } from "@/lib/schemas/project";
import { saasFiles } from "./saas";
import { configuratorFiles } from "./configurator";
import { gameFiles } from "./game";
import { sceneToProjectFiles } from "@/server/scene-codegen/codegen";
import { solarSystem } from "@/lib/scene/templates";

export type ExampleProject = {
  id: string;
  name: string;
  description: string;
  category: ProjectCategory;
  framework: Framework;
  files: () => { path: string; content: string }[];
};

export const EXAMPLE_PROJECTS: ExampleProject[] = [
  {
    id: "solar-system",
    name: "Cinematic solar system",
    description: "Interactive three.js solar system with orbiting planets, labels, a starfield and camera controls.",
    category: "scene3d",
    framework: "three",
    files: () => sceneToProjectFiles(solarSystem()),
  },
  {
    id: "saas-landing",
    name: "Northwind SaaS site",
    description: "Landing page, pricing, sign-in/sign-up screens and an analytics dashboard with responsive navigation.",
    category: "website",
    framework: "react-ts",
    files: saasFiles,
  },
  {
    id: "product-configurator",
    name: "3D speaker configurator",
    description: "React Three Fiber product configurator: rotate the model, change materials and inspect parts.",
    category: "react-app",
    framework: "react-ts",
    files: configuratorFiles,
  },
  {
    id: "neon-dodge",
    name: "Neon Dodge game",
    description: "Playable three.js lane runner with keyboard and touch controls, collision detection and scoring.",
    category: "game",
    framework: "three",
    files: gameFiles,
  },
];

/** Minimal runnable starting point for a framework (used by "New project → Start from scratch"). */
export function starterFiles(framework: Framework): { path: string; content: string }[] {
  if (framework === "react-ts" || framework === "react-js") {
    const ext = framework === "react-ts" ? "tsx" : "jsx";
    return [
      { path: "index.html", content: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>New app</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.${ext}"></script>\n</body>\n</html>\n` },
      { path: `src/main.${ext}`, content: `import { createRoot } from "react-dom/client";\nimport { App } from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")${framework === "react-ts" ? "!" : ""}).render(<App />);\n` },
      { path: `src/App.${ext}`, content: `import { useState } from "react";\n\nexport function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main className="app">\n      <h1>Hello from 3D Presentation</h1>\n      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>\n    </main>\n  );\n}\n` },
      { path: "src/styles.css", content: `body { margin: 0; font-family: system-ui, sans-serif; background: #0b0b0f; color: #ececf1; }\n.app { min-height: 100vh; display: grid; place-content: center; gap: 16px; text-align: center; }\nbutton { padding: 10px 16px; border-radius: 10px; border: 1px solid #333; background: #1a1a22; color: inherit; cursor: pointer; }\n` },
    ];
  }
  if (framework === "three") {
    return [
      { path: "index.html", content: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>New scene</title>\n  <style>html,body{margin:0;height:100%;background:#0b0b0f}canvas{display:block;width:100vw;height:100vh}</style>\n</head>\n<body>\n  <canvas id="scene"></canvas>\n  <script type="module" src="./main.js"></script>\n</body>\n</html>\n` },
      { path: "main.js", content: `import * as THREE from "three";\nimport { OrbitControls } from "three/addons/controls/OrbitControls.js";\n\nconst canvas = document.getElementById("scene");\nconst renderer = new THREE.WebGLRenderer({ canvas, antialias: true });\nrenderer.setPixelRatio(Math.min(devicePixelRatio, 2));\nconst scene = new THREE.Scene();\nconst camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);\ncamera.position.set(3, 2, 4);\nconst controls = new OrbitControls(camera, canvas);\nscene.add(new THREE.HemisphereLight("#ffffff", "#222233", 1.5));\nconst cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#7c8cff" }));\nscene.add(cube);\nfunction resize() {\n  renderer.setSize(innerWidth, innerHeight, false);\n  camera.aspect = innerWidth / innerHeight;\n  camera.updateProjectionMatrix();\n}\naddEventListener("resize", resize);\nresize();\nrenderer.setAnimationLoop((t) => {\n  cube.rotation.y = t / 1000;\n  controls.update();\n  renderer.render(scene, camera);\n});\n` },
    ];
  }
  return [
    { path: "index.html", content: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>New site</title>\n  <link rel="stylesheet" href="./styles.css">\n</head>\n<body>\n  <main class="page">\n    <h1>Hello from 3D Presentation</h1>\n    <p>Edit the files or ask the AI to build something.</p>\n  </main>\n  <script type="module" src="./main.js"></script>\n</body>\n</html>\n` },
    { path: "styles.css", content: `body { margin: 0; font-family: system-ui, sans-serif; background: #0b0b0f; color: #ececf1; }\n.page { max-width: 720px; margin: 0 auto; padding: 80px 24px; }\n` },
    { path: "main.js", content: `document.querySelector("h1").addEventListener("click", (e) => {\n  e.target.textContent = "You clicked the heading";\n});\n` },
  ];
}
