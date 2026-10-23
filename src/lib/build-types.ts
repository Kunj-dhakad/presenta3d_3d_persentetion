export type BuildDiagnostic = {
  severity: "error" | "warning";
  file: string;
  line: number;
  column: number;
  message: string;
  source: "esbuild" | "validator" | "html" | "worker" | "runtime";
};

export type BuildStatus = "building" | "succeeded" | "failed";

export type BuildSummary = {
  buildId: string;
  status: BuildStatus;
  errors: BuildDiagnostic[];
  warnings: BuildDiagnostic[];
  durationMs: number;
  previewUrl: string | null;
};

/** Messages posted by the preview shim (preview-runner/shim.js). */
export type PreviewMessage =
  | { source: "deck3d-preview"; type: "ready"; loadMs: number }
  | {
      source: "deck3d-preview";
      type: "runtime-error" | "console-error" | "resource-error" | "csp-violation";
      message: string;
      stack: string;
      file: string;
      line: number;
      column: number;
    };

export function formatDiagnostic(d: BuildDiagnostic): string {
  const loc = d.file ? `${d.file}${d.line ? `:${d.line}${d.column ? `:${d.column}` : ""}` : ""}` : "";
  return `${loc ? `${loc} — ` : ""}${d.message}`;
}
