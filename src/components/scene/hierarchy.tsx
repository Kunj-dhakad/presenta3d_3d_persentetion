"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Eye, EyeOff, Lightbulb, Box, Circle, Sparkles, Type, Mountain, Layers, Globe2 } from "lucide-react";
import { useSceneEditor } from "@/stores/scene-editor";
import type { SceneObject } from "@/lib/schemas/scene";
import { cn } from "@/lib/utils";

const ICON: Partial<Record<SceneObject["type"], typeof Box>> = { sphere: Circle, particles: Sparkles, starfield: Sparkles, text: Type, terrain: Mountain, group: Layers };

export function Hierarchy() {
  const scene = useSceneEditor((s) => s.scene);
  const selection = useSceneEditor((s) => s.selection);
  const { select, updateObject } = useSceneEditor.getState();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const children = useMemo(() => {
    const m = new Map<string | null, SceneObject[]>();
    if (!scene) return m;
    const ids = new Set(scene.objects.map((o) => o.id));
    for (const o of scene.objects) {
      const k = o.parentId && ids.has(o.parentId) ? o.parentId : null;
      m.set(k, [...(m.get(k) ?? []), o]);
    }
    return m;
  }, [scene]);
  if (!scene) return null;

  const node = (o: SceneObject, depth: number): React.ReactNode => {
    const kids = children.get(o.id) ?? [];
    const open = !collapsed.has(o.id);
    const Icon = ICON[o.type] ?? Box;
    const active = selection?.kind === "object" && selection.id === o.id;
    return (
      <div key={o.id} role="treeitem" aria-selected={active} aria-expanded={kids.length ? open : undefined}>
        <div className={cn("group flex items-center gap-1 rounded-md pr-1 text-[12.5px] hover:bg-accent/60", active && "bg-accent")} style={{ paddingLeft: 4 + depth * 12 }}>
          <button
            className={cn("flex size-4 items-center justify-center text-muted-foreground", !kids.length && "invisible")}
            onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })}
            aria-label={open ? "Collapse" : "Expand"}
          >
            <ChevronRight className={cn("size-3 transition", open && "rotate-90")} />
          </button>
          <button className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left" onClick={() => select({ kind: "object", id: o.id })}>
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn("truncate", !o.visible && "text-muted-foreground line-through")}>{o.name}</span>
            {o.animation.type !== "none" && <span className="shrink-0 text-[10px] text-brand">{o.animation.type}</span>}
          </button>
          <button
            onClick={() => updateObject(o.id, (x) => void (x.visible = !x.visible))}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus:opacity-100"
            aria-label={o.visible ? `Hide ${o.name}` : `Show ${o.name}`}
          >
            {o.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
          </button>
        </div>
        {open && kids.map((k) => node(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 thin-scroll" role="tree" aria-label="Scene hierarchy">
        <button onClick={() => select({ kind: "scene" })} className={cn("flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] hover:bg-accent/60", (selection === null || selection.kind === "scene") && "bg-accent")}>
          <Globe2 className="size-3.5 text-brand" /> <span className="font-medium">{scene.title}</span>
        </button>
        <p className="mt-2 px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Objects · {scene.objects.length}</p>
        {scene.objects.length === 0 && <p className="px-2 text-xs text-muted-foreground">Add an object or generate a scene with AI.</p>}
        {(children.get(null) ?? []).map((o) => node(o, 0))}
        <p className="mt-3 px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Lights · {scene.lights.length}</p>
        {scene.lights.map((l) => (
          <button key={l.id} onClick={() => select({ kind: "light", id: l.id })} className={cn("flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-accent/60", selection?.kind === "light" && selection.id === l.id && "bg-accent")}>
            <Lightbulb className="size-3.5 shrink-0" style={{ color: l.color }} />
            <span className="truncate">{l.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{l.type}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
