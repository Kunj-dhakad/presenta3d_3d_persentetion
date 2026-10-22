import type { BuildDiagnostic } from "./build-types";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type PipelineStage = "understand" | "plan" | "generate" | "review" | "validate" | "build" | "repair" | "finalize";

export type TaskEventPayload = {
  id: string;
  role: string;
  description: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  dependsOn: string[];
  writes: string[];
  error: string | null;
  outputRefs: string[];
};

/** Event payloads streamed from server-side jobs to the UI (NDJSON). */
export type JobEventBody =
  | { type: "status"; status: JobStatus; message?: string }
  | { type: "progress"; progress: number }
  | { type: "stage"; stage: PipelineStage; state: "start" | "done" | "failed" | "skipped"; detail?: string }
  | { type: "understanding"; text: string; title?: string; category?: string; framework?: string }
  | { type: "plan"; tasks: TaskEventPayload[] }
  | { type: "task"; task: TaskEventPayload }
  | { type: "stream"; taskId: string; chars: number }
  | { type: "file"; path: string; kind: "created" | "modified" | "deleted"; added: number; removed: number }
  | { type: "build"; status: "succeeded" | "failed"; buildId: string; previewUrl: string | null; errors: BuildDiagnostic[]; warnings: BuildDiagnostic[]; attempt: number }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "result"; summary: string; changedFiles: string[]; preVersionId: string | null; postVersionId: string | null; buildStatus: "succeeded" | "failed" | "skipped"; previewUrl: string | null; assistantMessageId?: string }
  | { type: "asset"; assetId: string; url: string; mimeType: string }
  | { type: "end" };

export type JobEvent = JobEventBody & { t: number };
