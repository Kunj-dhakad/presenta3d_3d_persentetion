"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Tablet, Smartphone, RotateCw, ExternalLink, AlertTriangle, Loader2, Wand2, ChevronDown, ChevronUp, Play, CircleCheck, Check, ScanSearch, SquarePen, Image as ImageIcon, Layers } from "lucide-react";
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
/** The desktop slide's shape in the design (996×640). */
const SLIDE_RATIO = 996 / 640;

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
      if (d.type === "ready") {
        setLoading(false);
        // The editor's preview needs no fullscreen button (the deck hides it on this request).
        frameRef.current?.contentWindow?.postMessage({ type: "deck3d-deck", action: "chrome", fullscreen: false }, "*");
      }
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
    <div className="relative flex h-full min-h-0 flex-col bg-[#f4f8fb]">
      {/* Preview tools, laid over the 36px above the slide (the design shows only the slide on #f4f8fb). */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-9 items-center gap-1 px-3">
        <div className="mr-2 flex min-w-0 flex-1 items-center gap-2 text-[11px] text-[#64748b]">
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
        <div className="absolute inset-x-3 top-9 z-10 flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5" /> The latest build failed. Showing the last working version.
        </div>
      )}

      {/* The slide in the design: 996×640 (it keeps that shape), 20px corners, 12px from the sides,
          centred with room for the tools above. */}
      <div ref={boxRef} className={cn("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-9", viewport !== "desktop" && !busy && "grid-dots")}>
        {busy ? (
          <GeneratingSkeleton box={box} />
        ) : src ? (
          <div
            style={vp.w && vp.h ? { width: vp.w, height: vp.h, transform: `scale(${scale})`, transformOrigin: "center" } : box.w && box.h ? { width: Math.min(box.w, box.h * SLIDE_RATIO), height: Math.min(box.w, box.h * SLIDE_RATIO) / SLIDE_RATIO } : { width: "100%", height: "100%" }}
            className={cn("relative shrink-0 overflow-hidden bg-white", viewport === "desktop" ? "rounded-[20px]" : "rounded-[18px] shadow-2xl ring-1 ring-border")}
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
  { label: "Writing Content", icon: SquarePen, stages: ["generate", "repair"] },
  { label: "Designing Slides", icon: ImageIcon, stages: ["review", "images", "validate"] },
  { label: "Finalizing", icon: Layers, stages: ["finalize"] },
];

/**
 * The Figma frame "Editor – Generating" (Present 3D page): a 996×640 card. Its art
 * (background with stars and waves, the slide-stack icon, the "AI is working" badge)
 * comes from the design's own images in public/brand; the title, progress and steps
 * are drawn here at the design's positions so they follow the job. Every number
 * below is in the design's pixels; the card is scaled as a whole to fit the pane.
 */
const CARD = { w: 996, h: 640 };
const STEP_X = [200, 396, 593, 789];
const STEP_Y = 480;
const DOT = 43;

function GeneratingSkeleton({ box }: { box: { w: number; h: number } }) {
  const job = useWorkspace((s) => s.job);
  const pct = Math.round(Math.min(0.97, Math.max(0.03, job?.progress ?? 0)) * 100);
  // The step running now: the last one any of whose stages has started (or finished).
  const active = Math.max(0, ...STEPS.map((s, i) => (s.stages.some((id) => job?.stages[id]) ? i : 0)));
  const scale = box.w && box.h ? Math.min(box.w / CARD.w, box.h / CARD.h) : 0;

  return (
    <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
      <div className="relative shrink-0 animate-rise" style={{ width: CARD.w * scale, height: CARD.h * scale }}>
        <div
          className="absolute top-0 left-0 overflow-hidden rounded-[24px] shadow-[0_0_60px_rgb(0_166_237/0.35)]"
          style={{ width: CARD.w, height: CARD.h, transform: `scale(${scale})`, transformOrigin: "0 0", background: "linear-gradient(180deg, #050b16 0%, #06182a 60%, #04101c 100%)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed design art, drawn at the design's size */}
          <img src="/brand/generating-bg.webp" alt="" className="absolute max-w-none select-none" style={{ left: -102, top: 0, width: 1144, height: 640 }} draggable={false} />
          {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
          <img src="/brand/generating-badge.webp" alt="" className="absolute select-none" style={{ left: 30, top: 30, width: 130, height: 37 }} draggable={false} />
          <span className="sr-only">AI is working</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
          <img src="/brand/generating-icon.webp" alt="" className="absolute select-none animate-float motion-reduce:animate-none" style={{ left: 393, top: 56, width: 226, height: 181 }} draggable={false} />

          <p className="absolute inset-x-0 text-center leading-none font-bold tracking-[0.005em] text-white [text-shadow:0_0_14px_rgb(120_220_255/0.35)]" style={{ top: 275, fontSize: 35 }}>
            Generating Your <span className="text-[#10b6e8]">Presentation</span>
          </p>
          <p className="absolute inset-x-0 text-center leading-none font-medium tracking-[0.012em] text-[#3cc7ee]" style={{ top: 330, fontSize: 19.5 }}>
            Creating slides, adding content, and designing for you...
          </p>

          {/* Progress: track, fill with a glowing head, and the percentage */}
          <div className="absolute rounded-full bg-[#004a5d]" style={{ left: 89, top: 397, width: 732, height: 18 }}>
            <div
              className="relative h-full rounded-full shadow-[0_0_16px_rgb(0_200_255/0.55)] transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, #00c3f3 0%, #00a4cd 45%, #12c4f2 74%, #a8efff 93%, #ffffff 100%)" }}
            >
              <span className="absolute top-0 right-0 h-full w-[30px] translate-x-1/4 rounded-full bg-[linear-gradient(90deg,rgb(180_240_255/0.6),#f4fdff_55%,#ffffff)] shadow-[0_0_14px_4px_rgb(90_220_255/0.7)]" />
            </div>
          </div>
          <span className="absolute leading-none font-bold tabular-nums text-[#f7feff]" style={{ left: 848, top: 397, fontSize: 23 }}>{pct}%</span>

          {/* Steps: lines between the circles, then the circles and their labels */}
          {STEP_X.slice(1).map((x, i) => (
            <span key={x} className="absolute h-[2px] bg-[#00566b]" style={{ left: STEP_X[i] + DOT / 2 + 9, width: x - STEP_X[i] - DOT - 18, top: STEP_Y - 1 }} aria-hidden="true" />
          ))}
          {STEPS.map((s, i) => {
            const state = i < active ? "done" : i === active ? "active" : "todo";
            const Icon = state === "done" ? Check : s.icon;
            return (
              <div key={s.label} aria-current={state === "active" ? "step" : undefined}>
                <span
                  className={cn(
                    "absolute flex items-center justify-center rounded-full transition-colors",
                    state === "done" && "bg-[radial-gradient(circle_at_50%_35%,#2ad0f7,#0098c9)] text-white shadow-[0_0_14px_rgb(0_190_240/0.5)]",
                    state === "active" && "border-2 border-[#d9f8ff] bg-[radial-gradient(circle_at_50%_40%,#0089aa,#004d62)] text-white shadow-[0_0_16px_rgb(70_215_255/0.7)]",
                    state === "todo" && "border-[1.5px] border-[#007d9c] bg-[#001e25] text-[#39c6eb]",
                  )}
                  style={{ left: STEP_X[i] - DOT / 2, top: STEP_Y - DOT / 2, width: DOT, height: DOT }}
                >
                  <Icon className="size-[19px]" strokeWidth={state === "done" ? 3 : 2.2} />
                </span>
                <span className={cn("absolute w-40 text-center leading-none font-semibold whitespace-nowrap", state === "todo" ? "text-[#39c6eb]" : "text-white")} style={{ left: STEP_X[i] - 80, top: 513, fontSize: 15.5 }}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
