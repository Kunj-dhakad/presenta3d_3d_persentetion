"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Tablet, Smartphone, RotateCw, ExternalLink, AlertTriangle, Loader2, Wand2, ChevronDown, ChevronUp, Play, CircleCheck, Sparkles } from "lucide-react";
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

  const src = build.previewUrl ? `${build.previewUrl}?v=${nonce}` : null;
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

/** What the job is doing, in the order it happens (the latest started stage is shown). */
const STAGE_LABELS: [PipelineStage, string][] = [
  ["understand", "Reading your request"],
  ["plan", "Planning the story"],
  ["generate", "Writing the slides"],
  ["repair", "Polishing the slides"],
  ["review", "Reviewing the slides"],
  ["images", "Creating the images"],
  ["validate", "Checking everything"],
  ["build", "Putting it all together"],
  ["finalize", "Finishing up"],
];
/** A wireframe cube turning in 3D, as the slides' scenes do. */
function Cube({ size }: { size: number }) {
  const half = size / 2;
  const faces = [`translateZ(${half}px)`, `rotateY(180deg) translateZ(${half}px)`, `rotateY(90deg) translateZ(${half}px)`, `rotateY(-90deg) translateZ(${half}px)`, `rotateX(90deg) translateZ(${half}px)`, `rotateX(-90deg) translateZ(${half}px)`];
  return (
    <div style={{ width: size, height: size, perspective: size * 6 }} aria-hidden="true">
      <div className="relative size-full animate-spin-3d motion-reduce:animate-none" style={{ transformStyle: "preserve-3d" }}>
        {faces.map((t, i) => (
          <span key={i} className="absolute inset-0 border border-brand-3/80 bg-brand-2/15 shadow-[inset_0_0_18px_rgb(1_196_249/0.35)]" style={{ transform: t }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Shown instead of the preview while a presentation is being made or changed:
 * nothing half-made (slides without their images or scenes) is ever shown; the
 * finished presentation appears at once when the job completes. One slide-shaped
 * stage in the deck's dark look, centred in the pane, with the progress in its
 * middle.
 */
function GeneratingSkeleton({ box }: { box: { w: number; h: number } }) {
  const job = useWorkspace((s) => s.job);
  const current = [...STAGE_LABELS].reverse().find(([id]) => job?.stages[id]?.state === "start");
  const label = current?.[1] ?? "Getting started";
  const pct = Math.round(Math.min(0.97, Math.max(0.03, job?.progress ?? 0)) * 100);
  // The slide fits the pane, whichever way it is limited.
  const w = box.w && box.h ? Math.max(200, Math.min(box.w - 40, 1040, (box.h - 40) * (16 / 9))) : 0;
  const compact = w < 480;
  const cube = Math.round(w * 0.09);

  return (
    <div className="flex h-full items-center justify-center overflow-hidden p-4" role="status" aria-live="polite">
      <div className="relative shrink-0 animate-rise" style={{ width: w || "100%" }}>
        <div className="absolute -inset-1.5 rounded-[24px] bg-brand-gradient opacity-40 blur-xl animate-breathe motion-reduce:animate-none" aria-hidden="true" />
        <div className="relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-2xl bg-[#06101c] shadow-[0_30px_70px_-24px_rgb(0_136_204/0.45)] ring-1 ring-white/10">
          <div className="absolute inset-0" style={{ background: "radial-gradient(60% 80% at 82% 28%, rgb(1 196 249 / 0.32), transparent 70%), radial-gradient(50% 60% at 8% 100%, rgb(0 136 204 / 0.38), transparent 70%)" }} aria-hidden="true" />
          <div className="absolute inset-x-[-20%] bottom-[-30%] h-[70%] opacity-50" style={{ backgroundImage: "linear-gradient(rgb(0 166 238 / 0.35) 1px, transparent 1px), linear-gradient(90deg, rgb(0 166 238 / 0.35) 1px, transparent 1px)", backgroundSize: "28px 28px", transform: "perspective(300px) rotateX(60deg)" }} aria-hidden="true" />
          {[["12%", "24%", "0s"], ["78%", "18%", ".6s"], ["42%", "80%", "1.1s"], ["88%", "66%", ".3s"], ["18%", "68%", "1.5s"], ["62%", "12%", ".9s"]].map(([x, y, d]) => (
            <span key={x + y} className="absolute size-[3px] rounded-full bg-white animate-breathe motion-reduce:animate-none" style={{ left: x, top: y, animationDelay: d }} aria-hidden="true" />
          ))}
          <div className="absolute top-[-10%] right-[6%] size-[36%] rounded-full bg-brand-3/25 blur-2xl animate-float motion-reduce:animate-none" aria-hidden="true" />
          <div className="absolute bottom-[-18%] left-[14%] size-[32%] rounded-full bg-brand/30 blur-2xl animate-float-slow motion-reduce:animate-none" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-[30%] bg-gradient-to-r from-transparent via-white/10 to-transparent animate-sweep motion-reduce:animate-none" aria-hidden="true" />
          <div className="absolute top-[5%] left-[4%] flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white/80 backdrop-blur" aria-hidden="true">
            <Sparkles className="size-3 text-brand-3" /> AI is writing
          </div>

          {/* The progress, in the middle of the slide */}
          <div className="relative flex w-[62%] flex-col items-center text-center text-white">
            <div className="animate-float motion-reduce:animate-none" style={{ marginBottom: cube * 0.6 }}>
              <Cube size={cube} />
            </div>
            <p className={cn("font-bold", compact ? "text-sm" : "text-lg")}>Creating your presentation</p>
            <p className={cn("mt-0.5 flex items-center gap-1 text-white/65", compact ? "text-[11px]" : "text-sm")}>
              <span className="truncate">{label}</span>
              <span className="inline-flex gap-[3px] pl-0.5" aria-hidden="true">
                {[0, 1, 2].map((i) => <span key={i} className="size-1 rounded-full bg-brand-3 animate-dots motion-reduce:animate-none" style={{ animationDelay: `${i * 150}ms` }} />)}
              </span>
            </p>
            <div className={cn("p3-shimmer p3-shimmer-dark w-full overflow-hidden rounded-full bg-white/15", compact ? "mt-3 h-1.5" : "mt-5 h-2")}>
              <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
            </div>
            <p className={cn("mt-2 font-extrabold tabular-nums", compact ? "text-base" : "text-2xl")}>{pct}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}
