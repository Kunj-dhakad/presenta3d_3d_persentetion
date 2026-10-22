"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, GitCompare, Loader2, RotateCcw, TriangleAlert, CheckCircle2, XCircle, Sparkles, FlaskConical } from "lucide-react";
import type { ChatMessageRow, LiveJob } from "@/stores/workspace";
import { JobProgress } from "./job-progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AiStatus = { configured: boolean; provider: string; model: string | null } | null;

const CODE_SUGGESTIONS = [
  "Make it fully responsive and polish the typography",
  "Add a dark/light theme toggle",
  "Add smooth entrance animations",
  "Improve accessibility: focus states, labels, contrast",
];

const PRESENTATION_SUGGESTIONS = [
  "Add a slide with key numbers",
  "Use a warmer colour palette",
  "Make the titles shorter and punchier",
  "Add a closing slide with a call to action",
];

export function ChatPanel({
  messages,
  job,
  ai,
  busy,
  onSend,
  onCancel,
  onReview,
  onRevert,
  emptyHint,
  variant = "code",
}: {
  messages: ChatMessageRow[];
  job: LiveJob | null;
  ai: AiStatus;
  busy: boolean;
  onSend: (prompt: string) => void;
  onCancel: () => void;
  onReview: (m: ChatMessageRow) => void;
  onRevert: (m: ChatMessageRow) => void;
  emptyHint?: string;
  /** "presentation" hides file-level details (no code is shown to the user). */
  variant?: "code" | "presentation";
}) {
  const presentation = variant === "presentation";
  const SUGGESTIONS = presentation ? PRESENTATION_SUGGESTIONS : CODE_SUGGESTIONS;
  const [value, setValue] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const jobRunning = job && (job.status === "running" || job.status === "queued");

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, job?.stages, job?.files.length, job?.status]);

  const submit = () => {
    const v = value.trim();
    if (!v || busy) return;
    onSend(v);
    setValue("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 thin-scroll">
        {messages.length === 0 && !job && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="size-5 text-brand" />
            <p className="text-sm font-medium">Start the conversation</p>
            <p className="max-w-xs text-xs text-muted-foreground">{emptyHint ?? "Describe what to build or what to change. Follow-ups make targeted edits to the existing files."}</p>
          </div>
        )}
        <div className="grid gap-4">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-[13.5px] leading-relaxed">
                {m.content}
              </div>
            ) : (
              <div key={m.id} className="max-w-[95%] text-[13.5px] leading-relaxed">
                <div className={cn("whitespace-pre-wrap", m.meta?.error && "text-destructive")}>{m.content}</div>
                {presentation && m.meta?.buildStatus && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2">
                    {m.meta.buildStatus === "succeeded" ? (
                      <span className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" />Ready{(m.meta as { slides?: number }).slides ? ` · ${(m.meta as { slides?: number }).slides} slides` : ""}</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-destructive"><XCircle className="size-3.5" />Preview failed</span>
                    )}
                    <span className="flex-1" />
                    {m.meta.preVersionId && (
                      <Button size="xs" variant="ghost" disabled={busy} onClick={() => onRevert(m)}><RotateCcw /> Undo this change</Button>
                    )}
                  </div>
                )}
                {!presentation && m.meta?.changedFiles && m.meta.changedFiles.length > 0 && (
                  <div className="mt-2 rounded-lg border border-border bg-card/50">
                    <ul className="max-h-40 overflow-auto px-3 py-2 thin-scroll">
                      {m.meta.changedFiles.map((f) => (
                        <li key={f.path} className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
                          <span className={cn(f.kind === "created" ? "text-success" : f.kind === "deleted" ? "text-destructive" : "text-foreground/80")}>{f.kind === "created" ? "A" : f.kind === "deleted" ? "D" : "M"}</span>
                          <span className="min-w-0 flex-1 truncate">{f.path}</span>
                          <span className="text-success">+{f.added}</span>
                          <span className="text-destructive">−{f.removed}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
                      {m.meta.buildStatus === "succeeded" ? (
                        <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" />Build passed</span>
                      ) : m.meta.buildStatus === "failed" ? (
                        <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="size-3.5" />Build failed</span>
                      ) : null}
                      <span className="flex-1" />
                      {m.meta.preVersionId && m.meta.postVersionId && (
                        <Button size="xs" variant="ghost" onClick={() => onReview(m)}><GitCompare /> Review changes</Button>
                      )}
                      {m.meta.preVersionId && (
                        <Button size="xs" variant="ghost" disabled={busy} onClick={() => onRevert(m)}><RotateCcw /> Revert</Button>
                      )}
                    </div>
                  </div>
                )}
                {m.meta?.error && m.meta.preVersionId && (
                  <Button size="xs" variant="ghost" className="mt-1" disabled={busy} onClick={() => onRevert(m)}><RotateCcw /> Restore the version from before this request</Button>
                )}
              </div>
            ),
          )}
          {job && <JobProgress job={job} onCancel={onCancel} variant={variant} />}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {ai && !ai.configured && (
          <p className="mb-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            AI generation is not configured. Set OPENAI_API_KEY and OPENAI_MODEL in the server environment and restart.
          </p>
        )}
        {ai?.provider === "mock" && (
          <p className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] text-muted-foreground">
            <FlaskConical className="size-3.5" /> Test mode: responses come from the deterministic offline test provider, not a real model.
          </p>
        )}
        {messages.length > 0 && !jobRunning && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 thin-scroll">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setValue(s)} className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition hover:border-brand/40 hover:text-foreground">
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="rounded-xl border border-border bg-card focus-within:border-brand/50"
        >
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={messages.length ? "Ask for a change…" : presentation ? "Describe your presentation…" : "Describe what to build…"}
            rows={3}
            maxLength={8000}
            aria-label="Message"
            className="w-full resize-none bg-transparent px-3 pt-2.5 text-[13.5px] outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[11px] text-muted-foreground">{ai?.model ? `${ai.provider} · ${ai.model}` : ""}</span>
            <button type="submit" disabled={!value.trim() || busy} aria-label="Send" className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/85 disabled:opacity-40">
              {jobRunning ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
