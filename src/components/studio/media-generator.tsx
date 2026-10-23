"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw, Save, Sparkles, Square, TriangleAlert, CheckCircle2, XCircle, PlugZap } from "lucide-react";
import { api, errorMessage, streamJob, timeAgo, formatBytes } from "@/lib/api-client";
import type { MediaKind, MediaProviderInfo } from "@/lib/media";
import { MEDIA_LABELS } from "@/lib/media";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ModelViewer } from "./model-viewer";

type ProviderStatus = MediaProviderInfo & { availableForKind: boolean };
type JobRow = { id: string; kind: string; status: string; progress: number; error: string | null; createdAt: string; input: { prompt?: string; providerId?: string; options?: Record<string, unknown> }; output: { url: string; mimeType: string; size: number } | null };

const PLACEHOLDER: Record<MediaKind, string> = {
  image: "A brutalist concrete villa at golden hour, cinematic, 35mm photograph",
  video: "Slow dolly shot through a neon-lit rainy alley at night, reflections on wet pavement",
  audio: "Welcome to 3D Presentation. Describe an idea, and watch it become a working product.",
  sfx: "Heavy wooden door creaking open in a stone hallway, with echo",
  model3d: "A low-poly stylized treasure chest with brass fittings",
  material: "Weathered teal-painted wooden planks with peeling paint",
};

function Preview({ job, kind }: { job: JobRow; kind: MediaKind }) {
  if (!job.output) return null;
  const { url, mimeType } = job.output;
  if (mimeType.startsWith("image/"))
    return kind === "material" ? (
      <div className="grid gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Generated material" className="max-h-80 rounded-lg border border-border object-contain" />
        <div className="h-32 rounded-lg border border-border" style={{ backgroundImage: `url(${url})`, backgroundSize: "96px 96px" }} aria-label="Tiled preview" />
      </div>
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={job.input.prompt ?? "Generated image"} className="max-h-105 rounded-lg border border-border object-contain" />
    );
  if (mimeType.startsWith("video/")) return <video src={url} controls className="max-h-105 w-full rounded-lg border border-border bg-black" />;
  if (mimeType.startsWith("audio/")) return <audio src={url} controls className="w-full" />;
  if (mimeType.startsWith("model/")) return <ModelViewer url={url} />;
  return <a href={url} className="text-sm text-brand underline">Download output</a>;
}

export function MediaGenerator({ kind, providers }: { kind: MediaKind; providers: ProviderStatus[] }) {
  const usable = providers.filter((p) => p.availableForKind);
  const [providerId, setProviderId] = useState(usable[0]?.id ?? providers[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("1:1");
  const [quality, setQuality] = useState("medium");
  const [seconds, setSeconds] = useState("4");
  const [voice, setVoice] = useState("alloy");
  const [current, setCurrent] = useState<JobRow | null>(null);
  const [history, setHistory] = useState<JobRow[]>([]);
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const provider = providers.find((p) => p.id === providerId);

  const loadHistory = useCallback(async () => {
    try {
      const r = await api<{ jobs: JobRow[] }>(`/api/jobs?kinds=${kind}&limit=12`);
      setHistory(r.jobs);
    } catch {
      /* history is non-critical */
    }
  }, [kind]);
  useEffect(() => {
    let live = true;
    api<{ jobs: JobRow[] }>(`/api/jobs?kinds=${kind}&limit=12`).then((r) => live && setHistory(r.jobs), () => {});
    const ctrl = abort;
    return () => {
      live = false;
      ctrl.current?.abort();
    };
  }, [kind]);

  async function follow(jobId: string) {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await streamJob(
        jobId,
        (e) => {
          if (e.type === "progress") setCurrent((c) => (c ? { ...c, progress: e.progress } : c));
          if (e.type === "status") setCurrent((c) => (c ? { ...c, status: e.status, error: e.message ?? c.error } : c));
        },
        ctrl.signal,
      );
      const r = await api<{ job: JobRow }>(`/api/jobs/${jobId}`);
      setCurrent(r.job);
      if (r.job.status === "succeeded") toast.success(`${MEDIA_LABELS[kind]} ready`);
      await loadHistory();
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(errorMessage(e));
    }
  }

  async function generate(fromJob?: JobRow) {
    const p = (fromJob?.input.prompt ?? prompt).trim();
    if (p.length < 3) return;
    const options: Record<string, unknown> = fromJob?.input.options ?? (kind === "image" ? { aspect, quality } : kind === "video" ? { seconds, aspect: aspect === "9:16" ? "9:16" : "16:9" } : kind === "audio" ? { voice } : kind === "material" ? { quality } : {});
    try {
      const r = await api<{ jobId: string }>("/api/media", { method: "POST", json: { kind, providerId: fromJob?.input.providerId ?? providerId, prompt: p, options } });
      const row: JobRow = { id: r.jobId, kind, status: "queued", progress: 0, error: null, createdAt: new Date().toISOString(), input: { prompt: p, providerId, options }, output: null };
      setCurrent(row);
      void follow(r.jobId);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function saveToLibrary(job: JobRow) {
    setSaving(true);
    try {
      await api(`/api/jobs/${job.id}/save`, { method: "POST", json: {} });
      toast.success("Saved to asset library");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const running = current && (current.status === "queued" || current.status === "running");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div className="grid content-start gap-4">
        <div className="grid gap-1.5">
          <Label>Provider</Label>
          <Select value={providerId} onValueChange={setProviderId}>
            <SelectTrigger className="w-full" aria-label="Provider"><SelectValue placeholder="No provider" /></SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} {p.availableForKind ? "" : "· not configured"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {provider && <p className="text-xs text-muted-foreground">{provider.notes}{provider.model ? ` Model: ${provider.model}.` : ""}</p>}
        </div>
        {provider && !provider.availableForKind && (
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            <PlugZap className="size-4 shrink-0" />
            <div>
              <p className="font-medium">{MEDIA_LABELS[kind]} generation is not available</p>
              <p className="mt-0.5 text-warning/90">{provider.reason ?? `${provider.label} is not configured for ${MEDIA_LABELS[kind].toLowerCase()} generation.`} Nothing will be generated until a provider is configured on the server.</p>
            </div>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor={`prompt-${kind}`}>{kind === "audio" ? "Text to speak" : "Prompt"}</Label>
          <Textarea id={`prompt-${kind}`} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} maxLength={4000} placeholder={PLACEHOLDER[kind]} />
        </div>
        {(kind === "image" || kind === "video") && (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Aspect ratio</Label>
              <Select value={aspect} onValueChange={setAspect}>
                <SelectTrigger className="w-full" aria-label="Aspect ratio"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(kind === "image" ? ["1:1", "3:2", "2:3"] : ["16:9", "9:16"]).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {kind === "image" ? (
              <div className="grid gap-1.5">
                <Label>Quality</Label>
                <Select value={quality} onValueChange={setQuality}>
                  <SelectTrigger className="w-full" aria-label="Quality"><SelectValue /></SelectTrigger>
                  <SelectContent>{["low", "medium", "high"].map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label>Duration</Label>
                <Select value={seconds} onValueChange={setSeconds}>
                  <SelectTrigger className="w-full" aria-label="Duration"><SelectValue /></SelectTrigger>
                  <SelectContent>{["4", "8", "12"].map((s) => <SelectItem key={s} value={s}>{s} seconds</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
        {kind === "audio" && (
          <div className="grid gap-1.5">
            <Label>Voice</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger className="w-full" aria-label="Voice"><SelectValue /></SelectTrigger>
              <SelectContent>{["alloy", "ash", "coral", "echo", "sage", "shimmer", "verse", "nova"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={() => void generate()} disabled={prompt.trim().length < 3 || !provider?.availableForKind || Boolean(running)} className="flex-1">
            {running ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate
          </Button>
          {running && current && (
            <Button variant="secondary" onClick={() => void api(`/api/jobs/${current.id}`, { method: "DELETE" }).catch((e) => toast.error(errorMessage(e)))}>
              <Square /> Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-w-0 content-start gap-4">
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-4">
          {!current && <p className="text-sm text-muted-foreground">Your result will appear here.</p>}
          {current && running && (
            <div className="w-full max-w-sm text-center">
              <Loader2 className="mx-auto size-5 animate-spin text-brand" />
              <p className="mt-2 text-sm">{current.status === "queued" ? "Queued" : "Generating"}…</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-accent" role="progressbar" aria-valuenow={Math.round(current.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(4, current.progress * 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Long jobs keep running on the server if you leave this page.</p>
            </div>
          )}
          {current?.status === "failed" && (
            <div className="text-center">
              <TriangleAlert className="mx-auto size-5 text-destructive" />
              <p className="mt-2 text-sm text-destructive">{current.error ?? "Generation failed"}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => void generate(current)}><RefreshCw /> Retry</Button>
            </div>
          )}
          {current?.status === "cancelled" && <p className="text-sm text-muted-foreground">Cancelled.</p>}
          {current?.status === "succeeded" && current.output && (
            <div className="grid w-full gap-3">
              <Preview job={current} kind={kind} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{current.output.mimeType} · {formatBytes(current.output.size)}</span>
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => void generate(current)}><RefreshCw /> Regenerate</Button>
                <Button size="sm" variant="ghost" asChild><a href={`${current.output.url}?download=1`}><Download /> Download</a></Button>
                <Button size="sm" onClick={() => void saveToLibrary(current)} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />} Save to library</Button>
              </div>
            </div>
          )}
        </div>
        {history.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Recent {MEDIA_LABELS[kind].toLowerCase()} jobs</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {history.map((j) => (
                <li key={j.id}>
                  <button onClick={() => setCurrent(j)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent/40">
                    {j.status === "succeeded" ? <CheckCircle2 className="size-3.5 text-success" /> : j.status === "failed" ? <XCircle className="size-3.5 text-destructive" /> : <Loader2 className="size-3.5 animate-spin text-brand" />}
                    <span className="min-w-0 flex-1 truncate">{j.input.prompt}</span>
                    <span className="shrink-0 text-muted-foreground">{timeAgo(j.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
