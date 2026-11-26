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

/** Problems reported by the preview shim. */
export type PreviewIssue = Extract<PreviewMessage, { message: string }>;

/** Messages posted by the preview shim (preview-runner/shim.js). */
export type PreviewMessage =
  | { source: "deck3d-preview"; type: "ready"; loadMs: number }
  /** Posted by presentations when the current slide changes (1-based). */
  | { source: "deck3d-preview"; type: "slide"; index: number }
  /** Posted by presentations when asked ("thumbnail" action): a JPEG data URL of slide 1. */
  | { source: "deck3d-preview"; type: "thumbnail"; image: string }
  | {
      source: "deck3d-preview";
      type: "runtime-error" | "console-error" | "resource-error" | "csp-violation";
      message: string;
      stack: string;
      file: string;
      line: number;
      column: number;
    };

/**
 * An issue raised by a browser extension's script, not by the presentation: extensions such as MetaMask inject
 * their script into every frame, the preview included, where it cannot connect (opaque origin) or is blocked by the
 * preview's policy. Such issues are not shown and never sent to "Fix with AI".
 */
const EXTENSION_SOURCE = /\b(?:chrome|moz|safari-web|ms-browser)-extension:\/\//i;
const EXTENSION_MESSAGE = /\bMetaMask\b|\binpage\.js\b/i;
export function isBrowserExtensionIssue(m: { message?: string; stack?: string; file?: string }): boolean {
  const text = `${m.message ?? ""}\n${m.stack ?? ""}\n${m.file ?? ""}`;
  return EXTENSION_SOURCE.test(text) || EXTENSION_MESSAGE.test(m.message ?? "");
}

export function formatDiagnostic(d: BuildDiagnostic): string {
  const loc = d.file ? `${d.file}${d.line ? `:${d.line}${d.column ? `:${d.column}` : ""}` : ""}` : "";
  return `${loc ? `${loc} — ` : ""}${d.message}`;
}
