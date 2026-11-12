"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Tablet, Smartphone, RotateCw, ExternalLink, AlertTriangle, Loader2, Wand2, ChevronDown, ChevronUp, Play, CircleCheck, Sparkles, Check, ScanSearch, SquarePen, Image as ImageIcon, Layers } from "lucide-react";
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
      <div ref={boxRef} className={cn("relative min-h-0 flex-1 overflow-hidden", viewport === "desktop" || busy ? "p-4 sm:p-5" : "grid-dots flex items-center justify-center")}>
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
  { label: "Writing Content", icon: SquarePen, stages: ["generate", "repair"] },
  { label: "Designing Slides", icon: ImageIcon, stages: ["review", "images", "validate"] },
  { label: "Finalizing", icon: Layers, stages: ["finalize"] },
];

/** The glossy stack of two slides from the design (the front one with a header and a picture). */
function SlideStack({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 1.08} viewBox="0 0 120 130" className="drop-shadow-[0_8px_22px_rgb(1_196_249/0.7)]" aria-hidden="true">
      <defs>
        <linearGradient id="p3-gen-back" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fe3ff" />
          <stop offset="1" stopColor="#1576d6" />
        </linearGradient>
        <linearGradient id="p3-gen-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6fe6ff" />
          <stop offset=".45" stopColor="#1ea8f7" />
          <stop offset="1" stopColor="#0a4fc0" />
        </linearGradient>
        <linearGradient id="p3-gen-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="36" y="6" width="74" height="90" rx="13" fill="url(#p3-gen-back)" opacity=".8" stroke="#fff" strokeOpacity=".45" strokeWidth="1.5" />
      <rect x="12" y="28" width="80" height="94" rx="13" fill="url(#p3-gen-front)" stroke="#fff" strokeOpacity=".7" strokeWidth="1.5" />
      <rect x="12" y="28" width="80" height="50" rx="13" fill="url(#p3-gen-gloss)" />
      <rect x="24" y="40" width="26" height="16" rx="3" fill="#fff" fillOpacity=".92" />
      <rect x="56" y="42" width="24" height="4.5" rx="2.2" fill="#fff" fillOpacity=".9" />
      <rect x="56" y="51" width="17" height="4.5" rx="2.2" fill="#fff" fillOpacity=".7" />
      <rect x="24" y="66" width="56" height="42" rx="6" fill="none" stroke="#fff" strokeWidth="4.5" />
      <circle cx="38" cy="79" r="4.5" fill="#fff" />
      <path d="M28 104 L45 87 L55 97 L63 89 L76 104 Z" fill="#fff" />
    </svg>
  );
}

/** A four-pointed star, as sprinkled over the design's background. */
function Twinkle({ x, y, size, delay }: { x: string; y: string; size: number; delay: string }) {
  return (
    <svg className="absolute text-white animate-breathe motion-reduce:animate-none" style={{ left: x, top: y, width: size, height: size, animationDelay: delay }} viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 0 C5.4 3.6 6.4 4.6 10 5 C6.4 5.4 5.4 6.4 5 10 C4.6 6.4 3.6 5.4 0 5 C3.6 4.6 4.6 3.6 5 0 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Shown instead of the preview while a presentation is being made or changed:
 * nothing half-made (slides without their images or scenes) is ever shown; the
 * finished presentation appears at once when the job completes. As in the
 * design (Figma "Editor – Generating"): a dark card filling the pane with the
 * progress and its four steps; every size follows the card's width.
 */
function GeneratingSkeleton({ box }: { box: { w: number; h: number } }) {
  const job = useWorkspace((s) => s.job);
  const pct = Math.round(Math.min(0.97, Math.max(0.03, job?.progress ?? 0)) * 100);
  // The step running now: the last one any of whose stages has started (or finished).
  const active = Math.max(0, ...STEPS.map((s, i) => (s.stages.some((id) => job?.stages[id]) ? i : 0)));
  // The design's unit: the card's width, unless the pane is too short for the content at that size.
  const u = box.w && box.h ? Math.max(300, Math.min(box.w, box.h / 0.68, 1100)) : 0;
  const px = (k: number) => Math.round(u * k * 10) / 10;
  const compact = u < 440;
  const dot = px(0.046);

  return (
    <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
      <div className="relative flex size-full animate-rise flex-col items-center justify-center overflow-hidden rounded-2xl bg-[#04182a] shadow-[0_0_0_1px_rgb(1_196_249/0.25),0_0_28px_rgb(1_196_249/0.35)]">
        {/* Background: a soft light behind the middle, faint light columns at the top, stars */}
        <div className="absolute inset-0" style={{ background: "radial-gradient(50% 45% at 50% 38%, rgb(18 120 190 / 0.32), transparent 72%), linear-gradient(180deg, #06223a 0%, #04182a 55%, #031321 100%)" }} aria-hidden="true" />
        <div className="absolute inset-x-[30%] top-0 flex h-[42%] items-start justify-between opacity-35" aria-hidden="true">
          {[0.55, 0.8, 0.45, 0.95, 0.6, 0.75, 0.5].map((h, i) => (
            <span key={i} className="w-[9%] bg-linear-to-b from-[#1a5f8f]/50 to-transparent" style={{ height: `${h * 100}%` }} />
          ))}
        </div>
        <Twinkle x="19%" y="12%" size={px(0.016)} delay="0s" />
        <Twinkle x="15%" y="34%" size={px(0.01)} delay=".8s" />
        <Twinkle x="77%" y="9%" size={px(0.012)} delay="1.3s" />
        {[["10%", "47%", ".4s"], ["83%", "29%", "1s"], ["92%", "22%", ".2s"], ["88%", "45%", "1.6s"], ["70%", "40%", ".6s"]].map(([x, y, d]) => (
          <span key={x + y} className="absolute size-0.5 rounded-full bg-white/80 animate-breathe motion-reduce:animate-none" style={{ left: x, top: y, animationDelay: d }} aria-hidden="true" />
        ))}
        {/* Glowing waves along the bottom */}
        <svg className="absolute inset-x-0 bottom-0 h-[18%] w-full" viewBox="0 0 1000 180" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="p3-gen-wave" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#1ec8ff" stopOpacity=".9" />
              <stop offset=".45" stopColor="#1ec8ff" stopOpacity=".15" />
              <stop offset="1" stopColor="#1ec8ff" stopOpacity=".95" />
            </linearGradient>
          </defs>
          <path d="M0 110 C 200 40 380 170 560 120 S 860 60 1000 90 V180 H0 Z" fill="rgb(13 110 180 / 0.18)" />
          <path d="M0 150 C 240 90 420 190 640 140 S 900 100 1000 130 V180 H0 Z" fill="rgb(1 150 230 / 0.16)" />
          <path d="M0 110 C 200 40 380 170 560 120 S 860 60 1000 90" fill="none" stroke="url(#p3-gen-wave)" strokeWidth="2.5" />
          <path d="M0 150 C 240 90 420 190 640 140 S 900 100 1000 130" fill="none" stroke="url(#p3-gen-wave)" strokeWidth="1.5" opacity=".7" />
        </svg>

        <div className="absolute flex items-center gap-1.5 rounded-full border border-brand-3/35 bg-[#062a44]/80 font-semibold text-white backdrop-blur" style={{ left: px(0.033), top: px(0.033), padding: `${px(0.005)}px ${px(0.014)}px`, fontSize: Math.max(10, px(0.014)) }} aria-hidden="true">
          <Sparkles className="text-brand-3" style={{ width: Math.max(10, px(0.015)), height: Math.max(10, px(0.015)) }} /> AI is working
        </div>

        <div className="relative flex flex-col items-center text-center text-white" style={{ width: px(0.82), marginBottom: px(0.03) }}>
          {!compact && (
            <div className="animate-float motion-reduce:animate-none" style={{ marginBottom: px(0.04) }}>
              <SlideStack size={px(0.118)} />
            </div>
          )}
          <p className="leading-tight font-bold tracking-tight" style={{ fontSize: Math.max(16, px(0.036)) }}>
            Generating Your <span className="text-[#22c3ff]">Presentation</span>
          </p>
          {!compact && (
            <p className="text-[#56c6f5]" style={{ marginTop: px(0.018), fontSize: px(0.021) }}>
              Creating slides, adding content, and designing for you…
            </p>
          )}

          {/* Progress bar with a glowing head, and the percentage beside it */}
          <div className="flex w-full items-center" style={{ marginTop: px(compact ? 0.03 : 0.048), gap: px(0.016) }}>
            <div className="relative flex-1 rounded-full bg-[#0a2c47] ring-1 ring-[#1d5c88]/60" style={{ height: Math.max(6, px(0.016)) }}>
              <div className="relative h-full rounded-full bg-linear-to-r from-[#0b4f8c] via-[#119bea] to-[#3fd6ff] shadow-[0_0_14px_rgb(1_196_249/0.55)] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }}>
                <span className="absolute top-1/2 right-0 translate-x-1/3 -translate-y-1/2 rounded-full bg-[#dff7ff] shadow-[0_0_10px_5px_rgb(63_214_255/0.85)]" style={{ width: px(0.03), height: Math.max(6, px(0.016)) }} />
              </div>
            </div>
            <span className="shrink-0 font-bold tabular-nums" style={{ fontSize: Math.max(13, px(0.026)) }}>{pct}%</span>
          </div>

          {/* The four steps, joined by lines that light up as they finish */}
          <ol className="relative grid grid-cols-4" style={{ width: px(0.8), marginTop: px(compact ? 0.035 : 0.045) }}>
            {STEPS.slice(1).map((s, i) => (
              <span key={s.label} className={cn("absolute h-[1.5px] transition-colors", i < active ? "bg-[#22c3ff]" : "bg-[#1f557c]")} style={{ top: dot / 2, left: `calc(${12.5 + i * 25}% + ${dot / 2 + 4}px)`, width: `calc(25% - ${dot + 8}px)` }} aria-hidden="true" />
            ))}
            {STEPS.map((s, i) => {
              const state = i < active ? "done" : i === active ? "active" : "todo";
              const Icon = state === "done" ? Check : s.icon;
              return (
                <li key={s.label} className="relative flex flex-col items-center" aria-current={state === "active" ? "step" : undefined}>
                  <span
                    className={cn(
                      "flex items-center justify-center rounded-full transition-colors",
                      state === "done" && "bg-linear-to-b from-[#3fd6ff] to-[#0f9fe8] text-white shadow-[0_0_16px_rgb(1_196_249/0.6)]",
                      state === "active" && "bg-[#062a44] text-[#bfefff] ring-2 ring-[#29c6ff] shadow-[0_0_18px_rgb(1_196_249/0.65)]",
                      state === "todo" && "bg-[#06213a] text-[#5bb8ec] ring-[1.5px] ring-[#2a6f9e]",
                    )}
                    style={{ width: dot, height: dot }}
                  >
                    <Icon style={{ width: dot * 0.48, height: dot * 0.48 }} strokeWidth={state === "done" ? 3 : 2.2} />
                  </span>
                  <span className={cn("font-bold whitespace-nowrap", state === "todo" ? "text-[#4fb0e6]" : "text-white")} style={{ marginTop: px(0.014), fontSize: Math.max(9, px(0.0185)) }}>
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
