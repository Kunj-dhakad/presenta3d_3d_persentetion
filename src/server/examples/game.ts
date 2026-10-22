// Example project: "Neon Dodge" — a playable three.js lane runner with
// keyboard/touch controls, AABB collision detection, scoring and restart.
export function gameFiles(): { path: string; content: string }[] {
  return [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Neon Dodge</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <canvas id="game" aria-label="Neon Dodge game"></canvas>
  <div class="hud">
    <span>Score <strong id="score">0</strong></span>
    <span>Best <strong id="best">0</strong></span>
  </div>
  <div id="overlay" class="overlay">
    <h1>Neon Dodge</h1>
    <p>Switch lanes with <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd>. Tap the left or right half on touch screens.</p>
    <button id="start" type="button">Play</button>
  </div>
  <script type="module" src="./main.js"></script>
</body>
</html>
`,
    },
    {
      path: "style.css",
      content: `html, body { margin: 0; height: 100%; overflow: hidden; background: #05060a; color: #f1f2f6; font-family: system-ui, sans-serif; }
#game { display: block; width: 100vw; height: 100vh; }
.hud { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: flex; gap: 24px; padding: 8px 18px; border-radius: 999px; background: #0d0f17cc; border: 1px solid #ffffff1f; font-size: 14px; }
.hud strong { font-variant-numeric: tabular-nums; }
.overlay { position: fixed; inset: 0; display: grid; place-content: center; text-align: center; gap: 12px; background: radial-gradient(circle at center, #0d1024dd, #05060aee); }
.overlay[hidden] { display: none; }
.overlay h1 { margin: 0; font-size: clamp(40px, 8vw, 72px); letter-spacing: -0.03em; background: linear-gradient(90deg, #00e5ff, #ff2bd6); -webkit-background-clip: text; background-clip: text; color: transparent; }
.overlay p { color: #a3a8ba; max-width: 40ch; margin: 0 auto; }
kbd { padding: 1px 6px; border: 1px solid #ffffff33; border-radius: 4px; font-size: 12px; }
#start { justify-self: center; margin-top: 8px; padding: 12px 28px; border-radius: 12px; border: 0; background: #00e5ff; color: #05060a; font-weight: 700; font-size: 16px; cursor: pointer; }
#start:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
`,
    },
    {
      path: "main.js",
      content: `import * as THREE from "three";
import { createWorld } from "./world.js";
import { Obstacles } from "./obstacles.js";

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const { scene, camera, player, lanes, track } = createWorld();
const obstacles = new Obstacles(scene, lanes);

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("start");

let best = 0;
let state = "menu"; // menu | playing | over
let lane = 1;
let score = 0;
let speed = 14;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function start() {
  state = "playing";
  lane = 1;
  score = 0;
  speed = 14;
  obstacles.reset();
  overlay.hidden = true;
}
function gameOver() {
  state = "over";
  best = Math.max(best, Math.floor(score));
  bestEl.textContent = String(best);
  overlay.querySelector("h1").textContent = "Game over";
  overlay.querySelector("p").textContent = "You scored " + Math.floor(score) + ". Press Play or Space to try again.";
  overlay.hidden = false;
  startBtn.focus();
}
startBtn.addEventListener("click", start);

function move(dir) {
  if (state !== "playing") return;
  lane = Math.max(0, Math.min(lanes.length - 1, lane + dir));
}
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a") move(-1);
  if (k === "arrowright" || k === "d") move(1);
  if ((k === " " || k === "enter") && state !== "playing") start();
});
canvas.addEventListener("pointerdown", (e) => move(e.clientX < window.innerWidth / 2 ? -1 : 1));

const playerBox = new THREE.Box3();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  player.position.x += (lanes[lane] - player.position.x) * Math.min(1, dt * 14);
  player.position.y = 0.55 + Math.abs(Math.sin(t * 8)) * 0.06;
  player.rotation.z = (lanes[lane] - player.position.x) * -0.25;
  track.material.map.offset.y -= dt * (state === "playing" ? speed : 4) * 0.05;

  if (state === "playing") {
    speed = Math.min(42, speed + dt * 0.6);
    score += dt * speed * 0.5;
    scoreEl.textContent = String(Math.floor(score));
    obstacles.update(dt, speed);
    playerBox.setFromObject(player).expandByScalar(-0.08);
    if (obstacles.collides(playerBox)) gameOver();
  }
  renderer.render(scene, camera);
});
`,
    },
    {
      path: "world.js",
      content: `import * as THREE from "three";

/** Builds the static scene: camera, lights, glowing track and the player ship. */
export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#05060a");
  scene.fog = new THREE.Fog("#05060a", 20, 70);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  camera.position.set(0, 3.2, 6.5);
  camera.lookAt(0, 0.8, -6);

  scene.add(new THREE.HemisphereLight("#6b7cff", "#05060a", 0.8));
  const key = new THREE.DirectionalLight("#ffffff", 1.6);
  key.position.set(3, 8, 4);
  scene.add(key);

  // Procedural grid texture for the track.
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#07080f";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#2d3cff";
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 30);
  tex.colorSpace = THREE.SRGBColorSpace;
  const track = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 120), new THREE.MeshStandardMaterial({ map: tex, emissive: "#0a0f40", emissiveIntensity: 0.6, roughness: 0.8 }));
  track.rotation.x = -Math.PI / 2;
  track.position.z = -50;
  scene.add(track);

  for (const x of [-3.9, 3.9]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 120), new THREE.MeshBasicMaterial({ color: x < 0 ? "#00e5ff" : "#ff2bd6" }));
    rail.position.set(x, 0.06, -50);
    scene.add(rail);
  }

  const player = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 4), new THREE.MeshStandardMaterial({ color: "#e8ecff", metalness: 0.6, roughness: 0.25, emissive: "#3343ff", emissiveIntensity: 0.35 }));
  body.rotation.x = -Math.PI / 2;
  player.add(body);
  const glow = new THREE.PointLight("#00e5ff", 6, 4);
  glow.position.set(0, 0, 0.7);
  player.add(glow);
  player.position.set(0, 0.55, 0);
  scene.add(player);

  return { scene, camera, player, track, lanes: [-2.4, 0, 2.4] };
}
`,
    },
    {
      path: "obstacles.js",
      content: `import * as THREE from "three";

const COLORS = ["#ff2bd6", "#ffb020", "#00ff9c"];

/** Spawns, moves and recycles obstacles; collision via axis-aligned bounding boxes. */
export class Obstacles {
  constructor(scene, lanes) {
    this.scene = scene;
    this.lanes = lanes;
    this.items = [];
    this.box = new THREE.Box3();
    this.geometry = new THREE.BoxGeometry(1.4, 1.1, 1.1);
    this.spawnIn = 0;
  }

  reset() {
    for (const m of this.items) this.scene.remove(m);
    this.items = [];
    this.spawnIn = 0.6;
  }

  spawn() {
    // Leave at least one lane free so every row is passable.
    const free = Math.floor(Math.random() * this.lanes.length);
    this.lanes.forEach((x, i) => {
      if (i === free || Math.random() < 0.45) return;
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const m = new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4 }));
      m.position.set(x, 0.55, -70);
      this.scene.add(m);
      this.items.push(m);
    });
  }

  update(dt, speed) {
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawn();
      this.spawnIn = Math.max(0.35, 14 / speed) * (0.8 + Math.random() * 0.4);
    }
    for (const m of this.items) {
      m.position.z += speed * dt;
      m.rotation.y += dt;
    }
    const alive = [];
    for (const m of this.items) {
      if (m.position.z > 8) {
        this.scene.remove(m);
        m.material.dispose();
      } else alive.push(m);
    }
    this.items = alive;
  }

  collides(playerBox) {
    return this.items.some((m) => this.box.setFromObject(m).intersectsBox(playerBox));
  }
}
`,
    },
  ];
}
