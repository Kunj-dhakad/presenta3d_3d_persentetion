"use client";

import { useRef } from "react";
import { useDeckRemote } from "@/components/present/use-deck-remote";

/**
 * Read-only view of a shared presentation: full screen with no chrome
 * (keyboard, click, swipe and mouse wheel all navigate).
 */
export function ShareViewer({ name, previewUrl }: { name: string; previewUrl: string | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useDeckRemote(frame);

  return previewUrl ? (
    <iframe
      ref={frame}
      src={previewUrl}
      title={name}
      sandbox="allow-scripts allow-popups"
      allow="fullscreen"
      className="fixed inset-0 size-full border-0 bg-black"
      onLoad={() => frame.current?.focus()}
    />
  ) : (
    <div className="flex h-dvh items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">This presentation has no preview yet.</div>
  );
}
