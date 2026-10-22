"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, TriangleAlert, Presentation } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { createPresentation } from "@/lib/create-presentation";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

type ConfigResponse = { config: { aiProvider: string; openai: { configured: boolean } } };

const PROMPTS = [
  "Investor pitch for an AI fitness app: problem, solution, market size, traction, business model and the ask. 8 slides, bold and futuristic.",
  "The solar system for a school class: the Sun, each planet with one surprising fact, and a closing quiz slide.",
  "Quarterly business review: revenue up 42%, 3 new markets, key wins, risks and next-quarter goals. Clean corporate style.",
  "Product launch for a smartwatch: hero reveal, 3 key features, specs in numbers, pricing and launch date.",
];

const OPTIONS = [
  { label: "5 slides", add: "Use 5 slides." },
  { label: "10 slides", add: "Use 10 slides." },
  { label: "Minimal", add: "Minimal, elegant style with lots of space." },
  { label: "Bold & neon", add: "Bold neon colours and energetic 3D scenes." },
];

/** Start a new 3D presentation from a prompt. */
export function NewChat() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<{ configured: boolean; mock: boolean } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    api<ConfigResponse>("/api/config").then(
      (r) => setAi({ configured: r.config.aiProvider === "mock" || r.config.openai.configured, mock: r.config.aiProvider === "mock" }),
      () => setAi(null),
    );
  }, []);

  async function start(prompt: string) {
    if (busy) return;
    const text = prompt.trim();
    if (!text) {
      toast.error("Describe your presentation first.");
      input.current?.focus();
      return;
    }
    setBusy(true);
    try {
      // One request creates the presentation and queues its generation; the workspace shows progress immediately.
      router.push(await createPresentation(text));
    } catch (e) {
      if (e instanceof ApiError && e.code === "AI_NOT_CONFIGURED") setAi({ configured: false, mock: false });
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }

  useEffect(() => {
    const p = params.get("prompt");
    if (p && !autoStarted.current) {
      autoStarted.current = true;
      void start(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const addOption = (add: string) => {
    setValue((v) => (v.includes(add) ? v : `${v.trim()}${v.trim() ? " " : ""}${add}`));
    input.current?.focus();
  };

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-12 sm:px-6">
        <div className="text-center">
          <LogoMark className="mx-auto size-9" />
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Create a 3D presentation</h1>
          <p className="mt-2 text-sm text-muted-foreground">Describe your topic. AI writes the slides and gives every slide its own animated 3D scene.</p>
        </div>

        {ai && !ai.configured && (
          <p className="mx-auto mt-6 flex max-w-xl items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> AI is not configured on this server. Set OPENAI_API_KEY and OPENAI_MODEL in .env and restart.
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void start(input.current?.value ?? value);
          }}
          className="mt-8 rounded-2xl border border-border bg-card p-2 focus-within:border-brand/50"
        >
          <textarea
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void start(input.current?.value ?? value);
              }
            }}
            rows={4}
            maxLength={8000}
            autoFocus
            placeholder="e.g. A pitch deck for my coffee startup: problem, solution, market, team and funding ask…"
            aria-label="Describe your presentation"
            className="w-full resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-2 px-2 pb-1">
            <div className="flex flex-1 flex-wrap gap-1.5">
              {OPTIONS.map((o) => (
                <button key={o.label} type="button" onClick={() => addOption(o.add)} className={cn("rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition hover:border-brand/40 hover:text-foreground", value.includes(o.add) && "border-brand/50 text-foreground")}>
                  {o.label}
                </button>
              ))}
            </div>
            <button type="submit" disabled={busy} aria-label="Create presentation" className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-brand-foreground transition hover:bg-brand/85 disabled:opacity-50">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} Create
            </button>
          </div>
        </form>

        <p className="mt-8 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Presentation className="size-3.5" /> Try one of these
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setValue(p);
                input.current?.focus();
              }}
              className="rounded-xl border border-border px-3.5 py-3 text-left text-xs leading-relaxed text-muted-foreground transition hover:border-brand/40 hover:text-foreground"
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
