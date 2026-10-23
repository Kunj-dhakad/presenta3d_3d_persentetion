"use client";

import { useEffect, useRef } from "react";
import { Check, Loader2, X, Minus, Circle, FileCode2, AlertTriangle, Square, Bot } from "lucide-react";
import type { LiveJob, StageState } from "@/stores/workspace";
import type { PipelineStage } from "@/lib/jobs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STAGES: { id: PipelineStage; label: string }[] = [
  { id: "understand", label: "Understand request" },
  { id: "plan", label: "Plan tasks" },
  { id: "generate", label: "Write files" },
  { id: "review", label: "Review" },
  { id: "build", label: "Validate & build" },
  { id: "repair", label: "Repair" },
  { id: "finalize", label: "Checkpoint" },
];

const PRESENTATION_STAGES: { id: PipelineStage; label: string }[] = [
  { id: "understand", label: "Understanding your topic" },
  { id: "plan", label: "Planning the story" },
  { id: "generate", label: "Writing the slides" },
  { id: "repair", label: "Fixing the deck" },
  { id: "review", label: "Designing a 3D scene for each slide" },
  { id: "build", label: "Building the 3D presentation" },
  { id: "finalize", label: "Saving a version" },
];

const ROLE_LABEL: Record<string, string> = { frontend: "Frontend", threeD: "3D", design: "Design", repair: "Repair", reviewer: "Review", planner: "Planner" };

function StageIcon({ state }: { state?: StageState }) {
  if (state === "start") return <Loader2 className="size-3.5 animate-spin text-brand" />;
  if (state === "done") return <Check className="size-3.5 text-success" />;
  if (state === "failed") return <X className="size-3.5 text-destructive" />;
  if (state === "skipped") return <Minus className="size-3.5 text-muted-foreground" />;
  return <Circle className="size-3 text-muted-foreground/50" />;
}

/** Step-by-step server log of the running generation, newest at the bottom. */
function LiveLog({ logs, running }: { logs: LiveJob["logs"]; running: boolean }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [logs.length]);
  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-background/40 p-2">
      <p className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", running ? "animate-pulse bg-success" : "bg-muted-foreground/50")} />
        Live log
      </p>
      <ol className="thin-scroll grid max-h-40 gap-0.5 overflow-y-auto px-1 font-mono text-[11px] leading-relaxed">
        {logs.map((l, i) => (
          <li key={i} ref={i === logs.length - 1 ? end : undefined} className={cn("text-muted-foreground", l.level === "warn" && "text-warning", l.level === "error" && "text-destructive")}>
            {l.message}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function JobProgress({ job, onCancel, variant = "code" }: { job: LiveJob; onCancel: () => void; variant?: "code" | "presentation" }) {
  const presentation = variant === "presentation";
  const running = job.status === "running" || job.status === "queued";
  const tasks = Object.values(job.tasks);
  const visibleStages = (presentation ? PRESENTATION_STAGES : STAGES).filter((s) => (s.id !== "repair" && !(presentation && s.id === "review")) || job.stages[s.id]);
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3.5 text-sm" aria-live="polite">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-brand" />
        <span className="font-medium">{running ? "Working on it" : job.status === "succeeded" ? "Finished" : job.status === "cancelled" ? "Cancelled" : "Stopped"}</span>
        {running && (
          <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" onClick={onCancel}>
            <Square className="size-3" /> Stop
          </Button>
        )}
      </div>
      {job.understanding && <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{job.understanding}</p>}

      <ol className="mt-3 grid gap-1.5">
        {visibleStages.map((s) => {
          const st = job.stages[s.id];
          return (
            <li key={s.id} className={cn("flex items-center gap-2 text-[12.5px]", !st && "text-muted-foreground/70")}>
              <StageIcon state={st?.state} />
              <span>{s.label}</span>
              {st?.detail && <span className="truncate text-xs text-muted-foreground">· {st.detail}</span>}
              {presentation && s.id === "generate" && st?.state === "start" && job.chars > 0 && (
                <span className="shrink-0 text-xs text-muted-foreground">· {(job.chars / 1000).toFixed(1)}k chars received</span>
              )}
            </li>
          );
        })}
      </ol>

      {presentation && job.logs.length > 0 && <LiveLog logs={job.logs} running={running} />}

      {!presentation && tasks.length > 0 && (
        <div className="mt-3 rounded-lg border border-border/70 bg-background/40 p-2">
          <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Agent tasks</p>
          <ul className="grid gap-1">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 px-1 text-[12px]">
                <span className="mt-0.5">
                  <StageIcon state={t.status === "running" ? "start" : t.status === "succeeded" ? "done" : t.status === "failed" || t.status === "cancelled" ? "failed" : t.status === "skipped" ? "skipped" : undefined} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mr-1.5 rounded bg-accent px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{ROLE_LABEL[t.role] ?? t.role}</span>
                  <span className="text-foreground/90">{t.description}</span>
                  {t.status === "running" && t.chars ? <span className="ml-1 text-muted-foreground">· {(t.chars / 1000).toFixed(1)}k chars received</span> : null}
                  {t.dependsOn.length > 0 && t.status === "pending" && <span className="ml-1 text-muted-foreground">· waits for {t.dependsOn.length} task{t.dependsOn.length > 1 ? "s" : ""}</span>}
                  {t.error && <span className="block text-destructive">{t.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!presentation && job.files.length > 0 && (
        <ul className="mt-3 grid gap-0.5">
          {job.files.map((f) => (
            <li key={f.path} className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
              <FileCode2 className="size-3" />
              <span className={cn(f.kind === "created" ? "text-success" : f.kind === "deleted" ? "text-destructive" : "text-foreground/85")}>{f.kind === "created" ? "A" : f.kind === "deleted" ? "D" : "M"}</span>
              <span className="truncate">{f.path}</span>
              <span className="ml-auto shrink-0">
                <span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {job.builds.filter((b) => b.status === "failed").map((b, i) => (
        <p key={i} className="mt-2 text-xs text-muted-foreground">
          Build attempt {b.attempt + 1} failed: <span className="text-destructive">{b.errors[0]?.message ?? "unknown error"}</span>
        </p>
      ))}

      {job.logs.filter((l) => l.level !== "info").length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none"><AlertTriangle className="mr-1 inline size-3 text-warning" />{job.logs.filter((l) => l.level !== "info").length} notes</summary>
          <ul className="mt-1 grid gap-0.5 pl-4">
            {job.logs.filter((l) => l.level !== "info").map((l, i) => <li key={i}>{l.message}</li>)}
          </ul>
        </details>
      )}
      {job.error && job.status !== "succeeded" && <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{job.error}</p>}
    </div>
  );
}
