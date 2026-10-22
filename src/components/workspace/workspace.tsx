"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, Code2, Download, Eye, History, Loader2, PanelLeft, Columns2, Share2, Pencil, MessageSquare, AlertCircle } from "lucide-react";
import { useWorkspace, type ChatMessageRow, type ProjectMeta } from "@/stores/workspace";
import { api, ApiError, errorMessage, streamJob, timeAgo } from "@/lib/api-client";
import type { BuildSummary } from "@/lib/build-types";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeEditor } from "@/components/editor/code-editor";
import { FileExplorer } from "@/components/editor/file-explorer";
import { ChatPanel, type AiStatus } from "./chat-panel";
import { PreviewPane } from "./preview-pane";
import { ProjectSidebar } from "./project-sidebar";
import { HistoryDialog } from "./history-dialog";
import { ShareDialog } from "./share-dialog";
import { DiffDialog, type FileSet } from "./diff-dialog";
import { CATEGORY_LABELS, type ProjectCategory } from "@/lib/schemas/project";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/use-media-query";

type ProjectResponse = {
  project: ProjectMeta & { fileCount: number };
  lastBuild: (BuildSummary & { createdAt: string }) | null;
};
type Conversation = { id: string; title: string; updatedAt: string; _count: { messages: number } };
type View = "split" | "code" | "preview";

export function Workspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const project = useWorkspace((s) => s.project);
  const job = useWorkspace((s) => s.job);
  const saving = useWorkspace((s) => s.saving);
  const saveError = useWorkspace((s) => s.saveError);
  const lastSavedAt = useWorkspace((s) => s.lastSavedAt);
  const files = useWorkspace((s) => s.files);
  const saved = useWorkspace((s) => s.saved);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus>(null);
  const [view, setView] = useState<View>("split");
  const [mobileTab, setMobileTab] = useState<"chat" | "code" | "preview">("chat");
  const [showSidebar, setShowSidebar] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [review, setReview] = useState<{ message: ChatMessageRow; before: FileSet | null; after: FileSet | null } | null>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const autosaveCount = useRef(0);
  const startedFromParam = useRef(false);

  // Mount exactly one layout so the editor and the preview iframe are never duplicated.
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const jobRunning = Boolean(job && (job.status === "running" || job.status === "queued"));

  const loadMessages = useCallback(async (cid: string) => {
    const r = await api<{ messages: ChatMessageRow[] }>(`/api/conversations/${cid}/messages`);
    setMessages(r.messages);
  }, []);

  const loadProject = useCallback(async () => {
    const [p, f] = await Promise.all([api<ProjectResponse>(`/api/projects/${projectId}`), api<{ files: FileSet }>(`/api/projects/${projectId}/files`)]);
    const st = useWorkspace.getState();
    st.setProject(p.project);
    st.loadFiles(f.files);
    st.setBuildFromServer(p.lastBuild, p.project.previewUrl);
    return p;
  }, [projectId]);

  const follow = useCallback(
    async (jobId: string) => {
      streamAbort.current?.abort();
      const ctrl = new AbortController();
      streamAbort.current = ctrl;
      useWorkspace.getState().startJob(jobId);
      try {
        await streamJob(jobId, (e) => useWorkspace.getState().applyJobEvent(e), ctrl.signal);
      } catch (e) {
        if (!ctrl.signal.aborted) toast.error(errorMessage(e));
      }
      if (ctrl.signal.aborted) return;
      // Job finished: reload authoritative state from the server.
      try {
        await loadProject();
        const cs = await api<{ conversations: Conversation[] }>(`/api/projects/${projectId}/conversations`);
        setConversations(cs.conversations);
        const cid = cs.conversations[0]?.id ?? null;
        if (cid) {
          setConversationId(cid);
          await loadMessages(cid);
        }
      } catch (e) {
        toast.error(errorMessage(e));
      }
      const finalJob = useWorkspace.getState().job;
      if (finalJob?.status === "succeeded") useWorkspace.setState({ job: null });
    },
    [loadMessages, loadProject, projectId],
  );

  const send = useCallback(
    async (prompt: string, mode: "auto" | "repair" = "auto", runtimeErrors?: string[]) => {
      const st = useWorkspace.getState();
      try {
        if (st.isDirty()) await st.save({ rebuild: false });
        const r = await api<{ jobId: string; conversationId: string; userMessageId: string }>(`/api/projects/${projectId}/generate`, {
          method: "POST",
          json: { prompt, mode, runtimeErrors, conversationId },
        });
        setConversationId(r.conversationId);
        setMessages((m) => [...m, { id: r.userMessageId, role: "user", content: mode === "repair" ? `Fix the preview errors:\n${(runtimeErrors ?? []).slice(0, 5).join("\n")}` : prompt, createdAt: new Date().toISOString(), meta: null }]);
        void follow(r.jobId);
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    [projectId, conversationId, follow],
  );

  // Initial load.
  // AI configuration can change while the tab is open (e.g. after editing .env):
  // re-check whenever the user returns to the tab so the status never goes stale.
  useEffect(() => {
    const refresh = () =>
      api<{ config: { aiProvider: string; openai: { configured: boolean; model: string | null } } }>("/api/config").then(
        (cfg) => setAi(cfg.config.aiProvider === "mock" ? { configured: true, provider: "mock", model: "offline test provider" } : { configured: cfg.config.openai.configured, provider: "openai", model: cfg.config.openai.model }),
        () => {},
      );
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    useWorkspace.getState().reset(projectId);
    let cancelled = false;
    (async () => {
      try {
        const [, cs, cfg, jobs] = await Promise.all([
          loadProject(),
          api<{ conversations: Conversation[] }>(`/api/projects/${projectId}/conversations`),
          api<{ config: { aiProvider: string; openai: { configured: boolean; model: string | null } } }>("/api/config"),
          api<{ jobs: { id: string; status: string; projectId: string | null; kind: string }[] }>("/api/jobs?kinds=project-generate,project-edit,project-repair&limit=10"),
        ]);
        if (cancelled) return;
        setAi(cfg.config.aiProvider === "mock" ? { configured: true, provider: "mock", model: "offline test provider" } : { configured: cfg.config.openai.configured, provider: "openai", model: cfg.config.openai.model });
        setConversations(cs.conversations);
        const cid = cs.conversations[0]?.id ?? null;
        setConversationId(cid);
        if (cid) await loadMessages(cid);
        setLoaded(true);
        const running = jobs.jobs.find((j) => j.projectId === projectId && (j.status === "running" || j.status === "queued"));
        const jobParam = params.get("job");
        if (running) void follow(running.id);
        else if (jobParam && jobs.jobs.some((j) => j.id === jobParam)) void follow(jobParam);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof ApiError && e.status === 404 ? "This project does not exist or you do not have access to it." : errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
      streamAbort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Start generation from ?prompt= (new chat flow), once.
  useEffect(() => {
    const prompt = params.get("prompt");
    if (!loaded || !prompt || startedFromParam.current || jobRunning) return;
    startedFromParam.current = true;
    router.replace(`/chat/${projectId}`);
    void send(prompt);
  }, [loaded, params, jobRunning, projectId, router, send]);

  // Debounced autosave; periodic snapshots. Disabled while an AI job is writing files.
  useEffect(() => {
    if (!loaded || jobRunning) return;
    const dirty = Object.keys({ ...files, ...saved }).some((p) => files[p] !== saved[p]);
    if (!dirty) return;
    const t = setTimeout(() => {
      autosaveCount.current++;
      void useWorkspace
        .getState()
        .save({ snapshot: autosaveCount.current % 5 === 0 })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [files, saved, loaded, jobRunning]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useWorkspace.getState().isDirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  async function openReview(m: ChatMessageRow) {
    if (!m.meta?.preVersionId || !m.meta.postVersionId) return;
    setReview({ message: m, before: null, after: null });
    try {
      const [a, b] = await Promise.all([
        api<{ version: { files: FileSet } }>(`/api/projects/${projectId}/versions/${m.meta.preVersionId}`),
        api<{ version: { files: FileSet } }>(`/api/projects/${projectId}/versions/${m.meta.postVersionId}`),
      ]);
      setReview({ message: m, before: a.version.files, after: b.version.files });
    } catch (e) {
      toast.error(errorMessage(e));
      setReview(null);
    }
  }

  async function restoreVersion(versionId: string, paths?: string[]) {
    const r = await api<{ files: FileSet }>(`/api/projects/${projectId}/versions/${versionId}/restore`, { method: "POST", json: paths ? { paths } : {} });
    useWorkspace.getState().loadFiles(r.files);
    await useWorkspace.getState().runBuild();
  }

  async function revert(m: ChatMessageRow) {
    if (!m.meta?.preVersionId) return;
    try {
      await restoreVersion(m.meta.preVersionId);
      toast.success("Reverted to the version before this change");
      setReview(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function rename() {
    const name = nameDraft.trim();
    setRenaming(false);
    if (!name || !project || name === project.name) return;
    try {
      const r = await api<{ project: ProjectMeta }>(`/api/projects/${projectId}`, { method: "PATCH", json: { name } });
      useWorkspace.getState().setProject({ ...project, ...r.project });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="size-6 text-destructive" />
        <p className="text-sm">{loadError}</p>
        <Button variant="secondary" onClick={() => router.push("/projects")}>Back to projects</Button>
      </div>
    );
  }

  const dirtyCount = Object.keys({ ...files, ...saved }).filter((p) => files[p] !== saved[p]).length;
  const chat = (
    <ChatPanel
      messages={messages}
      job={job}
      ai={ai}
      busy={jobRunning}
      onSend={(p) => void send(p)}
      onCancel={() => job && void api(`/api/jobs/${job.jobId}`, { method: "DELETE" }).catch((e) => toast.error(errorMessage(e)))}
      onReview={(m) => void openReview(m)}
      onRevert={(m) => void revert(m)}
    />
  );
  const code = (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel defaultSize="26" minSize={150}>
        <FileExplorer readOnly={jobRunning} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel minSize={240}>
        <CodeEditor readOnly={jobRunning} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
  const preview = <PreviewPane busy={jobRunning} onFixWithAI={(errs) => void send("Fix the errors shown in the preview.", "repair", errs.slice(0, 20))} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => setShowSidebar(!showSidebar)} aria-label="Toggle sidebar" aria-pressed={showSidebar} className="hidden size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:flex">
              <PanelLeft className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Projects & conversations</TooltipContent>
        </Tooltip>
        {renaming ? (
          <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(false); }} className="h-7 max-w-64 text-sm" aria-label="Project name" />
        ) : (
          <button onClick={() => { setNameDraft(project?.name ?? ""); setRenaming(true); }} className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent" title="Rename project">
            <span className="truncate text-sm font-medium">{project?.name ?? "Loading…"}</span>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        )}
        {project && (
          <span className="hidden shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">
            {CATEGORY_LABELS[project.category as ProjectCategory] ?? project.category} · {project.framework}
          </span>
        )}
        <span className="hidden items-center gap-1 text-[11.5px] text-muted-foreground md:flex" aria-live="polite">
          {saving ? <><Loader2 className="size-3 animate-spin" /> Saving…</> : saveError ? <span className="text-destructive">Save failed: {saveError}</span> : dirtyCount ? `${dirtyCount} unsaved` : lastSavedAt ? <><Check className="size-3" /> Saved {timeAgo(new Date(lastSavedAt))}</> : null}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <div className="hidden items-center rounded-lg border border-border p-0.5 lg:flex" role="radiogroup" aria-label="Workbench layout">
            {([["code", Code2, "Code"], ["split", Columns2, "Split"], ["preview", Eye, "Preview"]] as const).map(([id, Icon, label]) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button role="radio" aria-checked={view === id} aria-label={label} onClick={() => setView(id)} className={cn("flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground", view === id && "bg-accent text-foreground")}>
                    <Icon className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}><History /> <span className="hidden sm:inline">History</span></Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" asChild aria-label="Download source as zip">
                <a href={`/api/projects/${projectId}/export`}><Download /></a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download source (.zip)</TooltipContent>
          </Tooltip>
          <Button size="sm" onClick={() => setShareOpen(true)}><Share2 /> Share</Button>
        </div>
      </header>

      {isDesktop ? (
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          {showSidebar && (
            <>
              <ResizablePanel defaultSize="15" minSize={180} maxSize={360}>
                <ProjectSidebar activeId={projectId} conversations={conversations} activeConversationId={conversationId} onSelectConversation={(id) => { setConversationId(id); void loadMessages(id); }} />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel defaultSize="28" minSize={300}>
            {chat}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize={360}>
            {view === "split" ? (
              <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize="50" minSize={280}>{code}</ResizablePanel>
                <ResizableHandle />
                <ResizablePanel minSize={280}>{preview}</ResizablePanel>
              </ResizablePanelGroup>
            ) : view === "code" ? code : preview}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      ) : (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 border-b border-border" role="tablist">
          {([["chat", MessageSquare, "Chat"], ["code", Code2, "Code"], ["preview", Eye, "Preview"]] as const).map(([id, Icon, label]) => (
            <button key={id} role="tab" aria-selected={mobileTab === id} onClick={() => setMobileTab(id)} className={cn("flex flex-1 items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground", mobileTab === id && "border-b-2 border-brand text-foreground")}>
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">{mobileTab === "chat" ? chat : mobileTab === "code" ? code : preview}</div>
      </div>
      )}

      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} onRestored={() => void loadProject()} />
      <ShareDialog projectId={projectId} open={shareOpen} onOpenChange={setShareOpen} hasWorkingBuild={Boolean(project?.lastWorkingBuildId)} />
      <DiffDialog
        open={review !== null}
        onOpenChange={(o) => !o && setReview(null)}
        title="Review AI changes"
        description="Keep the changes, revert individual files, or reject everything and restore the previous version."
        before={review?.before ?? null}
        after={review?.after ?? null}
        beforeLabel="before"
        afterLabel="after"
        loading={review !== null && review.before === null}
        onRevertFile={review?.message.meta?.preVersionId ? async (p) => {
          try {
            await restoreVersion(review.message.meta!.preVersionId!, [p]);
            toast.success(`Reverted ${p}`);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        } : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => review && void revert(review.message)}>Reject all</Button>
            <Button onClick={() => setReview(null)}><Check /> Keep changes</Button>
          </>
        }
      />
    </div>
  );
}
