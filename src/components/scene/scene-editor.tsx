"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Box, Check, Copy, Download, FileCode2, Loader2, Move3d, Pause, Play, Plus, Redo2, RotateCcw, Rotate3d, Scale3d, Sparkles, Square, Trash2, Undo2, Gauge, Gamepad2, Pencil,
} from "lucide-react";
import { useSceneEditor, sceneClock } from "@/stores/scene-editor";
import { OBJECT_TYPES, validateScene, type SceneSpec, type LightSpec } from "@/lib/schemas/scene";
import { SceneView, type PerfStats, type PlayerState, type SceneViewHandle } from "./scene-renderer";
import { Hierarchy } from "./hierarchy";
import { Inspector } from "./inspector";
import { api, errorMessage, streamJob } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

function IconBtn({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} className={cn("flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40", active && "bg-accent text-foreground")}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Timeline() {
  const playing = useSceneEditor((s) => s.playing);
  const speed = useSceneEditor((s) => s.speed);
  const duration = useSceneEditor((s) => s.scene?.timeline.duration ?? 30);
  const { setPlaying, setSpeed, seek } = useSceneEditor.getState();
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT(sceneClock.t), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t border-border bg-surface px-3">
      <IconBtn label={playing ? "Pause timeline" : "Play timeline"} onClick={() => setPlaying(!playing)}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</IconBtn>
      <IconBtn label="Rewind" onClick={() => { seek(0); setT(0); }}><RotateCcw className="size-3.5" /></IconBtn>
      <span className="w-20 font-mono text-[11px] text-muted-foreground">{t.toFixed(1)}s / {duration}s</span>
      <Slider aria-label="Timeline position" value={[Math.min(t, duration)]} min={0} max={duration} step={0.05} onValueChange={([v]) => { seek(v); setT(v); }} className="flex-1" />
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Playback speed">
        {[0.25, 0.5, 1, 2].map((s) => (
          <button key={s} role="radio" aria-checked={speed === s} onClick={() => setSpeed(s)} className={cn("rounded px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground", speed === s && "bg-accent text-foreground")}>{s}×</button>
        ))}
      </div>
    </div>
  );
}

const LIGHT_TYPES: LightSpec["type"][] = ["directional", "point", "spot", "ambient", "hemisphere"];

export function SceneEditor({ sceneId }: { sceneId: string }) {
  const router = useRouter();
  const scene = useSceneEditor((s) => s.scene);
  const dirty = useSceneEditor((s) => s.dirty);
  const revision = useSceneEditor((s) => s.revision);
  const mode = useSceneEditor((s) => s.mode);
  const transformMode = useSceneEditor((s) => s.transformMode);
  const selection = useSceneEditor((s) => s.selection);
  const canUndo = useSceneEditor((s) => s.past.length > 0);
  const canRedo = useSceneEditor((s) => s.future.length > 0);
  const st = useSceneEditor.getState();
  const [name, setName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stats, setStats] = useState<PerfStats | null>(null);
  const [hud, setHud] = useState<PlayerState | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiMode, setAiMode] = useState<"edit" | "new">("edit");
  const [aiJob, setAiJob] = useState<{ status: string; detail: string; chars: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const handleRef = useRef<SceneViewHandle | null>(null);
  const savedRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api<{ project: { name: string }; scene: SceneSpec; valid: boolean; errors: string[] }>(`/api/scenes/${sceneId}`).then(
      (r) => {
        if (cancelled) return;
        if (!r.valid) toast.warning(`Scene loaded with issues: ${r.errors[0]}`);
        useSceneEditor.getState().load(r.scene);
        setName(r.project.name);
      },
      (e) => !cancelled && setLoadError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  // One save at a time, so an older request can never overwrite a newer one.
  const saveInFlight = useRef(false);
  const saveAgain = useRef(false);
  const save = useCallback(async (): Promise<void> => {
    if (saveInFlight.current) {
      saveAgain.current = true;
      return;
    }
    saveInFlight.current = true;
    try {
      let rev: number;
      do {
        saveAgain.current = false;
        const s = useSceneEditor.getState();
        if (!s.scene) return;
        const v = validateScene(s.scene);
        if (!v.ok) {
          setSaveState("error");
          setSaveError(v.errors[0]);
          return;
        }
        rev = s.revision;
        setSaveState("saving");
        await api(`/api/scenes/${sceneId}`, { method: "PUT", json: { scene: v.scene } });
        savedRevision.current = rev;
        if (useSceneEditor.getState().revision === rev) useSceneEditor.getState().markSaved();
        setSaveState("saved");
        setSaveError(null);
      } while (saveAgain.current || useSceneEditor.getState().revision !== rev);
    } catch (e) {
      setSaveState("error");
      setSaveError(errorMessage(e));
    } finally {
      saveInFlight.current = false;
    }
  }, [sceneId]);

  // Debounced autosave.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void save(), 1200);
    return () => clearTimeout(t);
  }, [dirty, revision, save]);

  // Keyboard shortcuts (ignored while typing in inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true], [role=combobox]")) return;
      const s = useSceneEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicateSelected();
      } else if (s.mode === "edit" && (e.key === "Delete" || e.key === "Backspace")) s.removeSelected();
      else if (s.mode === "edit" && e.key.toLowerCase() === "g") s.setTransformMode("translate");
      else if (s.mode === "edit" && e.key.toLowerCase() === "r") s.setTransformMode("rotate");
      else if (s.mode === "edit" && e.key.toLowerCase() === "s") s.setTransformMode("scale");
      else if (e.key === "Escape") s.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  async function runAI() {
    const prompt = aiPrompt.trim();
    if (prompt.length < 3) return;
    setAiJob({ status: "running", detail: "Starting…", chars: 0 });
    try {
      const { jobId } = await api<{ jobId: string }>("/api/scenes/ai", { method: "POST", json: { prompt, current: aiMode === "edit" ? useSceneEditor.getState().scene : null } });
      let failed: string | null = null;
      await streamJob(jobId, (e) => {
        if (e.type === "stage") setAiJob((j) => ({ status: "running", detail: e.detail ?? e.stage, chars: j?.chars ?? 0 }));
        if (e.type === "stream") setAiJob((j) => ({ status: "running", detail: j?.detail ?? "", chars: e.chars }));
        if (e.type === "status" && (e.status === "failed" || e.status === "cancelled")) failed = e.message ?? e.status;
      });
      if (failed) throw new Error(failed);
      const r = await api<{ job: { output: { scene: SceneSpec; summary: string } } }>(`/api/jobs/${jobId}`);
      useSceneEditor.getState().replaceScene(r.job.output.scene);
      setResetNonce((n) => n + 1);
      toast.success(r.job.output.summary);
      setAiOpen(false);
      setAiPrompt("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAiJob(null);
    }
  }

  async function exportToCode() {
    setExporting(true);
    try {
      await save();
      const r = await api<{ project: { id: string } }>(`/api/scenes/${sceneId}/export`, { method: "POST" });
      await api(`/api/projects/${r.project.id}/build`, { method: "POST" }).catch(() => {});
      toast.success("Exported to a code project");
      router.push(`/chat/${r.project.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setExporting(false);
    }
  }

  async function rename(n: string) {
    setName(n);
    try {
      await api(`/api/projects/${sceneId}`, { method: "PATCH", json: { name: n } });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function downloadJson() {
    const s = useSceneEditor.getState().scene;
    if (!s) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(s.title || "scene").replace(/[^\w-]+/g, "-")}.scene.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loadError)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm">{loadError}</p>
        <Button variant="secondary" asChild><Link href="/studio">Back to Studio</Link></Button>
      </div>
    );
  if (!scene)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading scene…
      </div>
    );

  const playerScene = scene.controls.mode === "player";
  const totalCollectibles = scene.objects.filter((o) => o.role === "collectible").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <IconBtn label="Back to Studio" onClick={() => router.push("/studio")}><ArrowLeft className="size-4" /></IconBtn>
        <div className="group flex min-w-0 items-center gap-1">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={(e) => e.target.value.trim() && void rename(e.target.value.trim())} aria-label="Scene name" className="w-48 min-w-0 truncate rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus:bg-accent" />
          <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </div>
        <span className="ml-1 hidden items-center gap-1 text-[11.5px] text-muted-foreground md:flex" aria-live="polite">
          {saveState === "saving" ? <><Loader2 className="size-3 animate-spin" /> Saving…</> : saveState === "error" ? <span className="text-destructive">Not saved: {saveError}</span> : dirty ? "Unsaved changes" : saveState === "saved" ? <><Check className="size-3" /> Saved</> : null}
        </span>
        <div className="mx-auto flex items-center gap-0.5">
          <IconBtn label="Undo (Ctrl+Z)" onClick={st.undo} disabled={!canUndo}><Undo2 className="size-4" /></IconBtn>
          <IconBtn label="Redo (Ctrl+Shift+Z)" onClick={st.redo} disabled={!canRedo}><Redo2 className="size-4" /></IconBtn>
          <span className="mx-1 h-5 w-px bg-border" />
          <IconBtn label="Move (G)" active={transformMode === "translate"} onClick={() => st.setTransformMode("translate")} disabled={mode === "play"}><Move3d className="size-4" /></IconBtn>
          <IconBtn label="Rotate (R)" active={transformMode === "rotate"} onClick={() => st.setTransformMode("rotate")} disabled={mode === "play"}><Rotate3d className="size-4" /></IconBtn>
          <IconBtn label="Scale (S)" active={transformMode === "scale"} onClick={() => st.setTransformMode("scale")} disabled={mode === "play"}><Scale3d className="size-4" /></IconBtn>
          <span className="mx-1 h-5 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={mode === "play"}><Plus /> Add</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-96 overflow-auto">
              <DropdownMenuLabel>Objects</DropdownMenuLabel>
              {OBJECT_TYPES.map((t) => <DropdownMenuItem key={t} onSelect={() => st.addObject(t)}><Box /> {t}</DropdownMenuItem>)}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Lights</DropdownMenuLabel>
              {LIGHT_TYPES.map((t) => <DropdownMenuItem key={t} onSelect={() => st.addLight(t)}><Sparkles /> {t}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <IconBtn label="Duplicate (Ctrl+D)" onClick={st.duplicateSelected} disabled={selection?.kind !== "object" || mode === "play"}><Copy className="size-4" /></IconBtn>
          <IconBtn label="Delete (Del)" onClick={st.removeSelected} disabled={!selection || selection.kind === "scene" || mode === "play"}><Trash2 className="size-4" /></IconBtn>
          <IconBtn label="Reset camera" onClick={() => setResetNonce((n) => n + 1)}><RotateCcw className="size-4" /></IconBtn>
        </div>
        <Button size="sm" variant={mode === "play" ? "default" : "secondary"} onClick={() => st.setMode(mode === "play" ? "edit" : "play")}>
          {mode === "play" ? <><Square /> Stop</> : playerScene ? <><Gamepad2 /> Play</> : <><Play /> Preview</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAiOpen(true)}><Sparkles /> AI</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label="Export">{exporting ? <Loader2 className="animate-spin" /> : <Download />}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void exportToCode()}><FileCode2 /> Export as three.js code project</DropdownMenuItem>
            <DropdownMenuItem onSelect={downloadJson}><Download /> Download scene JSON</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="17" minSize={170} maxSize={360} className="hidden md:block">
            <div className="h-full border-r border-border bg-surface"><Hierarchy /></div>
          </ResizablePanel>
          <ResizableHandle className="hidden md:flex" />
          <ResizablePanel minSize={320}>
            <div className="relative h-full bg-black">
              <SceneView scene={scene} onStats={setStats} resetNonce={resetNonce} handleRef={handleRef} onHud={setHud} />
              {stats && (
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 font-mono text-[10.5px] text-white/80 backdrop-blur-sm" aria-label="Performance">
                  <Gauge className="size-3" />
                  <span className={cn(stats.fps < 30 && "text-destructive")}>{stats.fps} fps</span>
                  <span>{stats.calls} draws</span>
                  <span>{(stats.triangles / 1000).toFixed(1)}k tris</span>
                </div>
              )}
              {mode === "play" && playerScene && hud && (
                <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-sm text-white backdrop-blur-sm" aria-live="polite">
                  {hud.message ?? `Collected ${hud.score} / ${totalCollectibles} · WASD or arrow keys`}
                </div>
              )}
              {mode === "play" && !playerScene && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80">Preview mode: interactions are live. Press Stop to edit.</div>
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="22" minSize={240} maxSize={420}>
            <div className="h-full border-l border-border bg-surface">
              <Inspector
                onCaptureCamera={() => {
                  const c = handleRef.current?.captureCamera();
                  if (c) st.update((s) => { s.camera.position = c.position; s.camera.target = c.target; });
                }}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <Timeline />

      <Dialog open={aiOpen} onOpenChange={(o) => !aiJob && setAiOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-brand" /> 3D specialist</DialogTitle>
            <DialogDescription>Describe a scene or a change. The result is validated against the scene schema before it replaces the current scene, and you can undo it.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-1 rounded-lg border border-border p-0.5" role="radiogroup" aria-label="AI mode">
            {(["edit", "new"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={aiMode === m} onClick={() => setAiMode(m)} className={cn("flex-1 rounded-md py-1 text-xs text-muted-foreground", aiMode === m && "bg-accent text-foreground")}>
                {m === "edit" ? "Edit current scene" : "Generate a new scene"}
              </button>
            ))}
          </div>
          <Textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={4} maxLength={4000} placeholder={aiMode === "edit" ? "e.g. Make the planets glow, add Saturn's moon Titan and slow everything down" : "e.g. A floating island with waterfalls, low-poly trees and drifting clouds"} aria-label="Scene prompt" />
          {aiJob && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {aiJob.detail}{aiJob.chars ? ` · ${(aiJob.chars / 1000).toFixed(1)}k chars received` : ""}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAiOpen(false)} disabled={Boolean(aiJob)}>Cancel</Button>
            <Button onClick={() => void runAI()} disabled={aiPrompt.trim().length < 3 || Boolean(aiJob)}>{aiJob ? <Loader2 className="animate-spin" /> : <Sparkles />} {aiMode === "edit" ? "Apply" : "Generate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
