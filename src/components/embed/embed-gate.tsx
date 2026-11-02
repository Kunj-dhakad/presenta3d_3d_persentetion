"use client";

import { useEffect, useState } from "react";
import { setAccessToken } from "@/lib/api-client";
import { allowedParentOrigin, inIframe, notifyParent, setParentBranding, setParentOrigin, setParentSite } from "./parent-bridge";

type State = "waiting" | "ready";

/**
 * Renders the embedded pages once the PHP page has handed over the user's
 * access token (INIT_DATA); every API call carries it from then on.
 * Opened directly (not in an iframe), the pages run at once: with ?token=
 * as that user, otherwise as the guest user (see src/server/auth/php-token.ts).
 */
export function EmbedGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("waiting");

  useEffect(() => {
    if (!inIframe()) {
      const token = new URLSearchParams(window.location.search).get("token");
      if (token) setAccessToken(token);
      // Reading the URL once on mount is the only way to get it on the client.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("ready");
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !allowedParentOrigin(event.origin)) return;
      const message = event.data;
      if (message?.type !== "INIT_DATA" || typeof message.token !== "string" || !message.token) return;
      setParentOrigin(event.origin);
      if (typeof message.URL === "string") setParentSite(message.URL);
      setParentBranding(message.branding);
      setAccessToken(message.token);
      setState("ready");
    };
    window.addEventListener("message", onMessage);
    // REACT_READY carries nothing secret, so any parent may hear it.
    window.parent.postMessage({ type: "REACT_READY" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (state === "ready") notifyParent("LOADER_OFF");
  }, [state]);

  // The PHP page shows its own loader until LOADER_OFF.
  if (state === "waiting") return null;
  return <>{children}</>;
}
