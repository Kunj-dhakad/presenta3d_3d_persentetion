"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Eye, MessageSquare, Pencil, Play, Rocket } from "lucide-react";
import { useWorkspace, type ChatMessageRow, type ProjectMeta } from "@/stores/workspace";
import { api, ApiError, errorMessage, streamJob } from "@/lib/api-client";
import type { BuildSummary } from "@/lib/build-types";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatPanel, type AiStatus } from "./chat-panel";
import { PreviewPane } from "./preview-pane";
import { ShareDialog } from "./share-dialog";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

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
  const [shareOpen, setShareOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const streamAbort = useRef<AbortController | null>(null);
  const startedFromParam = useRef(false);
  const jobRunning = Boolean(job && (job.status === "running" || job.status === "queued"));

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

  const send = useCallback(
    async (prompt: string) => {
      try {
        const r = await api<{ jobId: string; conversationId: string; userMessageId: string }>(`/api/projects/${projectId}/generate`, {
          method: "POST",
          json: { prompt, mode: "auto", conversationId },
        });
        setConversationId(r.conversationId);
        setMessages((m) => [...m, { id: r.userMessageId, role: "user", content: prompt, createdAt: new Date().toISOString(), meta: null }]);
        void follow(r.jobId);
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    [projectId, conversationId, follow],
  );

  // Initial load.
  useEffect(() => {
    useWorkspace.getState().reset(projectId);
    let cancelled = false;
    (async () => {
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
    router.replace(`/chat/${projectId}`);
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
        <Button variant="secondary" onClick={() => router.push("/projects")}>Back to presentations</Button>
      </div>
    );
  }

  const hasPreview = Boolean(project?.lastWorkingBuildId);
  const chat = (
    <ChatPanel
      messages={messages}
      job={job}
      ai={ai}
      busy={jobRunning}
      onSend={(p) => void send(p)}
      onCancel={() => job && void api(`/api/jobs/${job.jobId}`, { method: "DELETE" }).catch((e) => toast.error(errorMessage(e)))}
      onReview={() => {}}
      onRevert={(m) => void revert(m)}
      emptyHint="Describe your presentation: topic, audience, number of slides and the mood. Then ask for changes like “make slide 2 about pricing”."
      variant="presentation"
    />
  );
  const preview = <PreviewPane busy={jobRunning} onFixWithAI={() => void send("The presentation preview shows errors. Regenerate the deck so it renders correctly.")} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        {renaming ? (
          <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRenaming(false); }} className="h-8 max-w-72 text-sm" aria-label="Presentation name" />
        ) : (
          <button onClick={() => { setNameDraft(project?.name ?? ""); setRenaming(true); }} className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent" title="Rename">
            <span className="truncate text-sm font-medium">{project?.name ?? "Loading…"}</span>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" asChild disabled={!hasPreview}>
            <Link href={hasPreview ? `/present/${projectId}` : "#"} aria-disabled={!hasPreview} className={cn(!hasPreview && "pointer-events-none opacity-50")}>
              <Play /> Present
            </Link>
          </Button>
          <Button size="sm" onClick={() => setShareOpen(true)} disabled={!hasPreview}>
            <Rocket /> Publish
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

      <ShareDialog projectId={projectId} open={shareOpen} onOpenChange={setShareOpen} hasWorkingBuild={hasPreview} />
    </div>
  );
}
