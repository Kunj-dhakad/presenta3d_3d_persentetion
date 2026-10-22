"use client";

import { useEffect, type RefObject } from "react";

const KEY_ACTIONS: Record<string, "next" | "prev" | "first" | "last"> = {
  ArrowRight: "next",
  ArrowDown: "next",
  PageDown: "next",
  " ": "next",
  Enter: "next",
  ArrowLeft: "prev",
  ArrowUp: "prev",
  PageUp: "prev",
  Backspace: "prev",
  Home: "first",
  End: "last",
};

/**
 * Keyboard control for a presentation iframe. When the hosting page has focus
 * (e.g. right after opening a link), keys are forwarded to the deck via
 * postMessage; when the deck itself has focus it handles them directly.
 * Also focuses the deck once it has loaded.
 */
export function useDeckRemote(frameRef: RefObject<HTMLIFrameElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      const action = KEY_ACTIONS[e.key];
      if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      frameRef.current?.contentWindow?.postMessage({ type: "strata-deck", action }, "*");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frameRef]);
}
