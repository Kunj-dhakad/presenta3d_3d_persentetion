"use client";

import { useSyncExternalStore } from "react";

/** Subscribe to a CSS media query. Returns `serverFallback` during server rendering. */
export function useMediaQuery(query: string, serverFallback = true): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverFallback,
  );
}
