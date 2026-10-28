"use client";

import { useEffect, useState } from "react";
import { setAccessToken } from "@/lib/api-client";
import { allowedParentOrigin, inIframe, notifyParent, setParentOrigin, setParentSite } from "./parent-bridge";

type State = "waiting" | "ready" | "no-parent";

/**
 * Renders the embedded pages once the PHP page has handed over the user's
 * access token (INIT_DATA); every API call carries it from then on.
 */
export function EmbedGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("waiting");

  useEffect(() => {
    if (!inIframe()) {
      const token = new URLSearchParams(window.location.search).get("token");
      if (token) setAccessToken(token);
      // Reading the URL once on mount is the only way to get it on the client.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(token ? "ready" : "no-parent");
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !allowedParentOrigin(event.origin)) return;
      const message = event.data;
      if (message?.type !== "INIT_DATA" || typeof message.token !== "string" || !message.token) return;
      setParentOrigin(event.origin);
      if (typeof message.URL === "string") setParentSite(message.URL);
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

  if (state === "no-parent") {
    return (
      <main className="flex h-dvh items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold">Open 3D presentations from your dashboard</h1>
          <p className="text-sm text-muted-foreground">This page opens inside the presentation app, which signs you in. For development, add ?token=&lt;access token&gt; to this address.</p>
        </div>
      </main>
    );
  }
  // The PHP page shows its own loader until LOADER_OFF.
  if (state === "waiting") return null;
  return <>{children}</>;
}
