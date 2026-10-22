// Example project: 3D product configurator (React + react-three-fiber + drei).
export function configuratorFiles(): { path: string; content: string }[] {
  return [
    {
      path: "index.html",
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aero Speaker — Configurator</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`,
    },
    {
      path: "src/main.tsx",
      content: `import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
`,
    },
    {
      path: "src/options.ts",
      content: `export type Finish = { id: string; name: string; color: string; metalness: number; roughness: number };

export const SHELL_FINISHES: Finish[] = [
  { id: "graphite", name: "Graphite", color: "#2b2e35", metalness: 0.6, roughness: 0.35 },
  { id: "silver", name: "Silver", color: "#c9ccd2", metalness: 1, roughness: 0.25 },
  { id: "sand", name: "Sand", color: "#d8c7a7", metalness: 0.1, roughness: 0.7 },
  { id: "forest", name: "Forest", color: "#2f4b3a", metalness: 0.2, roughness: 0.6 },
];

export const FABRIC_COLORS = [
  { id: "charcoal", name: "Charcoal", color: "#1c1d21" },
  { id: "stone", name: "Stone", color: "#8b8a86" },
  { id: "clay", name: "Clay", color: "#b0644a" },
  { id: "ocean", name: "Ocean", color: "#2f5b8a" },
];

export const ACCENTS = [
  { id: "copper", name: "Copper", color: "#c27a4a" },
  { id: "gold", name: "Gold", color: "#d4af37" },
  { id: "chrome", name: "Chrome", color: "#e6e8ec" },
];

export const BASE_PRICE = 349;
export const SURCHARGE: Record<string, number> = { silver: 30, gold: 25 };
`,
    },
    {
      path: "src/Speaker.tsx",
      content: `import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { Group } from "three";

type Props = { shell: { color: string; metalness: number; roughness: number }; fabric: string; accent: string; exploded: boolean; spin: boolean };

export function Speaker({ shell, fabric, accent, exploded, spin }: Props) {
  const group = useRef<Group>(null);
  const grille = useRef<Group>(null);
  useFrame((_, dt) => {
    if (spin && group.current) group.current.rotation.y += dt * 0.35;
    if (grille.current) grille.current.position.z += ((exploded ? 0.75 : 0.36) - grille.current.position.z) * Math.min(1, dt * 6);
  });
  return (
    <group ref={group} position={[0, 1.05, 0]}>
      <RoundedBox args={[1.4, 2, 0.7]} radius={0.16} smoothness={6} castShadow receiveShadow>
        <meshPhysicalMaterial color={shell.color} metalness={shell.metalness} roughness={shell.roughness} clearcoat={0.4} />
      </RoundedBox>
      <group ref={grille} position={[0, 0, 0.36]}>
        <RoundedBox args={[1.22, 1.82, 0.04]} radius={0.12} smoothness={4} castShadow>
          <meshStandardMaterial color={fabric} roughness={0.95} />
        </RoundedBox>
        {[0.45, -0.3].map((y, i) => (
          <mesh key={i} position={[0, y, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[i === 0 ? 0.22 : 0.36, 0.012, 16, 96]} />
            <meshStandardMaterial color={accent} metalness={1} roughness={0.2} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, -1.05, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.56, 0.1, 64]} />
        <meshStandardMaterial color={accent} metalness={1} roughness={0.25} />
      </mesh>
    </group>
  );
}
`,
    },
    {
      path: "src/Stage.tsx",
      content: `import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { Speaker } from "./Speaker";
import type { Finish } from "./options";

export function Stage(props: { shell: Finish; fabric: string; accent: string; exploded: boolean; spin: boolean }) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [3.2, 2.2, 4.2], fov: 38 }}>
      <color attach="background" args={["#0d0e12"]} />
      <ambientLight intensity={0.3} />
      <spotLight position={[4, 6, 4]} angle={0.45} penumbra={0.6} intensity={90} castShadow shadow-mapSize={[2048, 2048]} />
      <Speaker shell={props.shell} fabric={props.fabric} accent={props.accent} exploded={props.exploded} spin={props.spin} />
      <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={8} blur={2.4} far={3} />
      {/* Local light-former environment: no network fetch needed */}
      <Environment resolution={256}>
        <Lightformer intensity={2} position={[0, 4, -6]} scale={[10, 4, 1]} />
        <Lightformer intensity={1.2} position={[-5, 2, 2]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} />
        <Lightformer intensity={1.2} position={[5, 2, 2]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} color="#ffd9b8" />
      </Environment>
      <OrbitControls makeDefault enablePan={false} minDistance={3} maxDistance={9} minPolarAngle={0.3} maxPolarAngle={Math.PI / 2.05} target={[0, 1, 0]} />
    </Canvas>
  );
}
`,
    },
    {
      path: "src/App.tsx",
      content: `import { useMemo, useState } from "react";
import { RotateCw, Layers, ShoppingBag } from "lucide-react";
import { Stage } from "./Stage";
import { ACCENTS, BASE_PRICE, FABRIC_COLORS, SHELL_FINISHES, SURCHARGE } from "./options";

function Swatches<T extends { id: string; name: string; color: string }>({ label, items, value, onChange }: { label: string; items: T[]; value: string; onChange: (id: string) => void }) {
  return (
    <fieldset className="group">
      <legend>{label} <span>{items.find((i) => i.id === value)?.name}</span></legend>
      <div className="swatches">
        {items.map((i) => (
          <button key={i.id} className={i.id === value ? "swatch on" : "swatch"} style={{ background: i.color }} aria-label={i.name} aria-pressed={i.id === value} onClick={() => onChange(i.id)} />
        ))}
      </div>
    </fieldset>
  );
}

export function App() {
  const [shell, setShell] = useState("graphite");
  const [fabric, setFabric] = useState("charcoal");
  const [accent, setAccent] = useState("copper");
  const [exploded, setExploded] = useState(false);
  const [spin, setSpin] = useState(true);
  const [added, setAdded] = useState(false);
  const finish = SHELL_FINISHES.find((f) => f.id === shell)!;
  const price = useMemo(() => BASE_PRICE + (SURCHARGE[shell] ?? 0) + (SURCHARGE[accent] ?? 0), [shell, accent]);
  return (
    <div className="layout">
      <section className="viewer" aria-label="3D product view">
        <Stage shell={finish} fabric={FABRIC_COLORS.find((f) => f.id === fabric)!.color} accent={ACCENTS.find((a) => a.id === accent)!.color} exploded={exploded} spin={spin} />
        <div className="viewer-tools">
          <button onClick={() => setSpin(!spin)} aria-pressed={spin}><RotateCw size={16} /> {spin ? "Stop" : "Spin"}</button>
          <button onClick={() => setExploded(!exploded)} aria-pressed={exploded}><Layers size={16} /> {exploded ? "Assemble" : "Inspect grille"}</button>
        </div>
        <p className="hint">Drag to rotate · scroll to zoom</p>
      </section>
      <aside className="panel">
        <p className="eyebrow">Aero Speaker</p>
        <h1>Configure yours</h1>
        <p className="muted">Room-filling sound in a sculpted enclosure. Every finish is made to order.</p>
        <Swatches label="Shell" items={SHELL_FINISHES} value={shell} onChange={setShell} />
        <Swatches label="Fabric" items={FABRIC_COLORS} value={fabric} onChange={setFabric} />
        <Swatches label="Accent" items={ACCENTS} value={accent} onChange={setAccent} />
        <div className="buy">
          <div><span className="muted">Total</span><strong>\${price}</strong></div>
          <button className="primary" onClick={() => setAdded(true)}><ShoppingBag size={16} /> {added ? "Added to bag" : "Add to bag"}</button>
        </div>
      </aside>
    </div>
  );
}
`,
    },
    {
      path: "src/styles.css",
      content: `:root { --bg: #0d0e12; --panel: #14161c; --line: #262934; --fg: #eef0f4; --muted: #949aa8; --accent: #c27a4a; font-family: system-ui, sans-serif; color-scheme: dark; }
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; background: var(--bg); color: var(--fg); }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 380px; height: 100%; }
.viewer { position: relative; min-height: 420px; }
.viewer-tools { position: absolute; left: 20px; bottom: 20px; display: flex; gap: 8px; }
.viewer-tools button { display: inline-flex; gap: 6px; align-items: center; padding: 8px 12px; border-radius: 999px; border: 1px solid var(--line); background: #14161ccc; color: var(--fg); cursor: pointer; font: inherit; font-size: 13px; backdrop-filter: blur(8px); }
.viewer-tools button[aria-pressed="true"] { border-color: var(--accent); }
.hint { position: absolute; right: 20px; bottom: 16px; margin: 0; color: var(--muted); font-size: 12px; }
.panel { border-left: 1px solid var(--line); background: var(--panel); padding: 32px 28px; display: flex; flex-direction: column; gap: 18px; overflow: auto; }
.eyebrow { margin: 0; color: var(--accent); font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; } .muted { color: var(--muted); margin: 0; }
.group { border: 0; padding: 0; margin: 0; } .group legend { font-size: 14px; margin-bottom: 10px; } .group legend span { color: var(--muted); margin-left: 6px; }
.swatches { display: flex; gap: 10px; }
.swatch { width: 36px; height: 36px; border-radius: 50%; border: 2px solid transparent; outline: 1px solid var(--line); cursor: pointer; transition: transform .15s; }
.swatch:hover { transform: scale(1.06); } .swatch.on { border-color: var(--bg); outline: 2px solid var(--fg); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.buy { margin-top: auto; display: flex; align-items: center; justify-content: space-between; padding-top: 18px; border-top: 1px solid var(--line); }
.buy div { display: grid; } .buy strong { font-size: 26px; }
.primary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 18px; border-radius: 12px; border: 0; background: var(--fg); color: var(--bg); font: inherit; font-weight: 600; cursor: pointer; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; grid-template-rows: 55vh auto; height: auto; } .panel { border-left: 0; border-top: 1px solid var(--line); } }
`,
    },
  ];
}
