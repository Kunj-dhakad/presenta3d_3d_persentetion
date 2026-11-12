"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Eye, Loader2, MessageSquare, Pencil, RotateCcw } from "lucide-react";
import { FigBack, FigMobile, FigMonitor, FigPlay, FigRocket, FigSettings, FigTablet } from "./figma-icons";
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
import { useChosenModel } from "./chosen-model";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { inIframe, notifyParent, paths } from "@/components/embed/parent-bridge";

type ProjectResponse = { project: ProjectMeta; lastBuild: (BuildSummary & { createdAt: string }) | null };
type Conversation = { id: string; title: string };
/** /api/projects/[id]/command: applied at once, or needs the full AI edit. */
type CommandResponse = { applied: boolean; needsAi: boolean; reply: string; preVersionId?: string | null; build: BuildSummary };
type ConfigResponse = { config: { aiProvider: string; openai: { configured: boolean; model: string | null } } };

/** The top bar's white outlined buttons (Settings, Present) in the design. */
const TOP_BTN = "h-9 gap-2 rounded-lg border-black/15 bg-white px-[15px] text-sm font-medium text-black/80 hover:bg-[#f4f8fb] hover:text-black";
const VIEWPORT_ICONS: Record<ViewportId, typeof FigMonitor> = { desktop: FigMonitor, tablet: FigTablet, mobile: FigMobile };

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
  // The AI model for the next request: the chat dropdown's choice, else the server's default (OpenAI only).
  const [chosenModel, chooseModel] = useChosenModel();
  // Settings are off while a generation runs: close the drawer if one starts while it is open.
  const [wasRunning, setWasRunning] = useState(jobRunning);
  if (wasRunning !== jobRunning) {
    setWasRunning(jobRunning);
    if (jobRunning) setSettingsOpen(false);
  }
  const model = ai?.provider === "openai" ? (chosenModel ?? ai.model) : null;

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
          json: { prompt, mode: "auto", conversationId, model: model ?? undefined },
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
    [projectId, conversationId, follow, model],
  );

  /**
   * A message about an existing presentation is first tried as a command (PRD 3):
   * simple changes (text size, colours, font, slide words) apply at once, with
   * Undo; anything else (new slides, images, scenes) becomes the full AI edit.
   */
  const [commanding, setCommanding] = useState(false);
  const undoCommand = useCallback(
    async (versionId: string) => {
      try {
        await api(`/api/projects/${projectId}/versions/${versionId}/restore`, { method: "POST", json: {} });
        await useWorkspace.getState().runBuild();
        await loadProject();
        toast.success("Change undone");
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    [projectId, loadProject],
  );
  const hasDeck = Boolean(project?.lastWorkingBuildId) && messages.length > 0;
  const sendOrCommand = useCallback(
    async (prompt: string): Promise<boolean> => {
      if (!hasDeck || jobRunning) return send(prompt);
      setCommanding(true);
      try {
        const r = await api<CommandResponse>(`/api/projects/${projectId}/command`, { method: "POST", json: { text: prompt, model: model ?? undefined } });
        if (r.applied) {
          useWorkspace.getState().setBuildFromServer(r.build, null);
          void loadProject();
          const at = new Date().toISOString();
          setMessages((m) => [...m, { id: `cmd-u-${at}`, role: "user", content: prompt, createdAt: at, meta: null }, { id: `cmd-a-${at}`, role: "assistant", content: r.reply, createdAt: at, meta: null }]);
          const before = r.preVersionId;
          toast.success(r.reply, before ? { action: { label: "Undo", onClick: () => void undoCommand(before) } } : undefined);
          return true;
        }
        if (r.needsAi) return send(prompt);
        toast(r.reply);
        return false;
      } catch {
        // The quick path is not available (AI busy, generation running…): the full AI edit still is.
        return send(prompt);
      } finally {
        setCommanding(false);
      }
    },
    [hasDeck, jobRunning, projectId, send, loadProject, undoCommand, model],
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
      busy={jobRunning || sending || commanding}
      onSend={sendOrCommand}
      onCancel={() => job && void api(`/api/jobs/${job.jobId}`, { method: "DELETE" }).catch((e) => toast.error(errorMessage(e)))}
      onReview={() => {}}
      onRevert={(m) => void revert(m)}
      emptyHint="Describe your presentation: topic, audience, number of slides and the mood. Then ask for changes, typed or spoken (mic), like “make the text bigger” or “make slide 2 about pricing”."
      variant="presentation"
      loading={!loaded}
      model={model}
      onModelChange={chooseModel}
    />
      </div>
    </div>
  );
  const preview = <PreviewPane busy={jobRunning} viewport={viewport} onFixWithAI={() => void send("The presentation preview shows errors. Regenerate the deck so it renders correctly.")} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar as in the Figma frames "Editor – …": 61px, white, title left, device switch centred, actions right. */}
      <header className="relative flex h-[61px] shrink-0 items-center gap-4 border-b border-border bg-white px-4">
        {inIframe() && (
          <button onClick={() => notifyParent("P3D_BACK")} className="-mx-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Back to presentations" title="Back to presentations">
            <FigBack className="size-[18px]" />
          </button>
        )}
        {renaming ? (
          <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(false); }} className="h-8 max-w-72 text-[15px]" aria-label="Presentation name" />
        ) : (
          <button onClick={() => { setNameDraft(project?.name ?? ""); setRenaming(true); }} className="group -mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent" title="Rename">
            <span className="truncate text-[15px] font-medium text-foreground">{project?.name ?? "Loading…"}</span>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        )}
        {/* Preview size, in the middle of the bar; off until the presentation is ready. */}
        <div className={cn("absolute left-1/2 hidden h-10 -translate-x-1/2 items-center gap-1 rounded-[14px] border border-black/10 bg-white px-1.5 lg:flex", jobRunning && "opacity-50")} role="radiogroup" aria-label="Preview size" aria-disabled={jobRunning}>
          {(Object.keys(VIEWPORTS) as ViewportId[]).map((id) => {
            const V = VIEWPORTS[id];
            const Icon = VIEWPORT_ICONS[id];
            return (
              <button key={id} type="button" role="radio" aria-checked={viewport === id} aria-label={V.label} title={jobRunning ? "Available when the presentation is ready" : V.label} disabled={jobRunning} onClick={() => setViewport(id)} className={cn("flex h-[30px] items-center gap-1.5 rounded-[10px] px-3 text-sm transition focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed", viewport === id ? "bg-[#e8f6fd] font-medium text-[#00a6ee]" : "text-black/60 enabled:hover:text-foreground")}>
                <Icon className="size-[15px]" />
                <span className="hidden xl:inline">{V.label.split(" ")[0]}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Off while a presentation is being made or changed, like the size switch, Present and Publish. */}
          <Button variant="outline" className={TOP_BTN} disabled={jobRunning} onClick={() => setSettingsOpen(true)} aria-haspopup="dialog" title={jobRunning ? "Available when the presentation is ready" : "Colours, voice-over, captions, Thank-you slide, footer, lead form, feedback, AI summary"}>
            <FigSettings className="size-3.5" /> <span className="max-sm:sr-only">Settings</span>
          </Button>
          {inIframe() ? (
            // Inside the PHP app, Present opens its full-page viewer, with the presenter on top.
            <Button variant="outline" className={TOP_BTN} disabled={!hasPreview || jobRunning} onClick={() => notifyParent("P3D_PRESENT", { projectId })}>
              <FigPlay className="size-3.5" /> <span className="max-sm:sr-only">Present</span>
            </Button>
          ) : (
            <Button variant="outline" className={TOP_BTN} asChild disabled={!hasPreview || jobRunning}>
              <Link href={hasPreview && !jobRunning ? paths.present(projectId) : "#"} aria-disabled={!hasPreview || jobRunning} className={cn((!hasPreview || jobRunning) && "pointer-events-none opacity-50")}>
                <FigPlay className="size-3.5" /> <span className="max-sm:sr-only">Present</span>
              </Link>
            </Button>
          )}
          <Button className="h-9 gap-2 rounded-lg bg-[#00a6ee] bg-none px-[15px] text-sm font-medium text-white shadow-none hover:bg-[#0097da] hover:brightness-100" onClick={() => (inIframe() ? void publishNow() : setShareOpen(true))} disabled={!hasPreview || publishing || jobRunning}>
            {publishing ? <Loader2 className="size-3.5 animate-spin" /> : <FigRocket className="size-3.5" />} {publishing ? "Publishing…" : "Publish"}
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
          <div className="flex shrink-0 border-b border-border bg-white" role="tablist">
            {([["chat", MessageSquare, "Chat"], ["preview", Eye, "Preview"]] as const).map(([id, Icon, label]) => (
              <button key={id} role="tab" aria-selected={mobileTab === id} onClick={() => setMobileTab(id)} className={cn("flex flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent py-2.5 text-sm text-black/60", mobileTab === id && "border-[#00a6ee] font-medium text-[#00a6ee]")}>
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
