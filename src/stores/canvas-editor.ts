"use client";

import { create } from "zustand";
import { makeNode, type CanvasDoc, type CanvasNode, type CanvasNodeType, type CanvasPage } from "@/lib/schemas/canvas";

export type Tool = "select" | "hand" | "frame" | "section" | "rect" | "ellipse" | "text";
export type Viewport = { x: number; y: number; zoom: number };

type State = {
  doc: CanvasDoc | null;
  revision: number;
  past: CanvasDoc[];
  future: CanvasDoc[];
  selection: string[];
  tool: Tool;
  viewport: Viewport;
  dirty: boolean;
  editVersion: number;
};

type Actions = {
  load: (doc: CanvasDoc, revision: number) => void;
  /** Apply a mutation as one undoable step. */
  mutate: (fn: (page: CanvasPage, doc: CanvasDoc) => void) => void;
  /** Mutate without a history entry (used during drags; call `checkpoint` before starting). */
  mutateLive: (fn: (page: CanvasPage, doc: CanvasDoc) => void) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  setSelection: (ids: string[]) => void;
  setTool: (t: Tool) => void;
  setViewport: (v: Viewport) => void;
  setRevision: (r: number) => void;
  markSaved: (version: number) => void;
  addNode: (type: CanvasNodeType, rect: { x: number; y: number; w: number; h: number }, over?: Partial<CanvasNode>) => string;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  reorder: (dir: "forward" | "backward" | "front" | "back") => void;
  addPage: () => void;
  setActivePage: (id: string) => void;
};

export function activePage(doc: CanvasDoc): CanvasPage {
  return doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0];
}

let seq = 0;
export const nodeId = (prefix = "n") => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Selection expanded to whole groups and to the children of selected frames. */
export function expandSelection(page: CanvasPage, ids: string[]): Set<string> {
  const out = new Set(ids);
  const groups = new Set(page.nodes.filter((n) => out.has(n.id) && n.groupId).map((n) => n.groupId));
  for (const n of page.nodes) if (n.groupId && groups.has(n.groupId)) out.add(n.id);
  const frames = new Set(page.nodes.filter((n) => out.has(n.id) && (n.type === "frame" || n.type === "section")).map((n) => n.id));
  for (const n of page.nodes) if (n.frameId && frames.has(n.frameId)) out.add(n.id);
  return out;
}

const HISTORY = 100;

export const useCanvasEditor = create<State & Actions>((set, get) => {
  const pushHistory = () => {
    const { doc, past } = get();
    if (doc) set({ past: [...past, structuredClone(doc)].slice(-HISTORY), future: [] });
  };
  const apply = (fn: (page: CanvasPage, doc: CanvasDoc) => void) => {
    const doc = get().doc;
    if (!doc) return;
    const next = structuredClone(doc);
    fn(activePage(next), next);
    set({ doc: next, dirty: true, editVersion: get().editVersion + 1 });
  };
  return {
    doc: null,
    revision: 0,
    past: [],
    future: [],
    selection: [],
    tool: "select",
    viewport: { x: 80, y: 60, zoom: 1 },
    dirty: false,
    editVersion: 0,

    load: (doc, revision) => set({ doc, revision, past: [], future: [], selection: [], dirty: false }),
    mutate: (fn) => {
      pushHistory();
      apply(fn);
    },
    mutateLive: (fn) => apply(fn),
    checkpoint: pushHistory,
    undo: () => {
      const { past, doc, future } = get();
      if (!past.length || !doc) return;
      set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], dirty: true, editVersion: get().editVersion + 1, selection: [] });
    },
    redo: () => {
      const { past, doc, future } = get();
      if (!future.length || !doc) return;
      set({ doc: future[0], future: future.slice(1), past: [...past, doc], dirty: true, editVersion: get().editVersion + 1, selection: [] });
    },
    setSelection: (selection) => set({ selection }),
    setTool: (tool) => set({ tool }),
    setViewport: (viewport) => set({ viewport }),
    setRevision: (revision) => set({ revision }),
    markSaved: (version) => {
      if (get().editVersion === version) set({ dirty: false });
    },
    addNode: (type, rect, over = {}) => {
      const id = nodeId(type[0]);
      get().mutate((page) => {
        // Nodes created inside a frame belong to it (they move with it).
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const frame = type === "frame" || type === "section" ? undefined : [...page.nodes].reverse().find((n) => (n.type === "frame" || n.type === "section") && cx >= n.x && cx <= n.x + n.w && cy >= n.y && cy <= n.y + n.h);
        const node = makeNode(type, id, { ...rect, frameId: frame?.id ?? null, name: `${type[0].toUpperCase()}${type.slice(1)} ${page.nodes.filter((n) => n.type === type).length + 1}`, ...over });
        if (type === "section") page.nodes.unshift(node);
        else page.nodes.push(node);
      });
      set({ selection: [id] });
      return id;
    },
    deleteSelection: () => {
      const { selection, doc } = get();
      if (!selection.length || !doc) return;
      const doomed = expandSelection(activePage(doc), selection);
      get().mutate((page) => {
        page.nodes = page.nodes.filter((n) => !doomed.has(n.id) || n.locked);
      });
      set({ selection: [] });
    },
    duplicateSelection: () => {
      const { selection, doc } = get();
      if (!selection.length || !doc) return;
      const page = activePage(doc);
      const ids = expandSelection(page, selection);
      const map = new Map<string, string>();
      for (const id of ids) map.set(id, nodeId("d"));
      const groupMap = new Map<string, string>();
      get().mutate((p) => {
        const copies = p.nodes
          .filter((n) => ids.has(n.id))
          .map((n) => ({
            ...structuredClone(n),
            id: map.get(n.id)!,
            name: `${n.name} copy`,
            x: n.x + 24,
            y: n.y + 24,
            frameId: n.frameId && map.has(n.frameId) ? map.get(n.frameId)! : n.frameId,
            groupId: n.groupId ? (groupMap.get(n.groupId) ?? (groupMap.set(n.groupId, nodeId("g")), groupMap.get(n.groupId)!)) : null,
            locked: false,
          }));
        p.nodes.push(...copies);
      });
      set({ selection: selection.map((s) => map.get(s)!).filter(Boolean) });
    },
    groupSelection: () => {
      const { selection } = get();
      if (selection.length < 2) return;
      const g = nodeId("g");
      get().mutate((p) => {
        for (const n of p.nodes) if (selection.includes(n.id)) n.groupId = g;
      });
    },
    ungroupSelection: () => {
      const { selection, doc } = get();
      if (!doc) return;
      const ids = expandSelection(activePage(doc), selection);
      get().mutate((p) => {
        for (const n of p.nodes) if (ids.has(n.id)) n.groupId = null;
      });
    },
    reorder: (dir) => {
      const { selection, doc } = get();
      if (!selection.length || !doc) return;
      const ids = expandSelection(activePage(doc), selection);
      get().mutate((p) => {
        const sel = p.nodes.filter((n) => ids.has(n.id));
        const rest = p.nodes.filter((n) => !ids.has(n.id));
        if (dir === "front") p.nodes = [...rest, ...sel];
        else if (dir === "back") p.nodes = [...sel, ...rest];
        else {
          const arr = [...p.nodes];
          const idxs = arr.map((n, i) => (ids.has(n.id) ? i : -1)).filter((i) => i >= 0);
          if (dir === "forward") {
            for (const i of idxs.reverse()) if (i < arr.length - 1 && !ids.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
          } else {
            for (const i of idxs) if (i > 0 && !ids.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
          }
          p.nodes = arr;
        }
      });
    },
    addPage: () => {
      const id = nodeId("page");
      get().mutate((_, d) => {
        d.pages.push({ id, name: `Page ${d.pages.length + 1}`, nodes: [] });
        d.activePageId = id;
      });
      set({ selection: [] });
    },
    setActivePage: (id) => {
      get().mutateLive((_, d) => {
        d.activePageId = id;
      });
      set({ selection: [] });
    },
  };
});

/** Alignment guides: snap a moving box to other boxes' edges and centers. */
export function snapBox(
  box: { x: number; y: number; w: number; h: number },
  others: { x: number; y: number; w: number; h: number }[],
  threshold: number,
): { dx: number; dy: number; guides: { axis: "x" | "y"; at: number }[] } {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  let best = { dx: 0, ax: Infinity, gx: null as number | null, dy: 0, ay: Infinity, gy: null as number | null };
  for (const o of others) {
    const oxs = [o.x, o.x + o.w / 2, o.x + o.w];
    const oys = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const a of xs) for (const b of oxs) if (Math.abs(b - a) < threshold && Math.abs(b - a) < best.ax) best = { ...best, dx: b - a, ax: Math.abs(b - a), gx: b };
    for (const a of ys) for (const b of oys) if (Math.abs(b - a) < threshold && Math.abs(b - a) < best.ay) best = { ...best, dy: b - a, ay: Math.abs(b - a), gy: b };
  }
  const guides: { axis: "x" | "y"; at: number }[] = [];
  if (best.gx !== null) guides.push({ axis: "x", at: best.gx });
  if (best.gy !== null) guides.push({ axis: "y", at: best.gy });
  return { dx: best.dx, dy: best.dy, guides };
}
