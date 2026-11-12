"use client";

import { useEffect, useRef, useState } from "react";
import { GitCompare, Loader2, RotateCcw, TriangleAlert, CheckCircle2, XCircle, Sparkles, FlaskConical } from "lucide-react";
import type { ChatMessageRow, LiveJob } from "@/stores/workspace";
import { FigArrowUp, FigCheckCircle, FigUndo } from "./figma-icons";
import { JobProgress } from "./job-progress";
import { VoiceButton } from "./voice-input";
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
  "Make the text bigger",
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
  loading = false,
}: {
  messages: ChatMessageRow[];
  job: LiveJob | null;
  ai: AiStatus;
  busy: boolean;
  /** May resolve to false when the prompt was not accepted; the text is then put back in the box. */
  onSend: (prompt: string) => void | boolean | Promise<boolean>;
  onCancel: () => void;
  onReview: (m: ChatMessageRow) => void;
  onRevert: (m: ChatMessageRow) => void;
  emptyHint?: string;
  /** "presentation" hides file-level details (no code is shown to the user). */
  variant?: "code" | "presentation";
  /** The conversation is still loading: show a spinner instead of the empty state. */
  loading?: boolean;
}) {
  const presentation = variant === "presentation";
  const SUGGESTIONS = presentation ? PRESENTATION_SUGGESTIONS : CODE_SUGGESTIONS;
  const [value, setValue] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const jobRunning = job && (job.status === "running" || job.status === "queued");

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, job?.stages, job?.files.length, job?.status]);

  const submit = (text?: string) => {
    const v = (text ?? value).trim();
    if (!v || busy) return;
    setValue("");
    void Promise.resolve(onSend(v)).then((ok) => {
      if (ok === false) setValue((cur) => cur || v);
    });
  };

  return (
    // The Figma chat panel: #f4f8fb, 16px padding, 14px between messages.
    <div className="flex h-full min-h-0 flex-col bg-[#f4f8fb]">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-4 thin-scroll">
        {loading && messages.length === 0 && !job && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading conversation…
          </div>
        )}
        {!loading && messages.length === 0 && !job && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="size-5 text-brand" />
            <p className="text-sm font-medium">Start the conversation</p>
            <p className="max-w-xs text-xs text-muted-foreground">{emptyHint ?? "Describe what to build or what to change. Follow-ups make targeted edits to the existing files."}</p>
          </div>
        )}
        <div className="grid gap-3.5">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-[14px] bg-[#e8f6fd] px-3.5 py-2.5 text-sm leading-[1.26] text-foreground">
                {m.content}
              </div>
            ) : (
              <div key={m.id} className="text-sm leading-[1.5] text-foreground">
                <div className={cn("whitespace-pre-wrap", m.meta?.error && "text-destructive")}>{m.content}</div>
                {presentation && m.meta?.buildStatus && (
                  // The design's "Ready · N slides" chip, with "Undo this change" on the right.
                  <div className="mt-3.5 flex items-center gap-2 rounded-[10px] border border-border bg-white px-3 py-[9px]">
                    {m.meta.buildStatus === "succeeded" ? (
                      <span className="flex items-center gap-2 text-xs leading-none text-[#16a34a]"><FigCheckCircle className="size-[15px]" />Ready{(m.meta as { slides?: number }).slides ? ` · ${(m.meta as { slides?: number }).slides} slides` : ""}</span>
                    ) : (
                      <span className="flex items-center gap-2 text-xs leading-none text-destructive"><XCircle className="size-[15px]" />Preview failed</span>
                    )}
                    <span className="flex-1" />
                    {m.meta.preVersionId && (
                      <button type="button" disabled={busy} onClick={() => onRevert(m)} className="flex items-center gap-1.5 rounded text-xs leading-none font-medium text-foreground transition hover:text-[#00a6ee] disabled:opacity-50">
                        <FigUndo className="size-3" /> Undo this change
                      </button>
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

      <div className="shrink-0 px-4 pb-4">
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
          <div className="mb-3 flex gap-2 overflow-x-auto pb-0.5 thin-scroll">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setValue(s)} className="shrink-0 rounded-[14px] border border-border bg-[#eef3f8] px-3 py-1.5 text-xs leading-[1.26] text-[#64748b] transition hover:border-[#00a6ee]/40 hover:text-foreground">
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
          className="rounded-[14px] border border-border bg-white focus-within:border-[#00a6ee]/50"
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
            placeholder={messages.length ? (presentation ? "Type or speak a change, e.g. “make the text bigger”…" : "Ask for a change…") : presentation ? "Describe your presentation…" : "Describe what to build…"}
            rows={3}
            maxLength={8000}
            aria-label="Message"
            className="min-h-[74px] w-full resize-none bg-transparent px-3.5 pt-3.5 text-sm leading-[1.43] outline-none placeholder:text-black/60"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-3">
            {/* The model in use (the design's grey pill). */}
            {ai?.model ? (
              <span className="min-w-0 truncate rounded-lg border border-black/10 bg-[#f4f8fb] px-2.5 py-[7px] text-xs leading-none font-medium text-black/60" title={`${ai.provider} · ${ai.model}`}>
                {ai.provider === "mock" ? "Test mode" : ai.model.toUpperCase()}
              </span>
            ) : null}
            <span className="flex-1" />
            {/* Speak instead of typing (PRD 3): sent as soon as the speaker stops. */}
            {presentation ? <VoiceButton onText={setValue} onFinal={(t) => submit(t)} disabled={busy} /> : null}
            <button type="submit" disabled={!value.trim() || busy} aria-label="Send" className="flex size-[30px] items-center justify-center rounded-lg bg-[#00a6ee] text-white transition hover:bg-[#0097da] disabled:opacity-60">
              {jobRunning ? <Loader2 className="size-3 animate-spin" /> : <FigArrowUp className="size-3" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
