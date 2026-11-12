"use client";

import { useCallback, useSyncExternalStore } from "react";
import { TEXT_MODELS } from "@/lib/ai-models";

/** The AI model chosen in the chat's dropdown, remembered in this browser. */
const KEY = "p3d-text-model";
const EVENT = "p3d-text-model-change";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
// Used when the browser refuses storage (private window): the choice lasts until reload.
let memory: string | null = null;
function read(): string | null {
  let v = memory;
  try {
    v = localStorage.getItem(KEY) ?? memory;
  } catch {
    /* storage blocked */
  }
  return v && TEXT_MODELS.some((m) => m.id === v) ? v : null;
}

/** [the chosen model (null: the server's default), choose]. */
export function useChosenModel(): [string | null, (model: string) => void] {
  const model = useSyncExternalStore(subscribe, read, () => null);
  const choose = useCallback((m: string) => {
    memory = m;
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* storage blocked: kept in memory */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [model, choose];
}
