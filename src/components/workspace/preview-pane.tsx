"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Tablet, Smartphone, RotateCw, ExternalLink, AlertTriangle, Loader2, Wand2, ChevronDown, ChevronUp, Play, CircleCheck, Sparkles, Check, ScanSearch, PenLine, Image as ImageIcon, Layers } from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { api } from "@/lib/api-client";
import { formatDiagnostic, type PreviewMessage } from "@/lib/build-types";
import type { PipelineStage } from "@/lib/jobs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The preview sizes; the switch between them sits in the editor's top bar. */
export const VIEWPORTS = {
  desktop: { label: "Desktop", icon: Monitor, w: null as number | null, h: null as number | null },
  tablet: { label: "Tablet (820×1180)", icon: Tablet, w: 820, h: 1180 },
  mobile: { label: "Mobile (390×844)", icon: Smartphone, w: 390, h: 844 },
};
export type ViewportId = keyof typeof VIEWPORTS;

export function PreviewPane({ onFixWithAI, busy, viewport = "desktop" }: { onFixWithAI: (errors: string[]) => void; busy: boolean; viewport?: ViewportId }) {
  const build = useWorkspace((s) => s.build);
  const nonce = useWorkspace((s) => s.previewNonce);
  const runtimeErrors = useWorkspace((s) => s.runtimeErrors);
  const { refreshPreview, pushRuntimeError, runBuild, openFile } = useWorkspace.getState();
  const [showIssues, setShowIssues] = useState(true);
  const [loading, setLoading] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The slide being viewed, so a rebuilt presentation (e.g. when its custom 3D scenes arrive) reopens on it.
  const [slide, setSlide] = useState(1);
  // Builds whose slide-1 thumbnail was asked for (once each; the presentation listing shows it).
  const thumbAsked = useRef(new Set<string>());
  const shownBuild = /\/preview\/([A-Za-z0-9_-]{8,58})\//.exec(build.previewUrl ?? "")?.[1] ?? null;
  const shownBuildRef = useRef(shownBuild);
  useEffect(() => {
    shownBuildRef.current = shownBuild;
  }, [shownBuild]);

  // Messages from the sandboxed preview: accept only those from our iframe's window.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as PreviewMessage;
      if (!d || d.source !== "deck3d-preview") return;
      const buildId = shownBuildRef.current;
      if (d.type === "ready") setLoading(false);
      else if (d.type === "slide") {
        setSlide(Number.isInteger(d.index) && d.index > 0 ? d.index : 1);
        // A presentation is showing: ask it for a picture of slide 1 (drawn once slide 1 has settled).
        if (buildId && !thumbAsked.current.has(buildId)) {
          thumbAsked.current.add(buildId);
          frameRef.current?.contentWindow?.postMessage({ type: "deck3d-deck", action: "thumbnail" }, "*");
        }
      } else if (d.type === "thumbnail") {
        const projectId = useWorkspace.getState().projectId;
        if (buildId && projectId && typeof d.image === "string") {
          void api(`/api/projects/${projectId}/thumbnail`, { method: "POST", json: { buildId, image: d.image } }).catch(() => {
            /* only the listing's picture: a later build tries again */
          });
        }
      } else pushRuntimeError(d);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pushRuntimeError]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // editor=1: the deck knows it is the editor's preview (no hover previews over the dots).
  const src = build.previewUrl ? `${build.previewUrl}?v=${nonce}&editor=1` : null;
  const [prevSrc, setPrevSrc] = useState(src);
  const [frameSrc, setFrameSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setLoading(Boolean(src));
    setFrameSrc(src && slide > 1 ? `${src}#${slide}` : src);
  }

  const vp = VIEWPORTS[viewport];
  const scale = vp.w && vp.h && box.w && box.h ? Math.min(1, (box.w - 32) / vp.w, (box.h - 32) / vp.h) : 1;
  const errors = build.status === "failed" ? build.errors : [];
  const runtime = runtimeErrors;
  const issueCount = errors.length + runtime.length;
  const issueTexts = [...errors.map(formatDiagnostic), ...runtime.map((r) => `${r.type}: ${r.message}${r.file ? ` (${r.file}:${r.line})` : ""}`)];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
        <div className="mr-2 flex min-w-0 flex-1 items-center gap-2 rounded-md bg-background/60 px-2 py-1 text-[11.5px] text-muted-foreground">
          {busy || build.status === "building" ? <Loader2 className="size-3 shrink-0 animate-spin text-brand" /> : build.status === "failed" ? <AlertTriangle className="size-3 shrink-0 text-destructive" /> : build.previewUrl ? <CircleCheck className="size-3 shrink-0 text-success" /> : <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />}
          <span className="truncate font-mono">{busy ? "Working on it…" : build.status === "building" ? "Building…" : build.previewUrl ? "sandboxed preview · opaque origin" : "No preview yet"}</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button aria-label="Rebuild" onClick={() => void runBuild()} disabled={build.status === "building"} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
              <Play className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Build now</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button aria-label="Refresh preview" onClick={refreshPreview} disabled={!src} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
              <RotateCw className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <a aria-label="Open preview in new tab" href={build.previewUrl ?? undefined} target="_blank" rel="noopener noreferrer" className={cn("flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", !src && "pointer-events-none opacity-40")}>
              <ExternalLink className="size-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent>Open in new tab (still sandboxed)</TooltipContent>
        </Tooltip>
      </div>

      {build.stale && (
        <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5" /> The latest build failed. Showing the last working version.
        </div>
      )}

      {/* The preview sits in a framed card with the page around it, never edge to edge. */}
      <div ref={boxRef} className={cn("relative min-h-0 flex-1 overflow-hidden", viewport === "desktop" ? "p-4 sm:p-5" : "grid-dots flex items-center justify-center")}>
        {busy ? (
          <GeneratingSkeleton box={box} />
        ) : src ? (
          <div
            style={vp.w && vp.h ? { width: vp.w, height: vp.h, transform: `scale(${scale})`, transformOrigin: "center" } : { width: "100%", height: "100%" }}
            className={cn("relative shrink-0 overflow-hidden bg-white ring-1 ring-border", viewport === "desktop" ? "rounded-2xl shadow-[0_14px_34px_-18px_rgb(15_29_43/0.35)]" : "rounded-[18px] shadow-2xl")}
          >
            <iframe
              key={src}
              ref={frameRef}
              src={frameSrc ?? src}
              title="Project preview"
              // No allow-same-origin: the document gets an opaque origin (the server also sends a CSP sandbox).
              sandbox="allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads"
              allow="fullscreen; accelerometer; gyroscope"
              referrerPolicy="no-referrer"
              // Hidden until it has loaded, so a half-loaded document (no styles or scene yet) is never shown.
              className={cn("size-full border-0 bg-white", loading && "invisible")}
              onLoad={() => setTimeout(() => setLoading(false), 300)}
            />
            {loading && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            {build.status === "building" || busy ? (
              <>
                <Loader2 className="size-5 animate-spin text-brand" />
                <p className="text-sm text-muted-foreground">{busy ? "Creating your presentation… it appears here when ready." : "Building preview…"}</p>
              </>
            ) : (
              <>
                <Monitor className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No preview yet</p>
                <p className="max-w-xs text-xs text-muted-foreground">{build.status === "failed" ? "The presentation could not be built. Ask for the change again in the chat." : "Describe your presentation in the chat. It appears here as soon as the slides are written."}</p>
              </>
            )}
          </div>
        )}
      </div>

      {issueCount > 0 && (
        <div className="max-h-[40%] shrink-0 border-t border-border bg-surface">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <button onClick={() => setShowIssues(!showIssues)} className="flex items-center gap-1.5 text-xs font-medium" aria-expanded={showIssues}>
              <AlertTriangle className="size-3.5 text-destructive" />
              {errors.length > 0 && `${errors.length} build error${errors.length > 1 ? "s" : ""}`}
              {errors.length > 0 && runtime.length > 0 && " · "}
              {runtime.length > 0 && `${runtime.length} runtime issue${runtime.length > 1 ? "s" : ""}`}
              {showIssues ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
            </button>
            <Button size="xs" variant="secondary" className="ml-auto" disabled={busy} onClick={() => onFixWithAI(issueTexts)}>
              <Wand2 /> Fix with AI
            </Button>
          </div>
          {showIssues && (
            <ul className="max-h-48 overflow-auto px-3 pb-2 font-mono text-[11.5px] thin-scroll">
              {errors.map((d, i) => (
                <li key={`b${i}`} className="border-t border-border/60 py-1 first:border-0">
                  <button className="text-left hover:underline disabled:no-underline" disabled={!d.file || !d.line} onClick={() => d.file && openFile(d.file, d.line || 1)}>
                    <span className="text-destructive">{d.source}</span> {formatDiagnostic(d)}
                  </button>
                </li>
              ))}
              {runtime.map((r, i) => (
                <li key={`r${i}`} className="border-t border-border/60 py-1 first:border-0">
                  <span className="text-warning">{r.type}</span> {r.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The four steps shown while a presentation is made, and the job stages each
 * covers ("build" is left out: the preview is built more than once, mid-way too).
 */
const STEPS: { label: string; icon: typeof Check; stages: PipelineStage[] }[] = [
  { label: "Analyzing Topic", icon: ScanSearch, stages: ["understand", "plan"] },
  { label: "Writing Content", icon: PenLine, stages: ["generate", "repair"] },
  { label: "Designing Slides", icon: ImageIcon, stages: ["review", "images", "validate"] },
  { label: "Finalizing", icon: Layers, stages: ["finalize"] },
];

/** A glossy stack of two slides, the second showing a picture. */
function SlideStack({ size }: { size: number }) {
  return (
    <div className="relative" style={{ width: size * 1.15, height: size }} aria-hidden="true">
      <div className="absolute top-0 right-0 h-[78%] w-[82%] -rotate-6 rounded-[14%] bg-gradient-to-br from-[#5fd8ff]/70 to-[#0a5fc2]/70 ring-1 ring-white/25" />
      <div className="absolute bottom-0 left-0 flex h-[78%] w-[82%] flex-col justify-between rounded-[14%] bg-gradient-to-br from-[#5fe0ff] via-[#1aa3f5] to-[#0752c4] p-[10%] shadow-[0_10px_40px_-6px_rgb(1_196_249/0.75)] ring-1 ring-white/40">
        <ImageIcon className="text-white drop-shadow" style={{ width: size * 0.32, height: size * 0.32 }} strokeWidth={2.2} />
        <div className="grid gap-[6%]">
          <span className="block h-[5px] w-[80%] rounded-full bg-white/85" />
          <span className="block h-[5px] w-[55%] rounded-full bg-white/60" />
        </div>
      </div>
    </div>
  );
}

/**
 * Shown instead of the preview while a presentation is being made or changed:
 * nothing half-made (slides without their images or scenes) is ever shown; the
 * finished presentation appears at once when the job completes. One slide-shaped
 * stage in the deck's dark look, centred in the pane: the progress and its four steps.
 */
function GeneratingSkeleton({ box }: { box: { w: number; h: number } }) {
  const job = useWorkspace((s) => s.job);
  const pct = Math.round(Math.min(0.97, Math.max(0.03, job?.progress ?? 0)) * 100);
  // The step running now: the last one any of whose stages has started (or finished).
  const active = Math.max(0, ...STEPS.map((s, i) => (s.stages.some((id) => job?.stages[id]) ? i : 0)));
  // The slide fits the pane, whichever way it is limited.
  const w = box.w && box.h ? Math.max(200, Math.min(box.w - 40, 1040, (box.h - 40) * (16 / 9))) : 0;
  const compact = w < 520;
  const dot = compact ? 26 : 38;

  return (
    <div className="flex h-full items-center justify-center overflow-hidden p-4" role="status" aria-live="polite">
      <div className="relative shrink-0 animate-rise" style={{ width: w || "100%" }}>
        <div className="absolute -inset-1.5 rounded-[24px] bg-brand-gradient opacity-40 blur-xl animate-breathe motion-reduce:animate-none" aria-hidden="true" />
        <div className="relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-2xl bg-[#04121f] shadow-[0_30px_70px_-24px_rgb(0_136_204/0.45)] ring-1 ring-white/10">
          <div className="absolute inset-0" style={{ background: "radial-gradient(55% 60% at 50% 30%, rgb(1 196 249 / 0.16), transparent 70%), radial-gradient(45% 55% at 92% 8%, rgb(0 136 204 / 0.22), transparent 70%), radial-gradient(45% 55% at 6% 96%, rgb(0 136 204 / 0.25), transparent 70%)" }} aria-hidden="true" />
          {[["12%", "24%", "0s"], ["78%", "18%", ".6s"], ["30%", "12%", "1.1s"], ["88%", "56%", ".3s"], ["10%", "60%", "1.5s"], ["66%", "10%", ".9s"]].map(([x, y, d]) => (
            <span key={x + y} className="absolute size-[3px] rounded-full bg-white/90 animate-breathe motion-reduce:animate-none" style={{ left: x, top: y, animationDelay: d }} aria-hidden="true" />
          ))}
          {/* Waves along the bottom */}
          <svg className="absolute inset-x-0 bottom-0 h-[22%] w-full" viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 140 C 180 60 340 200 520 130 S 860 50 1000 120 V200 H0 Z" fill="rgb(1 196 249 / 0.10)" />
            <path d="M0 170 C 220 110 380 210 600 160 S 880 110 1000 150 V200 H0 Z" fill="rgb(0 136 204 / 0.18)" />
            <path d="M0 140 C 180 60 340 200 520 130 S 860 50 1000 120" fill="none" stroke="rgb(1 196 249 / 0.55)" strokeWidth="2" />
          </svg>
          <div className="absolute top-[5%] left-[4%] flex items-center gap-1.5 rounded-full bg-brand-3/10 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white/85 ring-1 ring-brand-3/30 backdrop-blur" aria-hidden="true">
            <Sparkles className="size-3 text-brand-3" /> AI is working
          </div>

          <div className="relative flex w-[78%] flex-col items-center text-center text-white">
            {!compact && (
              <div className="animate-float motion-reduce:animate-none" style={{ marginBottom: w * 0.03 }}>
                <SlideStack size={Math.round(w * 0.1)} />
              </div>
            )}
            <p className={cn("font-bold tracking-tight", compact ? "text-base" : w > 820 ? "text-3xl" : "text-2xl")}>
              Generating Your <span className="text-brand-3">Presentation</span>
            </p>
            {!compact && <p className="mt-1.5 text-sm text-brand-3/80">Creating slides, adding content, and designing for you…</p>}

            {/* Progress bar, with a glowing head, and the percentage beside it */}
            <div className={cn("flex w-[86%] items-center gap-3", compact ? "mt-3" : "mt-6")}>
              <div className="relative h-2 flex-1 rounded-full bg-white/10 ring-1 ring-white/5">
                <div className="relative h-full rounded-full bg-gradient-to-r from-brand to-brand-3 shadow-[0_0_14px_rgb(1_196_249/0.6)] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }}>
                  <span className="absolute top-1/2 right-0 size-3 translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_4px_rgb(1_196_249/0.8)]" />
                </div>
              </div>
              <span className={cn("shrink-0 font-bold tabular-nums", compact ? "text-sm" : "text-lg")}>{pct}%</span>
            </div>

            {/* The four steps, joined by a line that fills as they finish */}
            <ol className={cn("relative grid w-full grid-cols-4", compact ? "mt-4" : "mt-7")}>
              <span className="absolute h-px bg-white/15" style={{ top: dot / 2, left: "12.5%", right: "12.5%" }} aria-hidden="true" />
              <span className="absolute h-px bg-brand-3 transition-[width] duration-700" style={{ top: dot / 2, left: "12.5%", width: `${(active / (STEPS.length - 1)) * 75}%` }} aria-hidden="true" />
              {STEPS.map((s, i) => {
                const state = i < active ? "done" : i === active ? "active" : "todo";
                const Icon = state === "done" ? Check : s.icon;
                return (
                  <li key={s.label} className="relative flex flex-col items-center gap-2" aria-current={state === "active" ? "step" : undefined}>
                    <span
                      className={cn(
                        "flex items-center justify-center rounded-full transition-colors",
                        state === "done" && "bg-brand-3 text-[#04121f] shadow-[0_0_16px_rgb(1_196_249/0.55)]",
                        state === "active" && "bg-[#06243a] text-brand-3 ring-2 ring-brand-3 shadow-[0_0_20px_rgb(1_196_249/0.6)]",
                        state === "todo" && "bg-[#071a2b] text-white/45 ring-1 ring-white/20",
                      )}
                      style={{ width: dot, height: dot }}
                    >
                      <Icon className={compact ? "size-3.5" : "size-[18px]"} strokeWidth={state === "done" ? 3 : 2} />
                    </span>
                    <span className={cn("font-semibold", compact ? "text-[9px]" : "text-xs", state === "todo" ? "text-white/45" : "text-white")}>{s.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
