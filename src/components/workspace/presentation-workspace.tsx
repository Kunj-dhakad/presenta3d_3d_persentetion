"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, Eye, Loader2, MessageSquare, Pencil, Play, Rocket, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useWorkspace, type ChatMessageRow, type ProjectMeta } from "@/stores/workspace";
import { api, ApiError, errorMessage, streamJob } from "@/lib/api-client";
import type { BuildSummary } from "@/lib/build-types";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatPanel, type AiStatus } from "./chat-panel";
import { PreviewPane, VIEWPORTS, type ViewportId } from "./preview-pane";
import { ShareDialog } from "./share-dialog";
import { SettingsDrawer } from "./settings-drawer";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { inIframe, notifyParent, paths } from "@/components/embed/parent-bridge";

type ProjectResponse = { project: ProjectMeta; lastBuild: (BuildSummary & { createdAt: string }) | null };
type Conversation = { id: string; title: string };
type ConfigResponse = { config: { aiProvider: string; openai: { configured: boolean; model: string | null } } };

const toAiStatus = (c: ConfigResponse): AiStatus =>
  c.config.aiProvider === "mock" ? { configured: true, provider: "mock", model: "offline test provider" } : { configured: c.config.openai.configured, provider: "openai", model: c.config.openai.model };

/**
 * Simplified workspace for 3D presentations: chat on the left, a large live
 * preview on the right, and Present / Publish actions. No code editor.
 */
export function PresentationWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const project = useWorkspace((s) => s.project);
  const job = useWorkspace((s) => s.job);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus>(null);
  // ?share=1 (the PHP publish page's "Unpublish & private links"): open the share dialog.
  const [shareOpen, setShareOpen] = useState(() => params.get("share") === "1");
  const [publishing, setPublishing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  const [viewport, setViewport] = useState<ViewportId>("desktop");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const streamAbort = useRef<AbortController | null>(null);
  const startedFromParam = useRef(false);
  const followingJob = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const jobRunning = Boolean(job && (job.status === "running" || job.status === "queued"));

  // The PHP page shows this presentation's own address (edit/<id>) once it is open.
  useEffect(() => {
    notifyParent("P3D_OPENED", { projectId });
  }, [projectId]);

  const loadMessages = useCallback(async (cid: string) => {
    const r = await api<{ messages: ChatMessageRow[] }>(`/api/conversations/${cid}/messages`);
    setMessages(r.messages);
  }, []);

  const loadProject = useCallback(async () => {
    const p = await api<ProjectResponse>(`/api/projects/${projectId}`);
    const st = useWorkspace.getState();
    st.setProject(p.project);
    st.setBuildFromServer(p.lastBuild, p.project.previewUrl);
    return p;
  }, [projectId]);

  const follow = useCallback(
    async (jobId: string) => {
      if (followingJob.current === jobId) return;
      followingJob.current = jobId;
      streamAbort.current?.abort();
      const ctrl = new AbortController();
      streamAbort.current = ctrl;
      useWorkspace.getState().startJob(jobId);
      try {
        let named = false;
        await streamJob(
          jobId,
          (e) => {
            useWorkspace.getState().applyJobEvent(e);
            // The first preview is saved with the deck's title as the name: show it now, not at the end.
            if (e.type === "build" && !named) {
              named = true;
              api<ProjectResponse>(`/api/projects/${projectId}`).then((p) => useWorkspace.getState().setProject(p.project), () => {});
            }
          },
          ctrl.signal,
        );
      } catch (e) {
        if (!ctrl.signal.aborted) toast.error(errorMessage(e));
      }
      if (ctrl.signal.aborted) return;
      followingJob.current = null;
      try {
        await loadProject();
        const cs = await api<{ conversations: Conversation[] }>(`/api/projects/${projectId}/conversations`);
        const cid = cs.conversations[0]?.id ?? null;
        if (cid) {
          setConversationId(cid);
          await loadMessages(cid);
        }
      } catch (e) {
        toast.error(errorMessage(e));
      }
      if (useWorkspace.getState().job?.status === "succeeded") useWorkspace.setState({ job: null });
    },
    [loadMessages, loadProject, projectId],
  );

  /** Returns false when the prompt was not accepted, so the chat box keeps the text. */
  const send = useCallback(
    async (prompt: string): Promise<boolean> => {
      // Blocks a second submit (double Enter, click + Enter) while the first request is in flight.
      if (sendingRef.current) return false;
      sendingRef.current = true;
      setSending(true);
      try {
        const r = await api<{ jobId: string; conversationId: string; userMessageId: string }>(`/api/projects/${projectId}/generate`, {
          method: "POST",
          json: { prompt, mode: "auto", conversationId },
        });
        setConversationId(r.conversationId);
        setMessages((m) => [...m, { id: r.userMessageId, role: "user", content: prompt, createdAt: new Date().toISOString(), meta: null }]);
        void follow(r.jobId);
        return true;
      } catch (e) {
        // A generation is still running for this project: show its progress in the chat instead of an error.
        const running = e instanceof ApiError && e.code === "JOB_RUNNING" ? (e.details as { jobId?: string } | null)?.jobId : undefined;
        if (running) void follow(running);
        else toast.error(errorMessage(e));
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [projectId, conversationId, follow],
  );

  // Initial load.
  useEffect(() => {
    useWorkspace.getState().reset(projectId);
    let cancelled = false;
    // New presentation (?job=): show progress at once, while the rest loads in parallel.
    const newJob = params.get("job");
    if (newJob) router.replace(paths.workspace(projectId));
    (async () => {
      if (newJob) void follow(newJob);
      try {
        const [, cs, cfg, jobs] = await Promise.all([
          loadProject(),
          api<{ conversations: Conversation[] }>(`/api/projects/${projectId}/conversations`),
          api<ConfigResponse>("/api/config"),
          api<{ jobs: { id: string; status: string; projectId: string | null }[] }>("/api/jobs?kinds=project-generate,project-edit,project-repair&limit=10"),
        ]);
        if (cancelled) return;
        setAi(toAiStatus(cfg));
        const cid = cs.conversations[0]?.id ?? null;
        setConversationId(cid);
        if (cid) await loadMessages(cid);
        setLoaded(true);
        const running = jobs.jobs.find((j) => j.projectId === projectId && (j.status === "running" || j.status === "queued"));
        if (running) void follow(running.id);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof ApiError && e.status === 404 ? "This presentation does not exist or you do not have access to it." : errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
      streamAbort.current?.abort();
      // Let a remount (React Strict Mode runs effects twice in development) follow the job again.
      followingJob.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Re-check AI configuration when returning to the tab (e.g. after editing .env).
  useEffect(() => {
    const refresh = () => api<ConfigResponse>("/api/config").then((c) => setAi(toAiStatus(c)), () => {});
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  // Start generation from ?prompt= (new presentation flow), once.
  useEffect(() => {
    const prompt = params.get("prompt");
    if (!loaded || !prompt || startedFromParam.current || jobRunning) return;
    startedFromParam.current = true;
    router.replace(paths.workspace(projectId));
    void send(prompt);
  }, [loaded, params, jobRunning, projectId, router, send]);

  async function revert(m: ChatMessageRow) {
    if (!m.meta?.preVersionId) return;
    try {
      await api(`/api/projects/${projectId}/versions/${m.meta.preVersionId}/restore`, { method: "POST", json: {} });
      await useWorkspace.getState().runBuild();
      await loadProject();
      toast.success("Reverted to the previous version");
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
        <Button variant="secondary" onClick={() => notifyParent("P3D_BACK")}>Back to presentations</Button>
      </div>
    );
  }

  const hasPreview = Boolean(project?.lastWorkingBuildId);

  /**
   * Inside the PHP app, Publish puts the latest version live and then hands over
   * to PHP's publish page (link, embed code, QR, social), like the 2D editor did.
   */
  async function publishNow() {
    if (publishing) return;
    setPublishing(true);
    try {
      const r = await api<{ deployment: { status: string; error: string | null } }>(`/api/projects/${projectId}/publish`, { method: "POST" });
      if (r.deployment.status === "ready") {
        notifyParent("P3D_PUBLISHED", { projectId });
        // PHP opens its page now; free the button in case it does not.
        setTimeout(() => setPublishing(false), 10000);
        return;
      }
      toast.error(r.deployment.error ?? "Publishing failed. Please try again.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
    setPublishing(false);
  }
  // The last request got no answer and nothing is running: its job was lost (the tab was closed
  // before it started, or the server stopped it). Offer to send it again.
  const last = messages[messages.length - 1];
  const unanswered = loaded && !jobRunning && !sending && last?.role === "user" ? last : null;
  const chat = (
    <div className="flex h-full min-h-0 flex-col">
      {unanswered && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">This request did not finish.</span>
          <Button size="xs" variant="secondary" onClick={() => void send(unanswered.content)}>
            <RotateCcw /> Try again
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
    <ChatPanel
      messages={messages}
      job={job}
      ai={ai}
      busy={jobRunning || sending}
      onSend={send}
      onCancel={() => job && void api(`/api/jobs/${job.jobId}`, { method: "DELETE" }).catch((e) => toast.error(errorMessage(e)))}
      onReview={() => {}}
      onRevert={(m) => void revert(m)}
      emptyHint="Describe your presentation: topic, audience, number of slides and the mood. Then ask for changes like “make slide 2 about pricing”."
      variant="presentation"
      loading={!loaded}
    />
      </div>
    </div>
  );
  const preview = <PreviewPane busy={jobRunning} viewport={viewport} onFixWithAI={() => void send("The presentation preview shows errors. Regenerate the deck so it renders correctly.")} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        {inIframe() && (
          <button onClick={() => notifyParent("P3D_BACK")} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Back to presentations" title="Back to presentations">
            <ArrowLeft className="size-4" />
          </button>
        )}
        {renaming ? (
          <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(false); }} className="h-8 max-w-72 text-sm" aria-label="Presentation name" />
        ) : (
          <button onClick={() => { setNameDraft(project?.name ?? ""); setRenaming(true); }} className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent" title="Rename">
            <span className="truncate text-sm font-medium">{project?.name ?? "Loading…"}</span>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        )}
        {/* Preview size, in the middle of the bar (the wireframe's device switch). */}
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-muted/80 p-1 lg:flex" role="radiogroup" aria-label="Preview size">
          {(Object.keys(VIEWPORTS) as ViewportId[]).map((id) => {
            const V = VIEWPORTS[id];
            return (
              <button key={id} type="button" role="radio" aria-checked={viewport === id} aria-label={V.label} title={V.label} onClick={() => setViewport(id)} className={cn("flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-muted-foreground transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", viewport === id ? "bg-card text-brand shadow-xs" : "hover:text-foreground")}>
                <V.icon className="size-3.5" />
                <span className="hidden xl:inline">{V.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" title="Template, colours, avatar, voice-over, captions, auto-play, Thank-you slide, lead form, feedback">
            <SlidersHorizontal /> <span className="max-sm:sr-only">Settings</span>
          </Button>
          {inIframe() ? (
            // Inside the PHP app, Present opens its full-page viewer, with the presenter on top.
            <Button size="sm" variant="secondary" disabled={!hasPreview} onClick={() => notifyParent("P3D_PRESENT", { projectId })}>
              <Play /> <span className="max-sm:sr-only">Present</span>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" asChild disabled={!hasPreview}>
              <Link href={hasPreview ? paths.present(projectId) : "#"} aria-disabled={!hasPreview} className={cn(!hasPreview && "pointer-events-none opacity-50")}>
                <Play /> <span className="max-sm:sr-only">Present</span>
              </Link>
            </Button>
          )}
          <Button size="sm" onClick={() => (inIframe() ? void publishNow() : setShareOpen(true))} disabled={!hasPreview || publishing}>
            {publishing ? <Loader2 className="animate-spin" /> : <Rocket />} {publishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </header>

      {isDesktop ? (
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="30" minSize={300} maxSize="45">
              {chat}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel minSize={420}>{preview}</ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 border-b border-border" role="tablist">
            {([["chat", MessageSquare, "Chat"], ["preview", Eye, "Preview"]] as const).map(([id, Icon, label]) => (
              <button key={id} role="tab" aria-selected={mobileTab === id} onClick={() => setMobileTab(id)} className={cn("flex flex-1 items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground", mobileTab === id && "border-b-2 border-brand text-foreground")}>
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">{mobileTab === "chat" ? chat : preview}</div>
        </div>
      )}

      <ShareDialog projectId={projectId} projectName={project?.name ?? "3D presentation"} open={shareOpen} onOpenChange={setShareOpen} hasWorkingBuild={hasPreview} />
      <SettingsDrawer projectId={projectId} open={settingsOpen} onOpenChange={setSettingsOpen} designReady={hasPreview && !jobRunning} onSaved={() => void loadProject().catch(() => {})} />
    </div>
  );
}
