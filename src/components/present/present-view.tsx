"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Maximize } from "lucide-react";
import { useDeckRemote } from "./use-deck-remote";

/**
 * Full-page presentation: the deck runs in a sandboxed iframe that fills the
 * viewport. Controls fade out while presenting and reappear on mouse movement.
 */
export function PresentView({ projectId, name, url }: { projectId: string; name: string; url: string | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [controls, setControls] = useState(true);
  useDeckRemote(frame);

  useEffect(() => {
    let timer = setTimeout(() => setControls(false), 2500);
    const show = () => {
      setControls(true);
      clearTimeout(timer);
      timer = setTimeout(() => setControls(false), 2500);
    };
    window.addEventListener("pointermove", show);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", show);
    };
  }, []);

  if (!url) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-background text-center">
        <p className="text-sm">“{name}” has no preview yet.</p>
        <Link href={`/chat/${projectId}`} className="text-sm text-brand hover:underline">Back to the editor</Link>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black">
      <iframe
        ref={frame}
        src={url}
        title={name}
        // Opaque-origin sandbox, like the editor preview. Fullscreen is allowed for the deck's F key.
        sandbox="allow-scripts allow-popups"
        allow="fullscreen"
        className="size-full border-0"
        onLoad={() => frame.current?.focus()}
      />
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-linear-to-b from-black/70 to-transparent p-4 transition-opacity duration-300 ${controls ? "opacity-100" : "opacity-0"}`}>
        <Link href={`/chat/${projectId}`} className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm text-white backdrop-blur hover:bg-white/20">
          <ArrowLeft className="size-4" /> Exit
        </Link>
        <span className="truncate text-sm text-white/80">{name}</span>
        <span className="ml-auto" />
        <button
          onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
          className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm text-white backdrop-blur hover:bg-white/20"
        >
          <Maximize className="size-4" /> Fullscreen
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm text-white backdrop-blur hover:bg-white/20">
          <ExternalLink className="size-4" /> New tab
        </a>
      </div>
    </div>
  );
}
