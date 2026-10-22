"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Check, Circle, Copy, Download, Frame, Group, Hand, History, Image as ImageIcon, Layers, Loader2, Lock, MousePointer2, Plus, Redo2, Sparkles, Square, Trash2, Type, Undo2, Ungroup, Upload, Video,
  Eye, EyeOff, ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, AppWindow, LayoutTemplate, Minus, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, RotateCcw,
} from "lucide-react";
import { activePage, expandSelection, snapBox, useCanvasEditor, type Tool } from "@/stores/canvas-editor";
import { CanvasDocSchema, makeNode, type CanvasDoc, type CanvasNode } from "@/lib/schemas/canvas";
import { api, ApiError, errorMessage, streamJob, timeAgo } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ColorInput, NumberInput, Row, Section, SliderInput } from "@/components/scene/fields";
import { cn } from "@/lib/utils";

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: "pan"; start: Pt; vp: { x: number; y: number } }
  | { kind: "create"; start: Pt; cur: Pt; tool: Tool }
  | { kind: "marquee"; start: Pt; cur: Pt; additive: boolean }
  | { kind: "move"; start: Pt; origin: Map<string, Pt>; primary: Rect; moved: boolean }
  | { kind: "resize"; start: Pt; id: string; handle: string; rect: Rect };

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const TOOLS: { id: Tool; icon: typeof MousePointer2; label: string; key: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select", key: "V" },
  { id: "hand", icon: Hand, label: "Pan", key: "H" },
  { id: "frame", icon: Frame, label: "Frame", key: "F" },
  { id: "section", icon: LayoutTemplate, label: "Section", key: "S" },
  { id: "rect", icon: Square, label: "Rectangle", key: "R" },
  { id: "ellipse", icon: Circle, label: "Ellipse", key: "O" },
  { id: "text", icon: Type, label: "Text", key: "T" },
];

function toEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get("v")) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.searchParams.get("v")!)}`;
    if (u.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
    if (/(^|\.)vimeo\.com$/.test(u.hostname) && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video/${u.pathname.split("/")[1]}`;
    if (u.hostname === "www.youtube-nocookie.com" || u.hostname === "player.vimeo.com") return url;
  } catch {
    /* invalid */
  }
  return null;
}

function ToolBtn({ active, label, onClick, children, disabled }: { active?: boolean; label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} className={cn("flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40", active && "bg-brand/15 text-brand")}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ─── Node rendering ──────────────────────────────────────────────────────

function ProjectEmbed({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api<{ project: { previewUrl: string | null } }>(`/api/projects/${projectId}`).then((r) => setUrl(r.project.previewUrl), () => setUrl(null));
  }, [projectId]);
  if (url === undefined) return <div className="flex size-full items-center justify-center text-xs text-muted-foreground">Loading preview…</div>;
  if (!url) return <div className="flex size-full items-center justify-center p-2 text-center text-xs text-muted-foreground">Project has no successful build</div>;
  return <iframe src={url} title="Project preview" sandbox="allow-scripts" className="pointer-events-none size-full border-0 bg-white" />;
}

function NodeView({ n, editing, onTextCommit }: { n: CanvasNode; editing: boolean; onTextCommit: (t: string) => void }) {
  const style: React.CSSProperties = {
    left: n.x,
    top: n.y,
    width: n.w,
    height: n.h,
    opacity: n.opacity,
    background: n.type === "text" || n.type === "image" || n.type === "video" || n.type === "project" ? undefined : n.fill,
    border: n.strokeWidth > 0 ? `${n.strokeWidth}px ${n.type === "section" ? "dashed" : "solid"} ${n.stroke}` : undefined,
    borderRadius: n.type === "ellipse" ? "50%" : n.radius,
  };
  return (
    <div data-node-id={n.id} className={cn("absolute", (n.type === "image" || n.type === "video" || n.type === "project") && "overflow-hidden bg-black/40")} style={style}>
      {(n.type === "frame" || n.type === "section") && (
        <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap text-[11px] text-muted-foreground" style={{ fontSize: 11 }}>{n.name}</span>
      )}
      {n.type === "text" &&
        (editing ? (
          <textarea
            autoFocus
            defaultValue={n.text}
            onBlur={(e) => onTextCommit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
              e.stopPropagation();
            }}
            className="size-full resize-none bg-transparent outline-none"
            style={{ color: n.color, fontSize: n.fontSize, fontWeight: n.fontWeight, textAlign: n.align, lineHeight: 1.2 }}
          />
        ) : (
          <div className="size-full whitespace-pre-wrap wrap-break-word" style={{ color: n.color, fontSize: n.fontSize, fontWeight: n.fontWeight, textAlign: n.align, lineHeight: 1.2 }}>{n.text}</div>
        ))}
      {n.type === "image" &&
        (n.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={n.src} alt={n.name} draggable={false} className="pointer-events-none size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground"><ImageIcon className="size-6" /></div>
        ))}
      {n.type === "video" && (n.src ? <iframe src={n.src} title={n.name} sandbox="allow-scripts allow-same-origin allow-presentation" allow="encrypted-media; picture-in-picture" className="pointer-events-none size-full border-0" /> : <div className="flex size-full items-center justify-center text-muted-foreground"><Video className="size-6" /></div>)}
      {n.type === "project" && n.src && <ProjectEmbed projectId={n.src} />}
    </div>
  );
}

// ─── Main editor ─────────────────────────────────────────────────────────

export function CanvasEditor({ canvasId }: { canvasId: string }) {
  const doc = useCanvasEditor((s) => s.doc);
  const selection = useCanvasEditor((s) => s.selection);
  const tool = useCanvasEditor((s) => s.tool);
  const vp = useCanvasEditor((s) => s.viewport);
  const dirty = useCanvasEditor((s) => s.dirty);
  const editVersion = useCanvasEditor((s) => s.editVersion);
  const canUndo = useCanvasEditor((s) => s.past.length > 0);
  const canRedo = useCanvasEditor((s) => s.future.length > 0);
  const st = useCanvasEditor.getState();
  const [name, setName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ axis: "x" | "y"; at: number }[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [space, setSpace] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiRun, setAiRun] = useState<{ jobId: string; tasks: Record<string, { description: string; status: string; error: string | null }> } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<{ id: string; label: string | null; createdAt: string }[] | null>(null);
  const [insert, setInsert] = useState<null | "image" | "video" | "project">(null);
  const [insertList, setInsertList] = useState<{ id: string; name: string; url?: string }[] | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [renamingPage, setRenamingPage] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const page = doc ? activePage(doc) : null;

  // Load
  useEffect(() => {
    api<{ canvas: { name: string; data: unknown; revision: number } }>(`/api/canvas/${canvasId}`).then(
      (r) => {
        const parsed = CanvasDocSchema.safeParse(r.canvas.data);
        if (!parsed.success) {
          setLoadError("This canvas document is invalid and cannot be opened.");
          return;
        }
        useCanvasEditor.getState().load(parsed.data, r.canvas.revision);
        setName(r.canvas.name);
      },
      (e) => setLoadError(errorMessage(e)),
    );
  }, [canvasId]);

  // Autosave with optimistic concurrency.
  // Saves are serialized: overlapping requests would send the same base revision and the
  // second would be rejected as a conflict with our own first save.
  const saveInFlight = useRef(false);
  const saveAgain = useRef(false);
  const save = useCallback(async (): Promise<void> => {
    if (saveInFlight.current) {
      saveAgain.current = true;
      return;
    }
    saveInFlight.current = true;
    try {
      // Loop until nothing changed while the previous request was in flight.
      do {
        saveAgain.current = false;
        const s = useCanvasEditor.getState();
        if (!s.doc || !s.dirty) return;
        const version = s.editVersion;
        setSaveState("saving");
        const r = await api<{ revision: number }>(`/api/canvas/${canvasId}`, { method: "PUT", json: { data: s.doc, revision: s.revision } });
        useCanvasEditor.getState().setRevision(r.revision);
        useCanvasEditor.getState().markSaved(version);
        setSaveState("saved");
      } while (saveAgain.current || useCanvasEditor.getState().dirty);
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        setSaveState("conflict");
        toast.error("This canvas was changed in another tab. Reload to continue.", { duration: 10000 });
      } else {
        setSaveState("error");
        toast.error(errorMessage(e));
      }
    } finally {
      saveInFlight.current = false;
    }
  }, [canvasId]);

  useEffect(() => {
    if (!dirty || drag || saveState === "conflict") return;
    const t = setTimeout(() => void save(), 1000);
    return () => clearTimeout(t);
  }, [dirty, editVersion, drag, save, saveState]);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const r = stageRef.current!.getBoundingClientRect();
    const v = useCanvasEditor.getState().viewport;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }, []);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const v = useCanvasEditor.getState().viewport;
    const cx = (clientX ?? r.left + r.width / 2) - r.left;
    const cy = (clientY ?? r.top + r.height / 2) - r.top;
    const zoom = Math.min(8, Math.max(0.1, v.zoom * factor));
    useCanvasEditor.getState().setViewport({ zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom });
  }, []);

  const zoomToFit = useCallback(() => {
    const s = useCanvasEditor.getState();
    const el = stageRef.current;
    if (!s.doc || !el) return;
    const nodes = activePage(s.doc).nodes.filter((n) => !n.hidden);
    if (!nodes.length) return s.setViewport({ x: 80, y: 60, zoom: 1 });
    const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w)), maxY = Math.max(...nodes.map((n) => n.y + n.h));
    const r = el.getBoundingClientRect();
    const zoom = Math.min(2, Math.max(0.1, Math.min((r.width - 120) / (maxX - minX), (r.height - 120) / (maxY - minY))));
    s.setViewport({ zoom, x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (r.height - (maxY - minY) * zoom) / 2 - minY * zoom });
  }, []);

  // Wheel: pan, or zoom with Ctrl/Cmd (native listener so preventDefault works).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      else {
        const v = useCanvasEditor.getState().viewport;
        useCanvasEditor.getState().setViewport({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, doc === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable=true], [role=combobox], [role=dialog]")) return;
      const s = useCanvasEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.code === "Space") {
        setSpace(true);
        e.preventDefault();
      } else if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && k === "y") s.redo();
      else if (mod && k === "d") {
        e.preventDefault();
        s.duplicateSelection();
      } else if (mod && k === "g") {
        e.preventDefault();
        if (e.shiftKey) s.ungroupSelection();
        else s.groupSelection();
      } else if (mod && k === "a") {
        e.preventDefault();
        if (s.doc) s.setSelection(activePage(s.doc).nodes.map((n) => n.id));
      } else if (mod && k === "s") {
        e.preventDefault();
        void save();
      } else if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        zoomAt(1.2);
      } else if (mod && k === "-") {
        e.preventDefault();
        zoomAt(1 / 1.2);
      } else if (e.shiftKey && k === "1") zoomToFit();
      else if (k === "delete" || k === "backspace") s.deleteSelection();
      else if (k === "]") s.reorder(mod ? "front" : "forward");
      else if (k === "[") s.reorder(mod ? "back" : "backward");
      else if (k === "escape") {
        s.setSelection([]);
        s.setTool("select");
      } else if (!mod) {
        const t = TOOLS.find((x) => x.key.toLowerCase() === k);
        if (t) s.setTool(t.id);
        if (k.startsWith("arrow") && s.selection.length && s.doc) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const ids = expandSelection(activePage(s.doc), s.selection);
          s.mutate((p) => {
            for (const n of p.nodes) if (ids.has(n.id) && !n.locked) {
              if (k === "arrowleft") n.x -= step;
              if (k === "arrowright") n.x += step;
              if (k === "arrowup") n.y -= step;
              if (k === "arrowdown") n.y += step;
            }
          });
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [save, zoomAt, zoomToFit]);

  // ─── Pointer interaction ──────────────────────────────────────────────

  function onStagePointerDown(e: React.PointerEvent) {
    if (!page) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || tool === "hand" || space) {
      setDrag({ kind: "pan", start: { x: e.clientX, y: e.clientY }, vp: { x: vp.x, y: vp.y } });
      return;
    }
    if (tool !== "select") {
      setDrag({ kind: "create", start: p, cur: p, tool });
      return;
    }
    const target = (e.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
    const handle = (e.target as HTMLElement).closest("[data-handle]") as HTMLElement | null;
    if (handle && selection.length === 1) {
      const n = page.nodes.find((x) => x.id === selection[0]);
      if (n && !n.locked) {
        st.checkpoint();
        setDrag({ kind: "resize", start: p, id: n.id, handle: handle.dataset.handle!, rect: { x: n.x, y: n.y, w: n.w, h: n.h } });
      }
      return;
    }
    if (target) {
      const id = target.dataset.nodeId!;
      const node = page.nodes.find((n) => n.id === id);
      if (!node) return;
      let sel = selection;
      if (e.shiftKey) sel = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
      else if (!selection.includes(id)) sel = node.groupId ? page.nodes.filter((n) => n.groupId === node.groupId).map((n) => n.id) : [id];
      st.setSelection(sel);
      const moving = expandSelection(page, sel);
      const origin = new Map<string, Pt>();
      for (const n of page.nodes) if (moving.has(n.id) && !n.locked) origin.set(n.id, { x: n.x, y: n.y });
      const sNodes = page.nodes.filter((n) => sel.includes(n.id));
      const primary = sNodes.length
        ? { x: Math.min(...sNodes.map((n) => n.x)), y: Math.min(...sNodes.map((n) => n.y)), w: Math.max(...sNodes.map((n) => n.x + n.w)) - Math.min(...sNodes.map((n) => n.x)), h: Math.max(...sNodes.map((n) => n.y + n.h)) - Math.min(...sNodes.map((n) => n.y)) }
        : { x: 0, y: 0, w: 0, h: 0 };
      if (origin.size) {
        st.checkpoint();
        setDrag({ kind: "move", start: p, origin, primary, moved: false });
      }
      return;
    }
    if (!e.shiftKey) st.setSelection([]);
    setDrag({ kind: "marquee", start: p, cur: p, additive: e.shiftKey });
  }

  function onStagePointerMove(e: React.PointerEvent) {
    if (!drag || !page) return;
    if (drag.kind === "pan") {
      st.setViewport({ ...vp, x: drag.vp.x + (e.clientX - drag.start.x), y: drag.vp.y + (e.clientY - drag.start.y) });
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (drag.kind === "create" || drag.kind === "marquee") {
      setDrag({ ...drag, cur: p });
      return;
    }
    if (drag.kind === "move") {
      let dx = p.x - drag.start.x;
      let dy = p.y - drag.start.y;
      if (!e.altKey) {
        const others = page.nodes.filter((n) => !drag.origin.has(n.id) && !n.hidden);
        const snap = snapBox({ ...drag.primary, x: drag.primary.x + dx, y: drag.primary.y + dy }, others, 6 / vp.zoom);
        dx += snap.dx;
        dy += snap.dy;
        setGuides(snap.guides);
      } else setGuides([]);
      st.mutateLive((pg) => {
        for (const n of pg.nodes) {
          const o = drag.origin.get(n.id);
          if (o) {
            n.x = Math.round(o.x + dx);
            n.y = Math.round(o.y + dy);
          }
        }
      });
      if (!drag.moved) setDrag({ ...drag, moved: true });
      return;
    }
    if (drag.kind === "resize") {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const r = { ...drag.rect };
      const h = drag.handle;
      if (h.includes("e")) r.w = drag.rect.w + dx;
      if (h.includes("s")) r.h = drag.rect.h + dy;
      if (h.includes("w")) {
        r.x = drag.rect.x + dx;
        r.w = drag.rect.w - dx;
      }
      if (h.includes("n")) {
        r.y = drag.rect.y + dy;
        r.h = drag.rect.h - dy;
      }
      if (e.shiftKey && drag.rect.h > 0) {
        const ratio = drag.rect.w / drag.rect.h;
        if (h === "n" || h === "s") r.w = r.h * ratio;
        else r.h = r.w / ratio;
      }
      if (r.w < 4) r.w = 4;
      if (r.h < 4) r.h = 4;
      st.mutateLive((pg) => {
        const n = pg.nodes.find((x) => x.id === drag.id);
        if (n) Object.assign(n, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      });
    }
  }

  function onStagePointerUp() {
    if (!drag || !page) return;
    if (drag.kind === "create") {
      const x = Math.min(drag.start.x, drag.cur.x), y = Math.min(drag.start.y, drag.cur.y);
      let w = Math.abs(drag.cur.x - drag.start.x), h = Math.abs(drag.cur.y - drag.start.y);
      const defaults = makeNode(drag.tool as CanvasNode["type"], "tmp");
      if (w < 6 && h < 6) {
        w = defaults.w;
        h = defaults.h;
      }
      const id = st.addNode(drag.tool as CanvasNode["type"], { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      st.setTool("select");
      if (drag.tool === "text") setEditingText(id);
    } else if (drag.kind === "marquee") {
      const r = { x: Math.min(drag.start.x, drag.cur.x), y: Math.min(drag.start.y, drag.cur.y), w: Math.abs(drag.cur.x - drag.start.x), h: Math.abs(drag.cur.y - drag.start.y) };
      if (r.w > 3 || r.h > 3) {
        const hit = page.nodes.filter((n) => !n.hidden && !n.locked && n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y && !(n.type === "section" && !(n.x >= r.x && n.x + n.w <= r.x + r.w))).map((n) => n.id);
        st.setSelection(drag.additive ? [...new Set([...selection, ...hit])] : hit);
      }
    } else if (drag.kind === "move") {
      if (!drag.moved) {
        // A click without movement: drop the history entry we reserved.
        useCanvasEditor.setState((s) => ({ past: s.past.slice(0, -1) }));
      } else {
        // Re-parent moved top-level nodes into/out of frames by their center.
        st.mutateLive((pg) => {
          for (const n of pg.nodes) {
            if (!drag.origin.has(n.id) || n.type === "frame" || n.type === "section") continue;
            if (n.frameId && drag.origin.has(n.frameId)) continue;
            const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
            const frame = [...pg.nodes].reverse().find((f) => (f.type === "frame" || f.type === "section") && f.id !== n.id && cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h);
            n.frameId = frame?.id ?? null;
          }
        });
      }
    }
    setDrag(null);
    setGuides([]);
  }

  // ─── AI frame generation ──────────────────────────────────────────────

  const selectedFrames = page ? page.nodes.filter((n) => selection.includes(n.id) && n.type === "frame") : [];

  async function runAI() {
    if (!page || !selectedFrames.length) return;
    const frames = selectedFrames.map((f) => ({
      id: f.id,
      name: f.name,
      w: f.w,
      h: f.h,
      existing: page.nodes.filter((n) => n.frameId === f.id && n.type === "text").map((n) => `text "${n.text.slice(0, 120)}"`).join("; ").slice(0, 4000),
    }));
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/canvas/${canvasId}/ai`, { method: "POST", json: { instruction: aiText.trim(), frames } });
      setAiRun({ jobId, tasks: {} });
      let failure: string | null = null;
      await streamJob(jobId, (e) => {
        if (e.type === "plan") setAiRun((r) => r && { ...r, tasks: Object.fromEntries(e.tasks.map((t) => [t.id, { description: t.description, status: t.status, error: null }])) });
        if (e.type === "task") setAiRun((r) => r && { ...r, tasks: { ...r.tasks, [e.task.id]: { description: e.task.description, status: e.task.status, error: e.task.error } } });
        if (e.type === "status" && (e.status === "failed" || e.status === "cancelled")) failure = e.message ?? e.status;
      });
      if (failure) throw new Error(failure);
      const r = await api<{ job: { output: { frames: { frameId: string; content: { frameFill: string; nodes: Omit<CanvasNode, "id" | "frameId" | "groupId" | "src" | "locked" | "hidden">[] } | null; error: string | null }[] } } }>(`/api/jobs/${jobId}`);
      const results = r.job.output.frames;
      st.mutate((pg) => {
        for (const res of results) {
          if (!res.content) continue;
          const frame = pg.nodes.find((n) => n.id === res.frameId);
          if (!frame) continue;
          if (/^#[0-9a-fA-F]{3,8}$/.test(res.content.frameFill)) frame.fill = res.content.frameFill;
          pg.nodes = pg.nodes.filter((n) => n.frameId !== frame.id);
          const idx = pg.nodes.indexOf(frame);
          const created = res.content.nodes.map((n, i) => makeNode(n.type, `${frame.id}-ai-${Date.now().toString(36)}-${i}`, { ...n, x: frame.x + n.x, y: frame.y + n.y, frameId: frame.id }));
          pg.nodes.splice(idx + 1, 0, ...created);
        }
      });
      const ok = results.filter((x) => x.content).length;
      toast.success(`Generated ${ok} of ${results.length} frame${results.length > 1 ? "s" : ""}`);
      for (const f of results.filter((x) => !x.content)) toast.error(`Frame failed: ${f.error ?? "unknown error"}`);
      setAiOpen(false);
      setAiText("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAiRun(null);
    }
  }

  // ─── Insert, history, export ──────────────────────────────────────────

  function viewportCenter(): Pt {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? toWorld(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 };
  }

  async function openInsert(kind: "image" | "video" | "project") {
    setInsert(kind);
    setInsertList(null);
    setVideoUrl("");
    if (kind === "image") api<{ assets: { id: string; name: string; url: string }[] }>("/api/assets?type=image").then((r) => setInsertList(r.assets), () => setInsertList([]));
    if (kind === "project") api<{ projects: { id: string; name: string }[] }>("/api/projects?kind=code").then((r) => setInsertList(r.projects), () => setInsertList([]));
  }

  function place(type: "image" | "video" | "project", src: string, label: string) {
    const c = viewportCenter();
    const w = type === "image" ? 320 : 480, h = type === "image" ? 240 : 300;
    st.addNode(type, { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h }, { src, name: label.slice(0, 120), fill: "transparent" });
    setInsert(null);
  }

  async function uploadImage(file: File) {
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api<{ asset: { id: string; name: string; url: string } }>("/api/assets", { method: "POST", body: form });
      place("image", r.asset.url, r.asset.name);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setVersions(null);
    await save();
    api<{ versions: { id: string; label: string | null; createdAt: string }[] }>(`/api/canvas/${canvasId}/versions`).then((r) => setVersions(r.versions), (e) => toast.error(errorMessage(e)));
  }

  async function restore(vid: string) {
    try {
      const r = await api<{ data: CanvasDoc; revision: number }>(`/api/canvas/${canvasId}/versions/${vid}/restore`, { method: "POST" });
      st.load(CanvasDocSchema.parse(r.data), r.revision);
      setSaveState("saved");
      setHistoryOpen(false);
      toast.success("Version restored");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function exportJson() {
    const d = useCanvasEditor.getState().doc;
    if (!d) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\w-]+/g, "-") || "canvas"}.canvas.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    try {
      const parsed = CanvasDocSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(`Not a valid canvas file: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
      st.mutate((_, d) => {
        d.pages = parsed.data.pages;
        d.activePageId = parsed.data.activePageId;
      });
      toast.success("Canvas imported");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function align(mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    if (!page || selection.length < 2) return;
    const sel = page.nodes.filter((n) => selection.includes(n.id));
    const minX = Math.min(...sel.map((n) => n.x)), maxX = Math.max(...sel.map((n) => n.x + n.w));
    const minY = Math.min(...sel.map((n) => n.y)), maxY = Math.max(...sel.map((n) => n.y + n.h));
    st.mutate((pg) => {
      for (const n of pg.nodes) {
        if (!selection.includes(n.id) || n.locked) continue;
        if (mode === "left") n.x = minX;
        if (mode === "right") n.x = maxX - n.w;
        if (mode === "hcenter") n.x = Math.round((minX + maxX) / 2 - n.w / 2);
        if (mode === "top") n.y = minY;
        if (mode === "bottom") n.y = maxY - n.h;
        if (mode === "vcenter") n.y = Math.round((minY + maxY) / 2 - n.h / 2);
      }
    });
  }

  const single = page && selection.length === 1 ? page.nodes.find((n) => n.id === selection[0]) : undefined;
  const updateSingle = (fn: (n: CanvasNode) => void) => single && st.mutate((pg) => { const n = pg.nodes.find((x) => x.id === single.id); if (n) fn(n); });
  const selBox = (() => {
    if (!page || !selection.length) return null;
    const sel = page.nodes.filter((n) => selection.includes(n.id) && !n.hidden);
    if (!sel.length) return null;
    const x = Math.min(...sel.map((n) => n.x)), y = Math.min(...sel.map((n) => n.y));
    return { x, y, w: Math.max(...sel.map((n) => n.x + n.w)) - x, h: Math.max(...sel.map((n) => n.y + n.h)) - y };
  })();

  if (loadError)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm">{loadError}</p>
        <Button variant="secondary" asChild><Link href="/canvas">Back to canvases</Link></Button>
      </div>
    );
  if (!doc || !page) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Loading canvas…</div>;

  const cursor = drag?.kind === "pan" || space || tool === "hand" ? (drag?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <Button size="icon-sm" variant="ghost" asChild aria-label="Back to canvases"><Link href="/canvas"><ArrowLeft /></Link></Button>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={(e) => e.target.value.trim() && void api(`/api/canvas/${canvasId}`, { method: "PATCH", json: { name: e.target.value.trim() } }).catch((err) => toast.error(errorMessage(err)))} aria-label="Canvas name" className="w-44 min-w-0 rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus:bg-accent" />
        <span className="hidden text-[11.5px] text-muted-foreground md:inline" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "conflict" ? <span className="text-destructive">Conflict: reload the page</span> : saveState === "error" ? <span className="text-destructive">Save failed</span> : dirty ? "Unsaved" : saveState === "saved" ? <span className="inline-flex items-center gap-1"><Check className="size-3" />Saved</span> : null}
        </span>
        <div className="mx-auto flex items-center gap-0.5 rounded-xl border border-border bg-surface p-0.5">
          {TOOLS.map((t) => (
            <ToolBtn key={t.id} label={`${t.label} (${t.key})`} active={tool === t.id} onClick={() => st.setTool(t.id)}><t.icon className="size-4" /></ToolBtn>
          ))}
          <span className="mx-0.5 h-5 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Insert media"><Plus className="size-3.5" /> Insert</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => void openInsert("image")}><ImageIcon /> Image…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openInsert("video")}><Video /> Video embed…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openInsert("project")}><AppWindow /> Project preview…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ToolBtn label="Undo (Ctrl+Z)" onClick={st.undo} disabled={!canUndo}><Undo2 className="size-4" /></ToolBtn>
        <ToolBtn label="Redo (Ctrl+Shift+Z)" onClick={st.redo} disabled={!canRedo}><Redo2 className="size-4" /></ToolBtn>
        <Button size="sm" variant="ghost" onClick={() => void openHistory()}><History /> <span className="hidden lg:inline">History</span></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Export or import"><Download /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportJson}><Download /> Export design data (JSON)</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => fileInput.current?.click()}><Upload /> Import JSON…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ""; }} />
        <Button size="sm" onClick={() => setAiOpen(true)} disabled={!selectedFrames.length} title={selectedFrames.length ? "" : "Select one or more frames first"}>
          <Sparkles /> Generate{selectedFrames.length > 1 ? ` ${selectedFrames.length} frames` : ""}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Layers */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex" aria-label="Layers">
          <p className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground"><Layers className="size-3" /> Layers</p>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 thin-scroll">
            {page.nodes.length === 0 && <p className="px-2 text-xs text-muted-foreground">Empty page. Press F and drag to create a frame.</p>}
            {[...page.nodes].reverse().map((n) => (
              <div key={n.id} className={cn("group flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] hover:bg-accent/60", selection.includes(n.id) && "bg-accent")} style={{ paddingLeft: n.frameId ? 18 : 6 }}>
                <button className="min-w-0 flex-1 truncate text-left" onClick={(e) => st.setSelection(e.shiftKey ? [...selection, n.id] : [n.id])}>
                  <span className="mr-1 text-[10px] text-muted-foreground">{n.type}</span>{n.name}{n.groupId && <Group className="ml-1 inline size-3 text-muted-foreground" />}
                </button>
                <button aria-label={n.locked ? "Unlock" : "Lock"} onClick={() => st.mutate((pg) => { const x = pg.nodes.find((m) => m.id === n.id); if (x) x.locked = !x.locked; })} className={cn("opacity-0 group-hover:opacity-100", n.locked && "opacity-100")}><Lock className={cn("size-3", n.locked ? "text-foreground" : "text-muted-foreground")} /></button>
                <button aria-label={n.hidden ? "Show" : "Hide"} onClick={() => st.mutate((pg) => { const x = pg.nodes.find((m) => m.id === n.id); if (x) x.hidden = !x.hidden; })} className={cn("opacity-0 group-hover:opacity-100", n.hidden && "opacity-100")}>{n.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3 text-muted-foreground" />}</button>
              </div>
            ))}
          </div>
        </aside>

        {/* Stage */}
        <div
          ref={stageRef}
          className="relative min-w-0 flex-1 touch-none overflow-hidden bg-[#0e0e12] grid-dots select-none"
          style={{ cursor, backgroundPosition: `${vp.x}px ${vp.y}px`, backgroundSize: `${22 * vp.zoom}px ${22 * vp.zoom}px` }}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onDoubleClick={(e) => {
            const t = (e.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
            const n = t && page.nodes.find((x) => x.id === t.dataset.nodeId);
            if (n?.type === "text" && !n.locked) setEditingText(n.id);
          }}
          role="application"
          aria-label="Design canvas"
        >
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` }}>
            {page.nodes.filter((n) => !n.hidden).map((n) => (
              <NodeView
                key={n.id}
                n={n}
                editing={editingText === n.id}
                onTextCommit={(text) => {
                  setEditingText(null);
                  if (text !== n.text) st.mutate((pg) => { const x = pg.nodes.find((m) => m.id === n.id); if (x) x.text = text.slice(0, 10000); });
                }}
              />
            ))}
            {/* Selection overlay */}
            {selBox && (
              <div className="pointer-events-none absolute border border-brand" style={{ left: selBox.x, top: selBox.y, width: selBox.w, height: selBox.h, borderWidth: 1 / vp.zoom }}>
                {single && !single.locked &&
                  HANDLES.map((h) => {
                    const s = 8 / vp.zoom;
                    const pos: React.CSSProperties = {
                      left: h.includes("w") ? -s / 2 : h.includes("e") ? selBox.w - s / 2 : selBox.w / 2 - s / 2,
                      top: h.includes("n") ? -s / 2 : h.includes("s") ? selBox.h - s / 2 : selBox.h / 2 - s / 2,
                      width: s,
                      height: s,
                      borderWidth: 1 / vp.zoom,
                      cursor: `${h}-resize`,
                    };
                    return <div key={h} data-handle={h} className="pointer-events-auto absolute rounded-xs border-brand bg-white" style={pos} />;
                  })}
                <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-brand px-1 font-mono text-brand-foreground" style={{ fontSize: 10 / vp.zoom, padding: `${1 / vp.zoom}px ${4 / vp.zoom}px` }}>
                  {Math.round(selBox.w)} × {Math.round(selBox.h)}
                </span>
              </div>
            )}
            {guides.map((g, i) =>
              g.axis === "x" ? (
                <div key={i} className="pointer-events-none absolute bg-pink-500" style={{ left: g.at, top: -100000, width: 1 / vp.zoom, height: 200000 }} />
              ) : (
                <div key={i} className="pointer-events-none absolute bg-pink-500" style={{ top: g.at, left: -100000, height: 1 / vp.zoom, width: 200000 }} />
              ),
            )}
            {(drag?.kind === "marquee" || drag?.kind === "create") && (
              <div
                className={cn("pointer-events-none absolute border border-brand", drag.kind === "marquee" ? "bg-brand/10" : "bg-white/5")}
                style={{ left: Math.min(drag.start.x, drag.cur.x), top: Math.min(drag.start.y, drag.cur.y), width: Math.abs(drag.cur.x - drag.start.x), height: Math.abs(drag.cur.y - drag.start.y), borderWidth: 1 / vp.zoom }}
              />
            )}
          </div>
          {page.nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-lg bg-background/70 px-4 py-2 text-sm text-muted-foreground">Press <span className="kbd">F</span> and drag to draw a frame</p>
            </div>
          )}
          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-border bg-background/80 p-0.5 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
            <ToolBtn label="Zoom out (Ctrl -)" onClick={() => zoomAt(1 / 1.2)}><Minus className="size-3.5" /></ToolBtn>
            <button className="w-12 font-mono text-[11px] text-muted-foreground" onClick={() => st.setViewport({ ...vp, zoom: 1 })} aria-label="Reset zoom to 100%">{Math.round(vp.zoom * 100)}%</button>
            <ToolBtn label="Zoom in (Ctrl +)" onClick={() => zoomAt(1.2)}><Plus className="size-3.5" /></ToolBtn>
            <ToolBtn label="Zoom to fit (Shift+1)" onClick={zoomToFit}><RotateCcw className="size-3.5" /></ToolBtn>
          </div>
        </div>

        {/* Properties */}
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-border bg-surface thin-scroll lg:block" aria-label="Properties">
          {selection.length === 0 && <p className="p-4 text-xs text-muted-foreground">Select a layer to edit its properties. Select frames and press Generate to lay them out with AI.</p>}
          {selection.length > 1 && (
            <Section title={`${selection.length} selected`}>
              <div className="grid grid-cols-6 gap-1">
                <ToolBtn label="Align left" onClick={() => align("left")}><AlignStartVertical className="size-3.5" /></ToolBtn>
                <ToolBtn label="Align horizontal centers" onClick={() => align("hcenter")}><AlignCenterVertical className="size-3.5" /></ToolBtn>
                <ToolBtn label="Align right" onClick={() => align("right")}><AlignEndVertical className="size-3.5" /></ToolBtn>
                <ToolBtn label="Align top" onClick={() => align("top")}><AlignStartHorizontal className="size-3.5" /></ToolBtn>
                <ToolBtn label="Align vertical centers" onClick={() => align("vcenter")}><AlignCenterHorizontal className="size-3.5" /></ToolBtn>
                <ToolBtn label="Align bottom" onClick={() => align("bottom")}><AlignEndHorizontal className="size-3.5" /></ToolBtn>
              </div>
            </Section>
          )}
          {selection.length > 0 && (
            <Section title="Arrange">
              <div className="flex flex-wrap gap-1">
                <ToolBtn label="Bring to front (Ctrl+])" onClick={() => st.reorder("front")}><ArrowUpToLine className="size-3.5" /></ToolBtn>
                <ToolBtn label="Bring forward (])" onClick={() => st.reorder("forward")}><ChevronUp className="size-3.5" /></ToolBtn>
                <ToolBtn label="Send backward ([)" onClick={() => st.reorder("backward")}><ChevronDown className="size-3.5" /></ToolBtn>
                <ToolBtn label="Send to back (Ctrl+[)" onClick={() => st.reorder("back")}><ArrowDownToLine className="size-3.5" /></ToolBtn>
                <ToolBtn label="Group (Ctrl+G)" onClick={st.groupSelection} disabled={selection.length < 2}><Group className="size-3.5" /></ToolBtn>
                <ToolBtn label="Ungroup (Ctrl+Shift+G)" onClick={st.ungroupSelection}><Ungroup className="size-3.5" /></ToolBtn>
                <ToolBtn label="Duplicate (Ctrl+D)" onClick={st.duplicateSelection}><Copy className="size-3.5" /></ToolBtn>
                <ToolBtn label="Delete (Del)" onClick={st.deleteSelection}><Trash2 className="size-3.5" /></ToolBtn>
              </div>
            </Section>
          )}
          {single && (
            <>
              <Section title={single.type}>
                <Row label="Name"><Input value={single.name} onChange={(e) => updateSingle((n) => void (n.name = e.target.value.slice(0, 120)))} className="h-7 text-xs" aria-label="Layer name" /></Row>
                <Row label="Position">
                  <div className="grid grid-cols-2 gap-1">
                    <NumberInput label="X" step={1} value={single.x} onChange={(v) => updateSingle((n) => void (n.x = v))} />
                    <NumberInput label="Y" step={1} value={single.y} onChange={(v) => updateSingle((n) => void (n.y = v))} />
                  </div>
                </Row>
                <Row label="Size">
                  <div className="grid grid-cols-2 gap-1">
                    <NumberInput label="Width" step={1} min={1} value={single.w} onChange={(v) => updateSingle((n) => void (n.w = v))} />
                    <NumberInput label="Height" step={1} min={1} value={single.h} onChange={(v) => updateSingle((n) => void (n.h = v))} />
                  </div>
                </Row>
                <Row label="Opacity"><SliderInput label="Opacity" min={0} max={1} step={0.01} value={single.opacity} onChange={(v) => updateSingle((n) => void (n.opacity = v))} /></Row>
              </Section>
              {single.type !== "text" && single.type !== "image" && single.type !== "video" && single.type !== "project" && (
                <Section title="Fill & stroke">
                  <Row label="Fill"><ColorInput label="Fill" value={/^#[0-9a-fA-F]{6}$/.test(single.fill) ? single.fill : "#000000"} onChange={(v) => updateSingle((n) => void (n.fill = v))} /></Row>
                  <Row label="Stroke"><ColorInput label="Stroke" value={/^#[0-9a-fA-F]{6}$/.test(single.stroke) ? single.stroke : "#000000"} onChange={(v) => updateSingle((n) => void (n.stroke = v))} /></Row>
                  <Row label="Stroke width"><NumberInput label="Stroke width" step={1} min={0} max={100} value={single.strokeWidth} onChange={(v) => updateSingle((n) => void (n.strokeWidth = v))} /></Row>
                  {single.type !== "ellipse" && <Row label="Radius"><NumberInput label="Corner radius" step={1} min={0} value={single.radius} onChange={(v) => updateSingle((n) => void (n.radius = v))} /></Row>}
                </Section>
              )}
              {single.type === "text" && (
                <Section title="Text">
                  <Textarea value={single.text} onChange={(e) => updateSingle((n) => void (n.text = e.target.value.slice(0, 10000)))} rows={3} className="text-xs" aria-label="Text content" />
                  <Row label="Color"><ColorInput label="Text color" value={/^#[0-9a-fA-F]{6}$/.test(single.color) ? single.color : "#ffffff"} onChange={(v) => updateSingle((n) => void (n.color = v))} /></Row>
                  <Row label="Size"><NumberInput label="Font size" step={1} min={4} max={800} value={single.fontSize} onChange={(v) => updateSingle((n) => void (n.fontSize = v))} /></Row>
                  <Row label="Weight"><NumberInput label="Font weight" step={100} min={100} max={900} value={single.fontWeight} onChange={(v) => updateSingle((n) => void (n.fontWeight = Math.round(v / 100) * 100))} /></Row>
                  <Row label="Align">
                    <div className="flex gap-1">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button key={a} onClick={() => updateSingle((n) => void (n.align = a))} className={cn("flex-1 rounded border border-border py-0.5 text-[11px] text-muted-foreground", single.align === a && "bg-accent text-foreground")}>{a}</button>
                      ))}
                    </div>
                  </Row>
                </Section>
              )}
            </>
          )}
        </aside>
      </div>

      {/* Pages */}
      <footer className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border bg-surface px-2 thin-scroll" aria-label="Pages">
        {doc.pages.map((p) =>
          renamingPage === p.id ? (
            <Input key={p.id} autoFocus defaultValue={p.name} className="h-6 w-32 text-xs" onBlur={(e) => { const v = e.target.value.trim(); setRenamingPage(null); if (v) st.mutate((_, d) => { const pg = d.pages.find((x) => x.id === p.id); if (pg) pg.name = v.slice(0, 120); }); }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="Page name" />
          ) : (
            <DropdownMenu key={p.id}>
              <button
                onClick={() => st.setActivePage(p.id)}
                onDoubleClick={() => setRenamingPage(p.id)}
                onContextMenu={(e) => e.preventDefault()}
                className={cn("shrink-0 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent", p.id === doc.activePageId && "bg-accent text-foreground")}
              >
                {p.name}
              </button>
              {p.id === doc.activePageId && (
                <>
                  <DropdownMenuTrigger asChild><button className="rounded px-0.5 text-muted-foreground hover:text-foreground" aria-label="Page options"><ChevronUp className="size-3" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent side="top">
                    <DropdownMenuItem onSelect={() => setRenamingPage(p.id)}>Rename</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={doc.pages.length === 1} onSelect={() => st.mutate((_, d) => { d.pages = d.pages.filter((x) => x.id !== p.id); d.activePageId = d.pages[0].id; })}>Delete page</DropdownMenuItem>
                  </DropdownMenuContent>
                </>
              )}
            </DropdownMenu>
          ),
        )}
        <ToolBtn label="Add page" onClick={st.addPage}><Plus className="size-3.5" /></ToolBtn>
      </footer>

      {/* AI dialog */}
      <Dialog open={aiOpen} onOpenChange={(o) => !aiRun && setAiOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-brand" /> Generate {selectedFrames.length} frame{selectedFrames.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>Each selected frame is designed by an independent agent task; up to the configured concurrency limit run in parallel. Existing content in those frames is replaced (undo restores it).</DialogDescription>
          </DialogHeader>
          <Textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={4} maxLength={4000} placeholder="e.g. A hero section for a coffee subscription brand: headline, subcopy, CTA button and three feature cards" aria-label="Design instruction" />
          {aiRun && (
            <ul className="grid gap-1 rounded-lg border border-border p-2 text-xs">
              {Object.entries(aiRun.tasks).map(([id, t]) => (
                <li key={id} className="flex items-center gap-2">
                  {t.status === "running" ? <Loader2 className="size-3 animate-spin text-brand" /> : t.status === "succeeded" ? <Check className="size-3 text-success" /> : t.status === "failed" ? <Trash2 className="size-3 text-destructive" /> : <span className="size-3 rounded-full border border-border" />}
                  <span className="flex-1 truncate">{t.description}</span>
                  {t.error && <span className="text-destructive">{t.error}</span>}
                </li>
              ))}
              {!Object.keys(aiRun.tasks).length && <li className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Starting…</li>}
            </ul>
          )}
          <DialogFooter>
            {aiRun ? (
              <Button variant="secondary" onClick={() => void api(`/api/jobs/${aiRun.jobId}`, { method: "DELETE" })}>Cancel</Button>
            ) : (
              <Button variant="ghost" onClick={() => setAiOpen(false)}>Close</Button>
            )}
            <Button onClick={() => void runAI()} disabled={aiText.trim().length < 3 || Boolean(aiRun)}>{aiRun ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>Autosave keeps a version at most every two minutes. Restoring saves the current state as “Before restore”.</DialogDescription>
          </DialogHeader>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const input = (e.currentTarget.elements.namedItem("label") as HTMLInputElement); const label = input.value.trim(); if (!label) return; void api(`/api/canvas/${canvasId}/versions`, { method: "POST", json: { label } }).then(() => { input.value = ""; return openHistory(); }, (err) => toast.error(errorMessage(err))); }}>
            <Input name="label" placeholder="Name this version" maxLength={80} aria-label="Version name" />
            <Button type="submit">Save</Button>
          </form>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border thin-scroll">
            {versions === null && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
            {versions?.length === 0 && <p className="p-3 text-sm text-muted-foreground">No versions yet.</p>}
            {versions?.map((v) => (
              <div key={v.id} className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0">
                <span className="flex-1">{v.label ?? "Autosave"} <span className="text-xs text-muted-foreground">· {timeAgo(v.createdAt)}</span></span>
                <Button size="xs" variant="secondary" onClick={() => void restore(v.id)}><RotateCcw /> Restore</Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Insert dialog */}
      <Dialog open={insert !== null} onOpenChange={(o) => !o && setInsert(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{insert === "image" ? "Insert image" : insert === "video" ? "Embed video" : "Embed project preview"}</DialogTitle>
            <DialogDescription>{insert === "video" ? "Paste a YouTube or Vimeo link." : insert === "project" ? "Shows the project's last working build in a sandboxed frame." : "Choose from your asset library or upload a new image."}</DialogDescription>
          </DialogHeader>
          {insert === "video" ? (
            <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); const embed = toEmbed(videoUrl.trim()); if (!embed) { toast.error("Only YouTube and Vimeo links are supported"); return; } place("video", embed, "Video"); }}>
              <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" aria-label="Video URL" />
              <Button type="submit" disabled={!videoUrl.trim()}>Embed</Button>
            </form>
          ) : (
            <div className="grid gap-2">
              {insert === "image" && (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:border-brand/40">
                  <Upload className="size-4" /> Upload image
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} />
                </label>
              )}
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border thin-scroll">
                {insertList === null && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
                {insertList?.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nothing here yet.</p>}
                {insert === "image" ? (
                  <div className="grid grid-cols-3 gap-2 p-2">
                    {insertList?.map((a) => (
                      <button key={a.id} onClick={() => place("image", a.url!, a.name)} className="overflow-hidden rounded-md border border-border hover:border-brand" title={a.name}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt={a.name} className="aspect-square w-full object-cover" />
                      </button>
                    ))}
                  </div>
                ) : (
                  insertList?.map((p) => (
                    <button key={p.id} onClick={() => place("project", p.id, p.name)} className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-accent">{p.name}</button>
                  ))
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
