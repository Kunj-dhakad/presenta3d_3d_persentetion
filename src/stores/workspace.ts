"use client";

import { create } from "zustand";
import type { BuildDiagnostic, BuildSummary, PreviewMessage } from "@/lib/build-types";
import type { JobEvent, PipelineStage, TaskEventPayload } from "@/lib/jobs";
import { api } from "@/lib/api-client";

export type ProjectMeta = {
  id: string;
  name: string;
  description: string;
  category: string;
  framework: string;
  status: string;
  updatedAt: string;
  lastWorkingBuildId: string | null;
  lastWorkingVersionId: string | null;
  previewUrl: string | null;
};

export type ChatMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  meta: {
    jobId?: string;
    error?: boolean;
    changedFiles?: { path: string; kind: "created" | "modified" | "deleted"; added: number; removed: number }[];
    preVersionId?: string | null;
    postVersionId?: string | null;
    buildStatus?: "succeeded" | "failed" | "skipped";
    buildId?: string | null;
    repairAttempts?: number;
    mode?: string;
  } | null;
};

export type StageState = "start" | "done" | "failed" | "skipped";

export type LiveJob = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stages: Partial<Record<PipelineStage, { state: StageState; detail?: string }>>;
  understanding: string | null;
  tasks: Record<string, TaskEventPayload & { chars?: number }>;
  files: { path: string; kind: string; added: number; removed: number }[];
  logs: { level: string; message: string }[];
  builds: { status: string; errors: BuildDiagnostic[]; attempt: number }[];
  error: string | null;
  progress: number;
};

export type BuildState = {
  status: "idle" | "building" | "succeeded" | "failed";
  buildId: string | null;
  /** URL of the preview to show: the latest successful build. */
  previewUrl: string | null;
  errors: BuildDiagnostic[];
  warnings: BuildDiagnostic[];
  durationMs: number | null;
  /** true when the shown preview is older than a failed build */
  stale: boolean;
};

type State = {
  projectId: string | null;
  project: ProjectMeta | null;
  files: Record<string, string>;
  saved: Record<string, string>;
  openTabs: string[];
  activePath: string | null;
  revealLine: { path: string; line: number; nonce: number } | null;
  build: BuildState;
  previewNonce: number;
  runtimeErrors: (PreviewMessage & { at: number })[];
  job: LiveJob | null;
  saving: boolean;
  saveError: string | null;
  lastSavedAt: number | null;
  autoBuild: boolean;
};

type Actions = {
  reset: (projectId: string) => void;
  setProject: (p: ProjectMeta) => void;
  loadFiles: (files: { path: string; content: string }[]) => void;
  openFile: (path: string, line?: number) => void;
  closeTab: (path: string) => void;
  editFile: (path: string, content: string) => void;
  createFile: (path: string, content?: string) => void;
  renameFile: (from: string, to: string) => void;
  deleteFile: (path: string) => void;
  dirtyPaths: () => string[];
  isDirty: () => boolean;
  save: (opts?: { snapshot?: boolean; rebuild?: boolean }) => Promise<void>;
  runBuild: () => Promise<BuildSummary | null>;
  setBuildFromServer: (b: BuildSummary | null, lastWorkingUrl: string | null) => void;
  refreshPreview: () => void;
  pushRuntimeError: (m: PreviewMessage) => void;
  clearRuntimeErrors: () => void;
  startJob: (jobId: string) => void;
  applyJobEvent: (e: JobEvent) => void;
  setAutoBuild: (v: boolean) => void;
};

const emptyBuild: BuildState = { status: "idle", buildId: null, previewUrl: null, errors: [], warnings: [], durationMs: null, stale: false };

export const useWorkspace = create<State & Actions>((set, get) => ({
  projectId: null,
  project: null,
  files: {},
  saved: {},
  openTabs: [],
  activePath: null,
  revealLine: null,
  build: emptyBuild,
  previewNonce: 0,
  runtimeErrors: [],
  job: null,
  saving: false,
  saveError: null,
  lastSavedAt: null,
  autoBuild: true,

  reset: (projectId) =>
    set({ projectId, project: null, files: {}, saved: {}, openTabs: [], activePath: null, build: emptyBuild, runtimeErrors: [], job: null, saveError: null, lastSavedAt: null }),
  setProject: (project) => set({ project }),

  loadFiles: (list) => {
    const files = Object.fromEntries(list.map((f) => [f.path, f.content]));
    const { openTabs, activePath } = get();
    const tabs = openTabs.filter((t) => t in files);
    const preferred = ["src/App.tsx", "src/App.jsx", "index.html", "main.js", "src/main.tsx"].find((p) => p in files) ?? list[0]?.path ?? null;
    const active = activePath && activePath in files ? activePath : preferred;
    set({ files, saved: { ...files }, openTabs: tabs.length ? tabs : active ? [active] : [], activePath: active });
  },

  openFile: (path, line) =>
    set((s) => ({
      openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
      activePath: path,
      revealLine: line ? { path, line, nonce: Date.now() } : s.revealLine,
    })),
  closeTab: (path) =>
    set((s) => {
      const tabs = s.openTabs.filter((t) => t !== path);
      const idx = s.openTabs.indexOf(path);
      return { openTabs: tabs, activePath: s.activePath === path ? (tabs[Math.max(0, idx - 1)] ?? null) : s.activePath };
    }),
  editFile: (path, content) => set((s) => ({ files: { ...s.files, [path]: content } })),
  createFile: (path, content = "") =>
    set((s) => ({ files: { ...s.files, [path]: content }, openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path], activePath: path })),
  renameFile: (from, to) =>
    set((s) => {
      const files = { ...s.files };
      files[to] = files[from];
      delete files[from];
      return { files, openTabs: s.openTabs.map((t) => (t === from ? to : t)), activePath: s.activePath === from ? to : s.activePath };
    }),
  deleteFile: (path) =>
    set((s) => {
      const files = { ...s.files };
      delete files[path];
      const tabs = s.openTabs.filter((t) => t !== path);
      return { files, openTabs: tabs, activePath: s.activePath === path ? (tabs[0] ?? null) : s.activePath };
    }),
  dirtyPaths: () => {
    const { files, saved } = get();
    const paths = new Set([...Object.keys(files), ...Object.keys(saved)]);
    return [...paths].filter((p) => files[p] !== saved[p]);
  },
  isDirty: () => get().dirtyPaths().length > 0,

  save: async (opts = {}) => {
    const { projectId, files, saving } = get();
    if (!projectId || saving) return;
    const snapshotFiles = { ...files };
    set({ saving: true, saveError: null });
    try {
      await api(`/api/projects/${projectId}/files`, {
        method: "PUT",
        json: { files: Object.entries(snapshotFiles).map(([path, content]) => ({ path, content })), snapshot: Boolean(opts.snapshot) },
      });
      set({ saved: snapshotFiles, saving: false, lastSavedAt: Date.now() });
      if (opts.rebuild ?? get().autoBuild) void get().runBuild();
    } catch (err) {
      set({ saving: false, saveError: err instanceof Error ? err.message : "Save failed" });
      throw err;
    }
  },

  runBuild: async () => {
    const { projectId } = get();
    if (!projectId) return null;
    set((s) => ({ build: { ...s.build, status: "building" } }));
    try {
      const r = await api<{ build: BuildSummary | null }>(`/api/projects/${projectId}/build`, { method: "POST" });
      get().setBuildFromServer(r.build, null);
      return r.build;
    } catch (err) {
      set((s) => ({
        build: { ...s.build, status: "failed", errors: [{ severity: "error", file: "", line: 0, column: 0, message: err instanceof Error ? err.message : "Build request failed", source: "worker" }], stale: Boolean(s.build.previewUrl) },
      }));
      return null;
    }
  },

  setBuildFromServer: (b, lastWorkingUrl) =>
    set((s) => {
      if (!b) return { build: { ...emptyBuild, previewUrl: lastWorkingUrl ?? s.build.previewUrl } };
      const ok = b.status === "succeeded";
      return {
        build: {
          status: ok ? "succeeded" : b.status === "building" ? "building" : "failed",
          buildId: b.buildId,
          previewUrl: ok ? b.previewUrl : (lastWorkingUrl ?? s.build.previewUrl),
          errors: b.errors,
          warnings: b.warnings,
          durationMs: b.durationMs,
          stale: !ok && Boolean(lastWorkingUrl ?? s.build.previewUrl),
        },
        runtimeErrors: ok ? [] : s.runtimeErrors,
        previewNonce: ok ? s.previewNonce + 1 : s.previewNonce,
      };
    }),
  refreshPreview: () => set((s) => ({ previewNonce: s.previewNonce + 1, runtimeErrors: [] })),
  pushRuntimeError: (m) =>
    set((s) => {
      if (m.type === "ready") return {};
      const key = `${m.type}:${m.message}`;
      if (s.runtimeErrors.some((e) => e.type !== "ready" && `${e.type}:${e.message}` === key)) return {};
      return { runtimeErrors: [...s.runtimeErrors, { ...m, at: Date.now() }].slice(-30) };
    }),
  clearRuntimeErrors: () => set({ runtimeErrors: [] }),

  startJob: (jobId) => set({ job: { jobId, status: "queued", stages: {}, understanding: null, tasks: {}, files: [], logs: [], builds: [], error: null, progress: 0 } }),
  applyJobEvent: (e) =>
    set((s) => {
      const j = s.job;
      if (!j) return {};
      const job: LiveJob = { ...j };
      switch (e.type) {
        case "status":
          job.status = e.status;
          if (e.status === "failed" || e.status === "cancelled") job.error = e.message ?? e.status;
          break;
        case "progress":
          job.progress = e.progress;
          break;
        case "stage":
          job.stages = { ...job.stages, [e.stage]: { state: e.state, detail: e.detail } };
          break;
        case "understanding":
          job.understanding = e.text;
          break;
        case "plan":
          job.tasks = Object.fromEntries(e.tasks.map((t) => [t.id, t]));
          break;
        case "task":
          job.tasks = { ...job.tasks, [e.task.id]: { ...job.tasks[e.task.id], ...e.task } };
          break;
        case "stream":
          if (job.tasks[e.taskId]) job.tasks = { ...job.tasks, [e.taskId]: { ...job.tasks[e.taskId], chars: e.chars } };
          break;
        case "file":
          job.files = [...job.files.filter((f) => f.path !== e.path), { path: e.path, kind: e.kind, added: e.added, removed: e.removed }];
          break;
        case "log":
          job.logs = [...job.logs, { level: e.level, message: e.message }].slice(-40);
          break;
        case "build":
          job.builds = [...job.builds, { status: e.status, errors: e.errors, attempt: e.attempt }];
          return {
            job,
            build: {
              status: e.status,
              buildId: e.buildId,
              previewUrl: e.status === "succeeded" ? e.previewUrl : s.build.previewUrl,
              errors: e.errors,
              warnings: e.warnings,
              durationMs: null,
              stale: e.status === "failed" && Boolean(s.build.previewUrl),
            },
            previewNonce: e.status === "succeeded" ? s.previewNonce + 1 : s.previewNonce,
            runtimeErrors: e.status === "succeeded" ? [] : s.runtimeErrors,
          };
      }
      return { job };
    }),
  setAutoBuild: (v) => set({ autoBuild: v }),
}));
