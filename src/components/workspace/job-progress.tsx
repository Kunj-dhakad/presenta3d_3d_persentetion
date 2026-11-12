"use client";

import { useEffect, useRef } from "react";
import { X, Minus, FileCode2, AlertTriangle } from "lucide-react";
import type { LiveJob, StageState } from "@/stores/workspace";
import type { PipelineStage } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import { FigBot, FigCheck, FigCircle, FigSpinner, FigStop } from "./figma-icons";

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
  { id: "images", label: "Painting the cinematic images (all at once)" },
  { id: "build", label: "Building the presentation" },
  { id: "finalize", label: "Saving a version" },
];

const ROLE_LABEL: Record<string, string> = { frontend: "Frontend", threeD: "3D", design: "Design", repair: "Repair", reviewer: "Review", planner: "Planner" };

// Stage icons from the design: blue check, blue spinner, grey ring (15px).
function StageIcon({ state }: { state?: StageState }) {
  if (state === "start") return <FigSpinner className="size-[15px] shrink-0 animate-spin text-[#00a6ee]" />;
  if (state === "done") return <FigCheck className="size-[15px] shrink-0 text-[#00a6ee]" />;
  if (state === "failed") return <X className="size-[15px] shrink-0 text-destructive" />;
  if (state === "skipped") return <Minus className="size-[15px] shrink-0 text-muted-foreground" />;
  return <FigCircle className="size-[15px] shrink-0 text-[#c9d2dd]" />;
}

/** Step-by-step server log of the running generation, newest at the bottom. */
function LiveLog({ logs, running }: { logs: LiveJob["logs"]; running: boolean }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [logs.length]);
  return (
    <div className="mt-3 rounded-[10px] border border-border bg-[#f4f8fb] p-3">
      <p className="flex items-center gap-1.5 pb-1.5 text-[11px] leading-none font-medium text-[#64748b] uppercase">
        <span className={cn("size-1.5 rounded-full", running ? "animate-pulse bg-[#22c55e]" : "bg-[#22c55e]/60")} />
        Live log
      </p>
      <ol className="thin-scroll grid max-h-40 gap-1.5 overflow-y-auto text-[11px] leading-[1.26]">
        {logs.map((l, i) => (
          <li key={i} ref={i === logs.length - 1 ? end : undefined} className={cn("text-[#64748b]", l.level === "warn" && "text-warning", l.level === "error" && "text-destructive")}>
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
  const visibleStages = (presentation ? PRESENTATION_STAGES : STAGES).filter((s) => (s.id !== "repair" && !(presentation && (s.id === "review" || s.id === "images"))) || job.stages[s.id]);
  return (
    // The design's progress card: white, 14px corners, 16px padding.
    <div className="rounded-[14px] border border-border bg-white p-4 text-sm" aria-live="polite">
      <div className="flex items-center gap-2">
        <FigBot className="size-[17px] shrink-0 text-[#00a6ee]" />
        <span className="text-[15px] leading-none font-medium text-foreground">{running ? "Working on it" : job.status === "succeeded" ? "Finished" : job.status === "cancelled" ? "Cancelled" : "Stopped"}</span>
        {running && (
          <button type="button" className="ml-auto flex items-center gap-1.5 rounded text-[13px] leading-none text-[#64748b] transition hover:text-foreground" onClick={onCancel}>
            <FigStop className="size-[13px]" /> Stop
          </button>
        )}
      </div>
      {job.understanding && <p className="mt-3 text-[13px] leading-[1.6] text-[#64748b]">{job.understanding}</p>}

      <ol className="mt-3 grid gap-[9px]">
        {visibleStages.map((s) => {
          const st = job.stages[s.id];
          return (
            <li key={s.id} className={cn("flex min-w-0 items-center gap-2.5 text-sm leading-[1.26]", st ? "text-foreground" : "text-[#a3aebd]")}>
              <StageIcon state={st?.state} />
              <span className="shrink-0">{s.label}</span>
              {st?.detail && <span className="truncate text-[13px] text-[#64748b]">{st.detail}</span>}
              {presentation && s.id === "generate" && st?.state === "start" && job.chars > 0 && (
                <span className="shrink-0 text-[13px] text-[#64748b]">· {(job.chars / 1000).toFixed(1)}k chars received</span>
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
