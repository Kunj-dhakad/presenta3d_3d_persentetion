"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api-client";
import { createPresentation } from "@/lib/create-presentation";

const EXAMPLES = [
  "An investor pitch for an AI fitness app, 8 slides, bold and futuristic",
  "The solar system for a school class, with one surprising fact per planet",
  "A quarterly business review with revenue growth and next-quarter goals",
  "A product launch for a smartwatch: reveal, features, specs and price",
];

export function LandingPrompt({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function go(prompt: string) {
    if (busy) return;
    if (!signedIn) {
      const target = `/chat?prompt=${encodeURIComponent(prompt.slice(0, 4000))}`;
      router.push(`/signup?next=${encodeURIComponent(target)}`);
      return;
    }
    // Straight into the workspace with generation already started (no intermediate page).
    setBusy(true);
    try {
      router.push(await createPresentation(prompt.slice(0, 8000)));
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-2xl text-left">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) void go(value.trim());
        }}
        className="rounded-2xl border border-border bg-card/80 p-2 shadow-[0_20px_80px_-30px_oklch(0.6_0.15_275/0.35)] backdrop-blur focus-within:border-brand/50"
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (value.trim()) void go(value.trim());
            }
          }}
          rows={3}
          placeholder="What is your presentation about?"
          aria-label="Describe your presentation"
          className="w-full resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-xs text-muted-foreground">Enter to start · Shift+Enter for a new line</span>
          <button type="submit" disabled={!value.trim() || busy} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/85 disabled:opacity-40" aria-label="Create presentation">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} disabled={busy} onClick={() => void go(ex)} className="max-w-full truncate rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground transition hover:border-brand/40 hover:text-foreground">
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
