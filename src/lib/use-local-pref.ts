"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked (private mode, sandbox)
  }
}

/**
 * A per-browser UI preference (view mode, last tab). Server render and first
 * hydration use `fallback`; storage failures silently fall back too.
 */
export function useLocalPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const v = read(key);
      return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
    },
    () => fallback,
  );
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, v);
      } catch {
        /* ignore */
      }
      for (const l of listeners) l();
    },
    [key],
  );
  return [value, set];
}
