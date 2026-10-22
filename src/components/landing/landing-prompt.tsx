"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUp } from "lucide-react";

const EXAMPLES = [
  "An investor pitch for an AI fitness app, 8 slides, bold and futuristic",
  "The solar system for a school class, with one surprising fact per planet",
  "A quarterly business review with revenue growth and next-quarter goals",
  "A product launch for a smartwatch: reveal, features, specs and price",
];

export function LandingPrompt({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  function go(prompt: string) {
    const target = `/chat?prompt=${encodeURIComponent(prompt.slice(0, 4000))}`;
    router.push(signedIn ? target : `/signup?next=${encodeURIComponent(target)}`);
  }
  return (
    <div className="mx-auto max-w-2xl text-left">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) go(value.trim());
        }}
        className="rounded-2xl border border-border bg-card/80 p-2 shadow-[0_20px_80px_-30px_oklch(0.6_0.15_275/0.35)] backdrop-blur focus-within:border-brand/50"
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (value.trim()) go(value.trim());
            }
          }}
          rows={3}
          placeholder="What is your presentation about?"
          aria-label="Describe your presentation"
          className="w-full resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-xs text-muted-foreground">Enter to start · Shift+Enter for a new line</span>
          <button type="submit" disabled={!value.trim()} className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/85 disabled:opacity-40" aria-label="Create presentation">
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => go(ex)} className="max-w-full truncate rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground transition hover:border-brand/40 hover:text-foreground">
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
