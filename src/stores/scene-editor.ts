"use client";

import { create } from "zustand";
import { createObject, type LightSpec, type SceneObject, type SceneObjectType, type SceneSpec } from "@/lib/schemas/scene";

export type Selection = { kind: "object"; id: string } | { kind: "light"; id: string } | { kind: "scene" } | null;

type State = {
  scene: SceneSpec | null;
  past: SceneSpec[];
  future: SceneSpec[];
  selection: Selection;
  mode: "edit" | "play";
  transformMode: "translate" | "rotate" | "scale";
  playing: boolean;
  speed: number;
  dirty: boolean;
  revision: number;
  lastCoalesce: { key: string; at: number } | null;
};

type Actions = {
  load: (scene: SceneSpec) => void;
  update: (fn: (s: SceneSpec) => void, coalesceKey?: string) => void;
  updateObject: (id: string, fn: (o: SceneObject) => void, coalesceKey?: string) => void;
  updateLight: (id: string, fn: (l: LightSpec) => void, coalesceKey?: string) => void;
  replaceScene: (scene: SceneSpec) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  addObject: (type: SceneObjectType) => void;
  addLight: (type: LightSpec["type"]) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  setMode: (m: "edit" | "play") => void;
  setTransformMode: (m: State["transformMode"]) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  seek: (t: number) => void;
  markSaved: () => void;
};

const clone = <T,>(v: T): T => structuredClone(v);
let idCounter = 0;
export function newId(prefix: string, existing: Set<string>) {
  let id: string;
  do id = `${prefix}-${Date.now().toString(36).slice(-4)}${(idCounter++).toString(36)}`;
  while (existing.has(id));
  return id;
}

const HISTORY_LIMIT = 100;

/** Timeline time in seconds, mutated every frame by the renderer (kept outside React state on purpose). */
export const sceneClock = { t: 0 };

export const useSceneEditor = create<State & Actions>((set, get) => {
  const commit = (next: SceneSpec, coalesceKey?: string) => {
    const { scene, past, lastCoalesce } = get();
    if (!scene) return;
    const now = Date.now();
    const coalesce = coalesceKey && lastCoalesce && lastCoalesce.key === coalesceKey && now - lastCoalesce.at < 800;
    set({
      scene: next,
      past: coalesce ? past : [...past, scene].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      revision: get().revision + 1,
      lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : null,
    });
  };
  return {
    scene: null,
    past: [],
    future: [],
    selection: null,
    mode: "edit",
    transformMode: "translate",
    playing: true,
    speed: 1,
    dirty: false,
    revision: 0,
    lastCoalesce: null,

    load: (scene) => {
      sceneClock.t = 0;
      set({ scene, past: [], future: [], selection: null, dirty: false, revision: 0, mode: "edit" });
    },
    update: (fn, key) => {
      const s = get().scene;
      if (!s) return;
      const next = clone(s);
      fn(next);
      commit(next, key);
    },
    updateObject: (id, fn, key) =>
      get().update((s) => {
        const o = s.objects.find((x) => x.id === id);
        if (o) fn(o);
      }, key ? `${id}:${key}` : undefined),
    updateLight: (id, fn, key) =>
      get().update((s) => {
        const l = s.lights.find((x) => x.id === id);
        if (l) fn(l);
      }, key ? `${id}:${key}` : undefined),
    replaceScene: (scene) => {
      commit(scene);
      set({ selection: null });
    },
    undo: () => {
      const { past, scene, future } = get();
      if (!past.length || !scene) return;
      set({ scene: past[past.length - 1], past: past.slice(0, -1), future: [scene, ...future], dirty: true, revision: get().revision + 1, lastCoalesce: null });
    },
    redo: () => {
      const { past, scene, future } = get();
      if (!future.length || !scene) return;
      set({ scene: future[0], future: future.slice(1), past: [...past, scene], dirty: true, revision: get().revision + 1, lastCoalesce: null });
    },
    select: (selection) => set({ selection }),
    addObject: (type) => {
      const s = get().scene;
      if (!s) return;
      const ids = new Set([...s.objects.map((o) => o.id), ...s.lights.map((l) => l.id)]);
      const id = newId(type.toLowerCase(), ids);
      const sel = get().selection;
      const parentId = sel?.kind === "object" && s.objects.find((o) => o.id === sel.id)?.type === "group" ? sel.id : null;
      get().update((d) => {
        d.objects.push(createObject(type, id, { parentId, name: `${type[0].toUpperCase()}${type.slice(1)} ${d.objects.filter((o) => o.type === type).length + 1}` }));
      });
      set({ selection: { kind: "object", id } });
    },
    addLight: (type) => {
      const s = get().scene;
      if (!s) return;
      const ids = new Set([...s.objects.map((o) => o.id), ...s.lights.map((l) => l.id)]);
      const id = newId(type, ids);
      get().update((d) => {
        d.lights.push({ id, name: `${type[0].toUpperCase()}${type.slice(1)} light`, type, color: "#ffffff", groundColor: "#202028", intensity: type === "point" || type === "spot" ? 30 : 1, position: [3, 5, 3], castShadow: type === "directional" || type === "spot", distance: 0, angle: 0.6 });
      });
      set({ selection: { kind: "light", id } });
    },
    removeSelected: () => {
      const sel = get().selection;
      if (!sel || sel.kind === "scene") return;
      get().update((d) => {
        if (sel.kind === "light") d.lights = d.lights.filter((l) => l.id !== sel.id);
        else {
          // Remove the object and all of its descendants.
          const doomed = new Set([sel.id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const o of d.objects) if (o.parentId && doomed.has(o.parentId) && !doomed.has(o.id)) {
              doomed.add(o.id);
              grew = true;
            }
          }
          d.objects = d.objects.filter((o) => !doomed.has(o.id));
        }
      });
      set({ selection: null });
    },
    duplicateSelected: () => {
      const sel = get().selection;
      const s = get().scene;
      if (!s || !sel || sel.kind !== "object") return;
      const src = s.objects.find((o) => o.id === sel.id);
      if (!src) return;
      const ids = new Set([...s.objects.map((o) => o.id), ...s.lights.map((l) => l.id)]);
      const id = newId(src.type.toLowerCase(), ids);
      get().update((d) => {
        d.objects.push({ ...clone(src), id, name: `${src.name} copy`, position: [src.position[0] + 0.6, src.position[1], src.position[2] + 0.6] });
      });
      set({ selection: { kind: "object", id } });
    },
    setMode: (mode) => set({ mode, selection: mode === "play" ? null : get().selection }),
    setTransformMode: (transformMode) => set({ transformMode }),
    setPlaying: (playing) => set({ playing }),
    setSpeed: (speed) => set({ speed }),
    seek: (t) => {
      sceneClock.t = Math.max(0, t);
    },
    markSaved: () => set({ dirty: false }),
  };
});

/** Deterministic animation state at time t (seconds). Used by the renderer and the timeline scrubber. */
export function animationAt(o: SceneObject, t: number) {
  const a = o.animation;
  const out = { dx: 0, dy: 0, dz: 0, spin: 0, scale: 1 };
  switch (a.type) {
    case "spin":
      out.spin = a.speed * t;
      break;
    case "orbit": {
      const ang = a.phase + t * a.speed;
      out.dx = Math.cos(ang) * a.radius;
      out.dz = Math.sin(ang) * a.radius;
      break;
    }
    case "float":
      out.dy = Math.sin(a.phase + t * a.speed * Math.PI * 2) * a.radius;
      break;
    case "pulse":
      out.scale = 1 + Math.sin(a.phase + t * a.speed * Math.PI * 2) * (a.radius || 0.1);
      break;
  }
  return out;
}
