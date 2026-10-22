"use client";
/* eslint-disable react-hooks/immutability -- three.js objects (renderer, camera, scene, per-frame player state) are mutated imperatively inside effects and useFrame callbacks, which is the intended react-three-fiber pattern and is never done during render. */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Edges, Environment, GizmoHelper, GizmoViewport, Grid, Html, Lightformer, OrbitControls, TransformControls } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { LightSpec, SceneObject, SceneSpec } from "@/lib/schemas/scene";
import { animationAt, sceneClock, useSceneEditor } from "@/stores/scene-editor";

// ─── Helpers ─────────────────────────────────────────────────────────────

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function useGeometry(o: SceneObject): THREE.BufferGeometry | null {
  const p = o.params;
  return useMemo(() => {
    const seg = Math.max(3, p.detail);
    switch (o.type) {
      case "sphere":
        return new THREE.SphereGeometry(p.size, seg, Math.max(2, Math.round(seg * 0.75)));
      case "box":
        return new THREE.BoxGeometry(p.size, p.size2 || p.size, p.size3 || p.size);
      case "torus":
        return new THREE.TorusGeometry(p.size, Math.max(0.001, p.size2), 24, seg);
      case "torusKnot":
        return new THREE.TorusKnotGeometry(p.size, Math.max(0.001, p.size2), seg, 24);
      case "plane":
        return new THREE.PlaneGeometry(p.size, p.size2 || p.size);
      case "cylinder":
        return new THREE.CylinderGeometry(p.size, p.size, p.size2 || 1, seg);
      case "cone":
        return new THREE.ConeGeometry(p.size, p.size2 || 1, seg);
      case "icosahedron":
        return new THREE.IcosahedronGeometry(p.size, Math.min(p.detail, 6));
      case "ring":
        return new THREE.RingGeometry(Math.min(p.size, p.size2), Math.max(p.size, p.size2), seg);
      case "terrain": {
        const g = new THREE.PlaneGeometry(p.size, p.size, Math.min(seg, 256), Math.min(seg, 256));
        const r = rng(p.seed);
        const a = [r() * 10, r() * 10, r() * 10];
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) / p.size;
          const y = pos.getY(i) / p.size;
          const h = Math.sin(x * 6 + a[0]) * Math.cos(y * 5 + a[1]) * 0.6 + Math.sin(x * 13 + y * 11 + a[2]) * 0.25 + Math.cos(x * 23 - y * 19) * 0.1;
          pos.setZ(i, h * p.amplitude);
        }
        g.computeVertexNormals();
        g.rotateX(-Math.PI / 2);
        return g;
      }
      default:
        return null;
    }
  }, [o.type, p.size, p.size2, p.size3, p.detail, p.amplitude, p.seed]);
}

function MaterialFor({ o, highlight }: { o: SceneObject; highlight: boolean }) {
  const m = o.material;
  const common = { color: m.color, transparent: m.opacity < 1, opacity: m.opacity, wireframe: m.wireframe, side: o.type === "plane" || o.type === "ring" ? THREE.DoubleSide : THREE.FrontSide };
  const emissiveIntensity = m.emissiveIntensity + (highlight ? 0.8 : 0);
  const emissive = highlight && m.emissive === "#000000" ? "#333344" : m.emissive;
  switch (m.type) {
    case "basic":
      return <meshBasicMaterial {...common} />;
    case "normal":
      return <meshNormalMaterial wireframe={m.wireframe} flatShading={m.flatShading} />;
    case "toon":
      return <meshToonMaterial {...common} emissive={emissive} emissiveIntensity={emissiveIntensity} />;
    case "physical":
      return <meshPhysicalMaterial key={`p${m.flatShading}`} {...common} emissive={emissive} emissiveIntensity={emissiveIntensity} metalness={m.metalness} roughness={m.roughness} flatShading={m.flatShading} clearcoat={0.3} />;
    default:
      return <meshStandardMaterial key={`s${m.flatShading}`} {...common} emissive={emissive} emissiveIntensity={emissiveIntensity} metalness={m.metalness} roughness={m.roughness} flatShading={m.flatShading} />;
  }
}

function Points({ o }: { o: SceneObject }) {
  const geo = useMemo(() => {
    const r = rng(o.params.seed);
    const n = Math.min(o.params.count, 20000);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const rad = o.type === "starfield" ? o.params.size * (0.6 + r() * 0.4) : o.params.size * Math.cbrt(r());
      const th = r() * Math.PI * 2;
      const ph = Math.acos(2 * r() - 1);
      arr[i * 3] = rad * Math.sin(ph) * Math.cos(th);
      arr[i * 3 + 1] = rad * Math.sin(ph) * Math.sin(th);
      arr[i * 3 + 2] = rad * Math.cos(ph);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, [o.type, o.params.count, o.params.size, o.params.seed]);
  return (
    <points geometry={geo} userData={{ objectId: o.id }}>
      <pointsMaterial color={o.material.color} size={o.type === "starfield" ? 0.6 : 0.06} sizeAttenuation={o.type !== "starfield"} transparent opacity={o.material.opacity} depthWrite={false} />
    </points>
  );
}

function TextPlane({ o }: { o: SceneObject }) {
  const { texture, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    const font = "600 96px Geist, system-ui, sans-serif";
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(o.params.text || " ").width) + 40;
    c.width = w;
    c.height = 140;
    ctx.font = font;
    ctx.fillStyle = o.material.color;
    ctx.textBaseline = "middle";
    ctx.fillText(o.params.text, 20, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { texture: t, aspect: w / 140 };
  }, [o.params.text, o.material.color]);
  const h = o.params.size * 1.4;
  return (
    <Billboard>
      <mesh userData={{ objectId: o.id }}>
        <planeGeometry args={[h * aspect, h]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} opacity={o.material.opacity} />
      </mesh>
    </Billboard>
  );
}

// ─── Object node ─────────────────────────────────────────────────────────

type NodeCtx = {
  children: Map<string | null, SceneObject[]>;
  selectedId: string | null;
  mode: "edit" | "play";
  registry: Map<string, THREE.Group>;
  paused: Set<string>;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  onPick: (o: SceneObject) => void;
  dragging: React.MutableRefObject<string | null>;
  playerState: React.MutableRefObject<PlayerState>;
};

function ObjectNode({ o, ctx }: { o: SceneObject; ctx: NodeCtx }) {
  const outer = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const geometry = useGeometry(o);
  const kids = ctx.children.get(o.id) ?? [];

  useEffect(() => {
    const g = outer.current;
    if (!g) return;
    ctx.registry.set(o.id, g);
    return () => {
      ctx.registry.delete(o.id);
    };
  }, [o.id, ctx.registry]);

  useFrame(() => {
    const g = outer.current;
    const s = spinner.current;
    if (!g || !s) return;
    if (ctx.dragging.current === o.id) return;
    const isPlayer = ctx.mode === "play" && o.role === "player";
    const t = ctx.paused.has(o.id) ? 0 : sceneClock.t;
    const a = animationAt(o, t);
    if (isPlayer) {
      const p = ctx.playerState.current;
      g.position.set(p.x, o.position[1], p.z);
    } else g.position.set(o.position[0] + a.dx, o.position[1] + a.dy, o.position[2] + a.dz);
    g.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
    g.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    s.rotation.set(0, 0, 0);
    s.rotation[o.animation.axis] = a.spin;
    s.scale.setScalar(a.scale);
    const hidden = ctx.mode === "play" && ctx.playerState.current.collected.has(o.id);
    g.visible = o.visible && !hidden;
  });

  const selected = ctx.selectedId === o.id;
  const highlight = ctx.mode === "play" ? o.interaction === "hover-highlight" && ctx.hovered === o.id : false;
  const handlers = {
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      ctx.onPick(o);
    },
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      ctx.setHovered(o.id);
    },
    onPointerOut: () => ctx.setHovered(null),
  };

  let visual: ReactNode = null;
  if (o.type === "particles" || o.type === "starfield") visual = <Points o={o} />;
  else if (o.type === "text") visual = <TextPlane o={o} />;
  else if (geometry)
    visual = (
      <mesh geometry={geometry} castShadow={o.castShadow} receiveShadow={o.receiveShadow} userData={{ objectId: o.id }}>
        <MaterialFor o={o} highlight={highlight} />
        {selected && ctx.mode === "edit" && <Edges threshold={20} color="#9aa6ff" />}
      </mesh>
    );

  return (
    <group ref={outer} name={o.id}>
      <group ref={spinner} {...(o.type !== "starfield" ? handlers : {})}>
        {visual}
        {o.type === "group" && kids.map((c) => <ObjectNode key={c.id} o={c} ctx={ctx} />)}
      </group>
      {o.type !== "group" && kids.map((c) => <ObjectNode key={c.id} o={c} ctx={ctx} />)}
      {o.label && (
        <Html position={[0, (o.type === "text" ? o.params.size : o.params.size * Math.max(o.scale[1], 0.2)) + 0.35, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-md border border-white/10 bg-black/70 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur-sm">{o.label}</div>
        </Html>
      )}
    </group>
  );
}

// ─── Lights & environment ────────────────────────────────────────────────

function LightNode({ l, selected, onPick, mode }: { l: LightSpec; selected: boolean; onPick: () => void; mode: "edit" | "play" }) {
  const ref = useRef<THREE.Light>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const shadow = { "shadow-mapSize": [2048, 2048] as [number, number], "shadow-bias": -0.0004 };
  const marker =
    mode === "edit" && (l.type === "point" || l.type === "spot" || l.type === "directional") ? (
      <mesh position={l.position as [number, number, number]} onClick={(e) => { e.stopPropagation(); onPick(); }}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshBasicMaterial color={selected ? "#9aa6ff" : l.color} wireframe />
      </mesh>
    ) : null;
  switch (l.type) {
    case "ambient":
      return <ambientLight color={l.color} intensity={l.intensity} />;
    case "hemisphere":
      return <hemisphereLight args={[l.color, l.groundColor, l.intensity]} />;
    case "point":
      return (
        <>
          <pointLight ref={ref as React.Ref<THREE.PointLight>} color={l.color} intensity={l.intensity} distance={l.distance} decay={2} position={l.position as [number, number, number]} castShadow={l.castShadow} {...shadow} />
          {marker}
        </>
      );
    case "spot":
      return (
        <>
          <primitive object={target} position={[0, 0, 0]} />
          <spotLight color={l.color} intensity={l.intensity} distance={l.distance} angle={l.angle} penumbra={0.4} decay={2} position={l.position as [number, number, number]} castShadow={l.castShadow} target={target} {...shadow} />
          {marker}
        </>
      );
    default:
      return (
        <>
          <directionalLight color={l.color} intensity={l.intensity} position={l.position as [number, number, number]} castShadow={l.castShadow} {...shadow} shadow-camera-left={-25} shadow-camera-right={25} shadow-camera-top={25} shadow-camera-bottom={-25} />
          {marker}
        </>
      );
  }
}

const PRESETS: Record<string, { color: string; intensity: number; positions: [number, number, number][] }> = {
  studio: { color: "#ffffff", intensity: 2, positions: [[0, 5, -9], [-6, 2, 2], [6, 2, 2], [0, 6, 0]] },
  sunset: { color: "#ffb37a", intensity: 2.2, positions: [[-8, 1, -4], [6, 3, 4]] },
  night: { color: "#6b7cff", intensity: 0.8, positions: [[0, 6, -8], [5, 2, 5]] },
  city: { color: "#dfe7ff", intensity: 1.6, positions: [[-6, 3, -6], [6, 3, -6], [0, 8, 6]] },
};

function SceneEnvironment({ env }: { env: SceneSpec["environment"] }) {
  const { scene, gl } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = env.exposure;
  }, [gl, env.exposure]);
  useEffect(() => {
    scene.fog = env.fog ? new THREE.Fog(env.fogColor, env.fogNear, env.fogFar) : null;
  }, [scene, env.fog, env.fogColor, env.fogNear, env.fogFar]);
  const preset = env.preset !== "none" ? PRESETS[env.preset] : null;
  return (
    <>
      <color attach="background" args={[env.background]} />
      {preset && (
        // Reflection environment built locally from light formers (no HDR download).
        <Environment resolution={128} key={env.preset}>
          {preset.positions.map((p, i) => (
            <Lightformer key={i} form="rect" intensity={preset.intensity} color={preset.color} position={p} scale={[6, 3, 1]} target={[0, 0, 0]} />
          ))}
        </Environment>
      )}
      {env.grid && <Grid args={[40, 40]} cellColor="#2a2a35" sectionColor="#3a3a4a" fadeDistance={45} infiniteGrid position={[0, 0.001, 0]} />}
      {env.ground && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color={env.groundColor} roughness={1} />
        </mesh>
      )}
    </>
  );
}

// ─── Clock, camera, player, stats ────────────────────────────────────────

function ClockDriver({ duration, loop }: { duration: number; loop: boolean }) {
  useFrame((_, dt) => {
    const { playing, speed } = useSceneEditor.getState();
    if (!playing) return;
    let t = sceneClock.t + Math.min(dt, 0.1) * speed;
    if (t > duration) t = loop ? t % duration : duration;
    sceneClock.t = t;
  });
  return null;
}

type PlayerState = { x: number; z: number; score: number; collected: Set<string>; message: string | null };

function PlayerController({ scene, state, onHud }: { scene: SceneSpec; state: React.MutableRefObject<PlayerState>; onHud: (s: PlayerState) => void }) {
  const keys = useRef(new Set<string>());
  const player = scene.objects.find((o) => o.role === "player");
  const { camera } = useThree();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  useFrame((_, dt) => {
    if (!player) return;
    const s = state.current;
    const v = scene.controls.playerSpeed * Math.min(dt, 0.05);
    const k = keys.current;
    if (k.has("w") || k.has("arrowup")) s.z -= v;
    if (k.has("s") || k.has("arrowdown")) s.z += v;
    if (k.has("a") || k.has("arrowleft")) s.x -= v;
    if (k.has("d") || k.has("arrowright")) s.x += v;
    const b = scene.controls.bounds;
    s.x = Math.max(-b, Math.min(b, s.x));
    s.z = Math.max(-b, Math.min(b, s.z));
    let changed = false;
    for (const o of scene.objects) {
      if (o.role === "none" || o.role === "player" || s.collected.has(o.id)) continue;
      const a = animationAt(o, sceneClock.t);
      const dx = o.position[0] + a.dx - s.x;
      const dz = o.position[2] + a.dz - s.z;
      const d = Math.hypot(dx, dz);
      const reach = player.params.size + Math.max(o.params.size, 0.4) * 0.6;
      if (o.role === "collectible" && d < reach) {
        s.collected.add(o.id);
        s.score++;
        const total = scene.objects.filter((x) => x.role === "collectible").length;
        s.message = s.score === total ? `All ${total} collected. You win!` : null;
        changed = true;
      } else if (o.role === "obstacle" && d < reach) {
        s.x = player.position[0];
        s.z = player.position[2];
        s.message = "Hit an obstacle. Back to start.";
        changed = true;
      }
    }
    if (changed) onHud({ ...s, collected: new Set(s.collected) });
    camera.position.lerp(tmp.set(s.x, player.position[1] + 10, s.z + 10), 0.08);
    camera.lookAt(s.x, player.position[1], s.z);
  });
  return null;
}

export type PerfStats = { fps: number; calls: number; triangles: number; geometries: number };

function Stats({ onStats }: { onStats: (s: PerfStats) => void }) {
  const { gl } = useThree();
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, dt) => {
    acc.current.frames++;
    acc.current.time += dt;
    if (acc.current.time >= 0.5) {
      onStats({ fps: Math.round(acc.current.frames / acc.current.time), calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries });
      acc.current = { frames: 0, time: 0 };
    }
  });
  return null;
}

function CameraRig({ scene, controlsRef, resetNonce }: { scene: SceneSpec; controlsRef: React.MutableRefObject<OrbitControlsImpl | null>; resetNonce: number }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(scene.camera.position[0], scene.camera.position[1], scene.camera.position[2]);
    (camera as THREE.PerspectiveCamera).fov = scene.camera.fov;
    camera.updateProjectionMatrix();
    controlsRef.current?.target.set(scene.camera.target[0], scene.camera.target[1], scene.camera.target[2]);
    controlsRef.current?.update();
    // Only on explicit reset or when the camera spec itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce, JSON.stringify(scene.camera)]);
  return null;
}

function FocusDriver({ focusId, registry, controlsRef }: { focusId: string | null; registry: Map<string, THREE.Group>; controlsRef: React.MutableRefObject<OrbitControlsImpl | null> }) {
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!focusId || !controlsRef.current) return;
    const g = registry.get(focusId);
    if (!g) return;
    g.getWorldPosition(tmp);
    controlsRef.current.target.lerp(tmp, 0.08);
  });
  return null;
}

// ─── Root ────────────────────────────────────────────────────────────────

export type SceneViewHandle = { captureCamera: () => { position: number[]; target: number[] } | null };

function SceneContents({
  scene,
  onStats,
  resetNonce,
  handleRef,
  onHud,
}: {
  scene: SceneSpec;
  onStats: (s: PerfStats) => void;
  resetNonce: number;
  handleRef: React.MutableRefObject<SceneViewHandle | null>;
  onHud: (s: PlayerState) => void;
}) {
  const selection = useSceneEditor((s) => s.selection);
  const mode = useSceneEditor((s) => s.mode);
  const transformMode = useSceneEditor((s) => s.transformMode);
  const registry = useMemo(() => new Map<string, THREE.Group>(), []);
  const [paused, setPaused] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<THREE.Group | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const dragging = useRef<string | null>(null);
  const player = scene.objects.find((o) => o.role === "player");
  const playerState = useRef<PlayerState>({ x: player?.position[0] ?? 0, z: player?.position[2] ?? 0, score: 0, collected: new Set(), message: null });
  const { camera } = useThree();

  // Reset interaction state whenever play mode is entered or left.
  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    setPaused(new Set());
    setFocusId(null);
  }
  useEffect(() => {
    playerState.current = { x: player?.position[0] ?? 0, z: player?.position[2] ?? 0, score: 0, collected: new Set(), message: null };
    onHud(playerState.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    handleRef.current = {
      captureCamera: () => (controlsRef.current ? { position: camera.position.toArray().map((v) => +v.toFixed(3)), target: controlsRef.current.target.toArray().map((v) => +v.toFixed(3)) } : null),
    };
  }, [handleRef, camera]);

  const children = useMemo(() => {
    const m = new Map<string | null, SceneObject[]>();
    const ids = new Set(scene.objects.map((o) => o.id));
    for (const o of scene.objects) {
      const key = o.parentId && ids.has(o.parentId) ? o.parentId : null;
      m.set(key, [...(m.get(key) ?? []), o]);
    }
    return m;
  }, [scene.objects]);

  const selectedId = selection?.kind === "object" ? selection.id : null;
  useEffect(() => {
    // Resolve the selected object's group after it has mounted.
    const id = requestAnimationFrame(() => setSelectedGroup(selectedId ? (registry.get(selectedId) ?? null) : null));
    return () => cancelAnimationFrame(id);
  }, [selectedId, registry, scene.objects]);

  const ctx: NodeCtx = {
    children,
    selectedId,
    mode,
    registry,
    paused,
    hovered,
    setHovered: mode === "play" ? setHovered : () => {},
    onPick: (o) => {
      if (mode === "edit") useSceneEditor.getState().select({ kind: "object", id: o.id });
      else if (o.interaction === "click-focus") setFocusId(o.id);
      else if (o.interaction === "click-toggle-animation")
        setPaused((p) => {
          const n = new Set(p);
          if (n.has(o.id)) n.delete(o.id);
          else n.add(o.id);
          return n;
        });
    },
    dragging,
    playerState,
  };

  const selectedObj = selectedId ? scene.objects.find((o) => o.id === selectedId) : undefined;
  const playerMode = mode === "play" && scene.controls.mode === "player" && player;

  return (
    <>
      <ClockDriver duration={scene.timeline.duration} loop={scene.timeline.loop} />
      <CameraRig scene={scene} controlsRef={controlsRef} resetNonce={resetNonce} />
      <SceneEnvironment env={scene.environment} />
      {scene.lights.map((l) => (
        <LightNode key={l.id} l={l} mode={mode} selected={selection?.kind === "light" && selection.id === l.id} onPick={() => useSceneEditor.getState().select({ kind: "light", id: l.id })} />
      ))}
      {(children.get(null) ?? []).map((o) => (
        <ObjectNode key={o.id} o={o} ctx={ctx} />
      ))}
      {mode === "edit" && selectedGroup && selectedObj && (
        <TransformControls
          object={selectedGroup}
          mode={transformMode}
          size={0.8}
          onMouseDown={() => {
            dragging.current = selectedObj.id;
          }}
          onMouseUp={() => {
            const g = selectedGroup;
            const a = animationAt(selectedObj, sceneClock.t);
            const r = (v: number) => +v.toFixed(4);
            useSceneEditor.getState().updateObject(selectedObj.id, (o) => {
              o.position = [r(g.position.x - a.dx), r(g.position.y - a.dy), r(g.position.z - a.dz)];
              o.rotation = [r(g.rotation.x), r(g.rotation.y), r(g.rotation.z)];
              o.scale = [r(g.scale.x), r(g.scale.y), r(g.scale.z)];
            });
            dragging.current = null;
          }}
        />
      )}
      {playerMode ? (
        <PlayerController scene={scene} state={playerState} onHud={onHud} />
      ) : (
        <OrbitControls ref={controlsRef} makeDefault enableDamping autoRotate={mode === "play" && scene.camera.autoRotate} autoRotateSpeed={scene.camera.autoRotateSpeed * 2} />
      )}
      {mode === "play" && <FocusDriver focusId={focusId} registry={registry} controlsRef={controlsRef} />}
      {mode === "edit" && (
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>
      )}
      <Stats onStats={onStats} />
    </>
  );
}

class SceneErrorBoundary extends Component<{ children: ReactNode; resetKey: number }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : "The scene failed to render" };
  }
  componentDidUpdate(prev: { resetKey: number }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm font-medium">The 3D view crashed</p>
          <p className="max-w-sm font-mono text-xs text-muted-foreground">{this.state.error}</p>
          <p className="text-xs text-muted-foreground">Undo the last change or adjust the selected object. The scene data is unaffected.</p>
        </div>
      );
    return this.props.children;
  }
}

let webglSupport: boolean | null = null;
export function detectWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const c = document.createElement("canvas");
    webglSupport = Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}
const noopSubscribe = () => () => {};

export function SceneView({
  scene,
  onStats,
  resetNonce,
  handleRef,
  onHud,
}: {
  scene: SceneSpec;
  onStats: (s: PerfStats) => void;
  resetNonce: number;
  handleRef: React.MutableRefObject<SceneViewHandle | null>;
  onHud: (s: PlayerState) => void;
}) {
  // Client-only capability check; null during server rendering.
  const webgl = useSyncExternalStore(noopSubscribe, detectWebGL, () => null);
  const revision = useSceneEditor((s) => s.revision);
  if (webgl === false)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">WebGL is not available</p>
        <p className="max-w-sm text-xs text-muted-foreground">Your browser or device cannot create a WebGL context, so the 3D view cannot render. The scene can still be edited in the inspector and exported to code.</p>
      </div>
    );
  if (webgl === null) return null;
  return (
    <SceneErrorBoundary resetKey={revision}>
      <Canvas
        shadows={scene.environment.shadows}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        camera={{ position: scene.camera.position as [number, number, number], fov: scene.camera.fov, near: 0.1, far: 2000 }}
        onPointerMissed={() => useSceneEditor.getState().mode === "edit" && useSceneEditor.getState().select(null)}
      >
        <Suspense fallback={null}>
          <SceneContents scene={scene} onStats={onStats} resetNonce={resetNonce} handleRef={handleRef} onHud={onHud} />
        </Suspense>
      </Canvas>
    </SceneErrorBoundary>
  );
}

export type { PlayerState };
