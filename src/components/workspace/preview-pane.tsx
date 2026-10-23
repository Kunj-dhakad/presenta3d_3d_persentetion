"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Tablet, Smartphone, RotateCw, ExternalLink, AlertTriangle, Loader2, Wand2, ChevronDown, ChevronUp, Play, CircleCheck } from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { formatDiagnostic, type PreviewMessage } from "@/lib/build-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VIEWPORTS = {
  desktop: { label: "Desktop", icon: Monitor, w: null as number | null, h: null as number | null },
  tablet: { label: "Tablet (820×1180)", icon: Tablet, w: 820, h: 1180 },
  mobile: { label: "Mobile (390×844)", icon: Smartphone, w: 390, h: 844 },
};
type ViewportId = keyof typeof VIEWPORTS;

export function PreviewPane({ onFixWithAI, busy }: { onFixWithAI: (errors: string[]) => void; busy: boolean }) {
  const build = useWorkspace((s) => s.build);
  const nonce = useWorkspace((s) => s.previewNonce);
  const runtimeErrors = useWorkspace((s) => s.runtimeErrors);
  const { refreshPreview, pushRuntimeError, runBuild, openFile } = useWorkspace.getState();
  const [viewport, setViewport] = useState<ViewportId>("desktop");
  const [showIssues, setShowIssues] = useState(true);
  const [loading, setLoading] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Messages from the sandboxed preview: accept only those from our iframe's window.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as PreviewMessage;
      if (!d || d.source !== "deck3d-preview") return;
      if (d.type === "ready") setLoading(false);
      else pushRuntimeError(d);
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
  if (prevSrc !== src) {
    setPrevSrc(src);
    setLoading(Boolean(src));
  }

  const vp = VIEWPORTS[viewport];
  const scale = vp.w && vp.h && box.w && box.h ? Math.min(1, (box.w - 32) / vp.w, (box.h - 32) / vp.h) : 1;
  const errors = build.status === "failed" ? build.errors : [];
  const runtime = runtimeErrors.flatMap((e) => (e.type === "ready" ? [] : [e]));
  const issueCount = errors.length + runtime.length;
  const issueTexts = [...errors.map(formatDiagnostic), ...runtime.map((r) => `${r.type}: ${r.message}${r.file ? ` (${r.file}:${r.line})` : ""}`)];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Preview size">
          {(Object.keys(VIEWPORTS) as ViewportId[]).map((id) => {
            const V = VIEWPORTS[id];
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button role="radio" aria-checked={viewport === id} aria-label={V.label} onClick={() => setViewport(id)} className={cn("flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground", viewport === id && "bg-accent text-foreground")}>
                    <V.icon className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{V.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <div className="mx-2 flex min-w-0 flex-1 items-center gap-2 rounded-md bg-background/60 px-2 py-1 text-[11.5px] text-muted-foreground">
          {build.status === "building" ? <Loader2 className="size-3 shrink-0 animate-spin text-brand" /> : build.status === "failed" ? <AlertTriangle className="size-3 shrink-0 text-destructive" /> : build.previewUrl ? <CircleCheck className="size-3 shrink-0 text-success" /> : <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />}
          <span className="truncate font-mono">{build.status === "building" ? "Building…" : build.previewUrl ? "sandboxed preview · opaque origin" : "No preview yet"}</span>
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

      <div ref={boxRef} className={cn("relative min-h-0 flex-1 overflow-hidden", viewport !== "desktop" && "grid-dots flex items-center justify-center")}>
        {src ? (
          <div
            style={vp.w && vp.h ? { width: vp.w, height: vp.h, transform: `scale(${scale})`, transformOrigin: "center" } : { width: "100%", height: "100%" }}
            className={cn("relative shrink-0 bg-white", viewport !== "desktop" && "overflow-hidden rounded-[18px] shadow-2xl ring-1 ring-border")}
          >
            <iframe
              key={src}
              ref={frameRef}
              src={src}
              title="Project preview"
              // No allow-same-origin: the document gets an opaque origin (the server also sends a CSP sandbox).
              sandbox="allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads"
              allow="fullscreen; accelerometer; gyroscope"
              referrerPolicy="no-referrer"
              className="size-full border-0 bg-white"
              onLoad={() => setTimeout(() => setLoading(false), 300)}
            />
            {loading && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
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
                <p className="max-w-xs text-xs text-muted-foreground">{build.status === "failed" ? "The build failed. Fix the errors below or ask the AI to repair them." : "Describe what to build in the chat, or add files and press Build."}</p>
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
