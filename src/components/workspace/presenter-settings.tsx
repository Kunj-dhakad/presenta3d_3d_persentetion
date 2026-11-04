"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api-client";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { phpPost } from "@/lib/php-api";
import { cn } from "@/lib/utils";
import { SubHeading, ToggleRow } from "./settings-parts";

/**
 * The presenter part of the Settings drawer: what plays over the
 * presentation on its public link and in Present (the PHP viewer,
 * views/default/presentation3d/viewer.php): narration voice, subtitles, the
 * (talking) avatar, visitors' Q&A, a welcome text, the lead and feedback
 * forms, and what visitors did (Insights). Stored by the PHP app
 * (3d-view/settings, Presentation3d_view_controller) and applied at once,
 * without rebuilding or republishing the deck.
 */

type AvatarVideoStatus = "none" | "making" | "ready" | "failed";
type PresenterSettings = {
  narration: boolean;
  voice_id: string;
  subtitles: boolean;
  subtitle_text_color: string;
  subtitle_bg_color: string;
  avatar: boolean;
  avatar_id: number | null;
  avatar_image: string;
  avatar_video: string;
  chat: boolean;
  welcome_text: string;
  lead_form: boolean;
  lead_after_slide: number;
  autoresponder_id: number | null;
  list_id: string;
  feedback: boolean;
  avatar_video_status: AvatarVideoStatus;
};
type Voice = { id: string; name: string; locale: string; gender: string; image: string; preview: string };
type Avatar = { id: number; name: string; image: string; video: string };
type Responder = { id: number; title: string };
type ResponderList = { id: string; title: string };
type Stats = {
  views: number;
  questions: number;
  leads: number;
  feedback: number;
  rating: number | null;
  slide_views: number[];
  recent_feedback: { rating: number; message: string; at: string }[];
};
type SettingsResponse = { settings: PresenterSettings; voices: Voice[]; avatars: Avatar[]; default_avatar?: string; autoresponders: Responder[]; stats: Stats };

const WELCOME_MAX = 300;
/** Making a talking avatar: one background step may take ~2 minutes (narration + DupDub). */
const AVATAR_STEP_TIMEOUT_MS = 150_000;
const AVATAR_POLL_MS = 20_000;

/** "#rrggbbaa" -> ["#rrggbb", alpha 0-100]; "#rrggbb" is fully opaque. */
function splitColor(value: string): [string, number] {
  const hex = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value.toLowerCase() : "#080a0ec7";
  const alpha = hex.length === 9 ? Math.round((parseInt(hex.slice(7), 16) / 255) * 100) : 100;
  return [hex.slice(0, 7), alpha];
}
function joinColor(color: string, alpha: number): string {
  const a = Math.round((Math.max(0, Math.min(100, alpha)) / 100) * 255);
  return color + a.toString(16).padStart(2, "0");
}

const AVATAR_STATUS_TEXT: Record<AvatarVideoStatus, string> = {
  none: "",
  making: "Making the talking avatar (it says slide 1)… this takes a few minutes.",
  ready: "Talking avatar ready: it says slide 1 and moves with the narration.",
  failed: "The talking avatar could not be made; the photo is shown. Try another avatar, or save again.",
};

export function usePresenterSettings(projectId: string, open: boolean) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<PresenterSettings | null>(null);
  const [lists, setLists] = useState<ResponderList[]>([]);
  /** Which autoresponder `lists` belongs to; its lists are loading until it matches the chosen one. */
  const [listsFor, setListsFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<AvatarVideoStatus>("none");
  const sample = useRef<HTMLAudioElement | null>(null);

  // Load the settings, the choices and the insights each time the drawer opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    phpPost<SettingsResponse>("3d-view/settings", { id: projectId }).then(
      (r) => {
        if (!live) return;
        setError(null);
        setData(r);
        setForm(r.settings);
        setAvatarStatus(r.settings.avatar_video_status);
      },
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
      sample.current?.pause();
      setPreviewing(false);
    };
  }, [open, projectId]);

  // The chosen autoresponder's lists.
  const responderId = form?.lead_form ? form.autoresponder_id : null;
  const listsLoading = !!responderId && listsFor !== responderId;
  useEffect(() => {
    if (!open || !responderId) return;
    let live = true;
    phpPost<{ lists: ResponderList[] }>("3d-view/settings", { id: projectId, action: "lists", autoresponder_id: responderId }, { timeoutMs: 60_000 }).then(
      (r) => {
        if (!live) return;
        setLists(r.lists);
        setListsFor(responderId);
      },
      (e) => {
        if (!live) return;
        setLists([]);
        setListsFor(responderId);
        toast.error((e as Error).message);
      },
    );
    return () => {
      live = false;
    };
  }, [open, projectId, responderId]);

  // While a talking avatar is being made, move it on in the background (the cron does too).
  useEffect(() => {
    if (!open || avatarStatus !== "making") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      phpPost<{ settings: PresenterSettings }>("3d-view/settings", { id: projectId, action: "avatar" }, { timeoutMs: AVATAR_STEP_TIMEOUT_MS })
        .then((r) => {
          if (!live) return;
          setAvatarStatus(r.settings.avatar_video_status);
          if (r.settings.avatar_video_status === "ready") toast.success("Your talking avatar is ready.");
        })
        .catch(() => { /* try again on the next step */ })
        .finally(() => {
          if (live) timer = setTimeout(step, AVATAR_POLL_MS);
        });
    };
    step();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, projectId, avatarStatus]);

  const set = (patch: Partial<PresenterSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const voice = data?.voices.find((v) => v.id === form?.voice_id);

  function playSample() {
    if (!voice?.preview) return;
    if (previewing) {
      sample.current?.pause();
      setPreviewing(false);
      return;
    }
    sample.current?.pause();
    const audio = new Audio(voice.preview);
    sample.current = audio;
    audio.onended = () => setPreviewing(false);
    audio.onerror = () => {
      setPreviewing(false);
      toast.error("This voice sample could not be played.");
    };
    setPreviewing(true);
    audio.play().catch(() => setPreviewing(false));
  }

  /** Saves every presenter setting at once (one PHP record), from whichever section's Save was pressed. */
  async function save() {
    if (!form) return;
    if (form.lead_form && form.autoresponder_id && !form.list_id) {
      toast.error("Choose a list for the autoresponder, or set it to none.");
      return;
    }
    setSaving(true);
    try {
      const r = await phpPost<{ settings: PresenterSettings; message?: string }>("3d-view/settings", {
        id: projectId,
        save: 1,
        narration: form.narration,
        voice_id: form.voice_id,
        subtitles: form.subtitles,
        subtitle_text_color: form.subtitle_text_color,
        subtitle_bg_color: form.subtitle_bg_color,
        avatar: form.avatar,
        avatar_id: form.avatar_id ?? "",
        chat: form.chat,
        welcome_text: form.welcome_text,
        lead_form: form.lead_form,
        lead_after_slide: form.lead_after_slide,
        autoresponder_id: form.lead_form ? (form.autoresponder_id ?? "") : "",
        list_id: form.lead_form ? form.list_id : "",
        feedback: form.feedback,
      });
      setForm(r.settings);
      setAvatarStatus(r.settings.avatar_video_status);
      toast.success(r.message || "Presenter settings saved.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Adds a photo to the business's avatar library (PHP: 3d-view/settings, action avatar_upload)
   * and chooses it for this presentation; Save applies it.
   */
  async function addAvatar(photo: Blob, name: string): Promise<boolean> {
    try {
      const r = await phpPost<{ avatar: Avatar }>("3d-view/settings", { id: projectId, action: "avatar_upload", photo, name }, { timeoutMs: 60_000 });
      setData((d) => (d ? { ...d, avatars: [...d.avatars.filter((a) => a.id !== r.avatar.id), r.avatar] } : d));
      setForm((f) => (f ? { ...f, avatar: true, avatar_id: r.avatar.id } : f));
      toast.success("Avatar added to your library. Press Save to use it.");
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  return { data, form, set, error, saving, save, previewing, playSample, voice, avatarStatus, lists, setLists, listsLoading, addAvatar };
}

/**
 * A photo as a JPEG of at most `max` pixels a side (smaller uploads, and any
 * format the browser can open: PNG, WebP, JPEG…). Null if it cannot be read.
 */
async function toJpeg(file: Blob, max = 1024): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * k);
    canvas.height = Math.round(bitmap.height * k);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  } catch {
    return null;
  }
}

/** "Upload photo" and "Create with AI": new avatars for the library, chosen at once. */
function NewAvatar({ p }: { p: Loaded }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"idle" | "painting" | "saving">("idle");
  const [portrait, setPortrait] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    const jpeg = await toJpeg(file);
    if (!jpeg) toast.error("This photo could not be opened. Use a JPG, PNG or WebP photo.");
    else await p.addAvatar(jpeg, file.name.replace(/\.[^.]+$/, "").slice(0, 60));
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function paint() {
    setBusy("painting");
    try {
      const r = await api<{ image: string }>("/api/presenter/avatar-image", { method: "POST", json: { description } });
      setPortrait(r.image);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy("idle");
    }
  }

  async function use() {
    if (!portrait) return;
    setBusy("saving");
    const photo = await (await fetch(portrait)).blob();
    const ok = await p.addAvatar(photo, name.trim() || "AI presenter");
    setBusy("idle");
    if (ok) {
      setCreating(false);
      setPortrait(null);
      setDescription("");
      setName("");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload photo
        </Button>
        <Button type="button" size="sm" variant={creating ? "secondary" : "outline"} onClick={() => setCreating((v) => !v)}>
          <Sparkles /> Create with AI
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">A clear, front-facing photo of one face works best for the talking presenter.</p>
      {creating ? (
        <div className="space-y-2 rounded-xl border p-3">
          <Label htmlFor="avatar-describe">Describe your presenter</Label>
          <Textarea
            id="avatar-describe"
            rows={2}
            maxLength={500}
            placeholder="e.g. A friendly woman in her thirties with short dark hair, navy blazer"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy !== "idle"}
          />
          <div className="flex items-center gap-3">
            {portrait ? (
              // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
              <img src={portrait} alt="Your AI presenter" className="size-20 shrink-0 rounded-xl object-cover" />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {portrait ? <Input aria-label="Avatar name" placeholder="Name (optional)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} disabled={busy !== "idle"} /> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={portrait ? "outline" : "default"} onClick={() => void paint()} disabled={busy !== "idle" || description.trim().length < 3}>
                  {busy === "painting" ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy === "painting" ? "Creating… (about 30 s)" : portrait ? "Try again" : "Create"}
                </Button>
                {portrait ? (
                  <Button type="button" size="sm" onClick={() => void use()} disabled={busy !== "idle"}>
                    {busy === "saving" ? <Loader2 className="animate-spin" /> : <Check />} Use this avatar
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type PresenterState = ReturnType<typeof usePresenterSettings>;
type Loaded = PresenterState & { data: SettingsResponse; form: PresenterSettings };

/** Renders `children` once the presenter settings have loaded; until then a spinner, or the error. */
export function PresenterGate({ p, children }: { p: PresenterState; children: (p: Loaded) => React.ReactNode }) {
  if (p.error) return <p className="text-sm text-destructive">{p.error}</p>;
  if (!p.form || !p.data) return <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading…</p>;
  return <>{children(p as Loaded)}</>;
}

function SaveButton({ p }: { p: PresenterState }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      <span className="text-xs text-muted-foreground">Applies at once, no need to publish again.</span>
      <Button size="sm" onClick={() => void p.save()} disabled={!p.form || p.saving}>{p.saving ? <Loader2 className="animate-spin" /> : <Check />} Save</Button>
    </div>
  );
}

export function AvatarSection({ p }: { p: Loaded }) {
  const { form, data, avatarStatus } = p;
  return (
    <>
      <ToggleRow id="presenter-avatar" title="Show AI presenter" hint="A presenter in the corner. A photo avatar becomes a talking video of slide 1." checked={form.avatar} onChange={(v) => p.set({ avatar: v })} first>
        <SubHeading first>Profile image</SubHeading>
        <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5" role="radiogroup" aria-label="Avatar">
          {[{ id: 0, name: "Default", image: data.default_avatar ?? "", video: "" } as Avatar, ...data.avatars].map((a) => {
            const chosen = (form.avatar_id ?? 0) === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                title={a.name + (a.video ? " (video)" : "")}
                onClick={() => p.set({ avatar_id: a.id || null })}
                className={cn("relative aspect-square overflow-hidden rounded-xl border-2 border-transparent bg-muted transition hover:border-brand/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", chosen && "border-brand")}
              >
                {a.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- avatar library images on the PHP app's CDN
                  <img src={a.image} alt={a.name} className="size-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex size-full items-center justify-center text-xs text-muted-foreground">Default</span>
                )}
                {a.id === 0 && a.image ? <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] text-white">Default</span> : null}
                {a.video ? <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">video</span> : null}
                {chosen ? <Check className="absolute top-1 right-1 size-4 rounded-full bg-brand p-0.5 text-brand-foreground" /> : null}
              </button>
            );
          })}
        </div>
        {data.avatars.length === 0 ? <p className="text-xs text-muted-foreground">No avatars in your library yet; the default presenter is used.</p> : null}
        <NewAvatar p={p} />
        {avatarStatus !== "none" ? (
          <p className={cn("flex items-center gap-1.5 text-xs", avatarStatus === "failed" ? "text-destructive" : "text-muted-foreground")}>
            {avatarStatus === "making" ? <Loader2 className="size-3.5 animate-spin" /> : avatarStatus === "ready" ? <Check className="size-3.5 text-brand" /> : null}
            {AVATAR_STATUS_TEXT[avatarStatus]}
          </p>
        ) : null}
      </ToggleRow>
      <SaveButton p={p} />
    </>
  );
}

export function VoiceSection({ p }: { p: Loaded }) {
  const { form, data } = p;
  const [bgColor, bgAlpha] = splitColor(form.subtitle_bg_color);
  return (
    <>
      <ToggleRow id="presenter-narration" title="Voice-over" hint="A voice reads each slide and moves on when it is done." checked={form.narration} onChange={(v) => p.set({ narration: v })} first>
        <div className="flex items-center gap-2">
          <Select value={form.voice_id} onValueChange={(v) => p.set({ voice_id: v })}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="Voice"><SelectValue placeholder="Choose a voice" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {data.voices.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.name} <span className="text-muted-foreground">· {v.gender}{v.locale ? ` · ${v.locale}` : ""}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="secondary" onClick={p.playSample} disabled={!p.voice?.preview} title="Listen to this voice">
            {p.previewing ? <Pause /> : <Play />} Listen
          </Button>
        </div>
      </ToggleRow>

      <ToggleRow id="presenter-subtitles" title="Voice captions" hint="The narration as text, each word lit as it is said." checked={form.subtitles} onChange={(v) => p.set({ subtitles: v })}>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs">
            <input type="color" value={splitColor(form.subtitle_text_color)[0]} onChange={(e) => p.set({ subtitle_text_color: e.target.value })} className="h-7 w-9 cursor-pointer rounded-md border border-border bg-transparent" aria-label="Text colour" />
            Text
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="color" value={bgColor} onChange={(e) => p.set({ subtitle_bg_color: joinColor(e.target.value, bgAlpha) })} className="h-7 w-9 cursor-pointer rounded-md border border-border bg-transparent" aria-label="Background colour" />
            Background
          </label>
          <div className="flex min-w-40 flex-1 items-center gap-2 text-xs">
            <span className="shrink-0">Opacity</span>
            <Slider value={[bgAlpha]} min={0} max={100} step={5} onValueChange={([a]) => p.set({ subtitle_bg_color: joinColor(bgColor, a) })} aria-label="Background opacity" />
            <span className="w-9 shrink-0 text-right tabular-nums">{bgAlpha}%</span>
          </div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ backgroundColor: "#111827" }}>
          <span className="rounded px-2 py-1 text-sm font-semibold" style={{ color: form.subtitle_text_color, background: form.subtitle_bg_color }}>Your subtitles look like this</span>
        </div>
      </ToggleRow>
      <SaveButton p={p} />
    </>
  );
}

export function QaSection({ p }: { p: Loaded }) {
  const { form } = p;
  return (
    <>
      <ToggleRow id="presenter-chat" title="Q&A" hint="Viewers ask questions; answers come from this presentation's content." checked={form.chat} onChange={(v) => p.set({ chat: v })} first />
      <div className="space-y-1.5 border-t border-border pt-3">
        <Label htmlFor="presenter-welcome" className="text-sm font-semibold">Welcome text</Label>
        <Textarea id="presenter-welcome" value={form.welcome_text} maxLength={WELCOME_MAX} rows={2} onChange={(e) => p.set({ welcome_text: e.target.value })} placeholder="Your presenter will walk you through every slide. Ask questions any time." />
        <p className="text-right text-xs text-muted-foreground">{form.welcome_text.length}/{WELCOME_MAX}</p>
      </div>
      <SaveButton p={p} />
    </>
  );
}

export function LeadSection({ p }: { p: Loaded }) {
  const { form, data, lists, listsLoading } = p;
  return (
    <>
      <ToggleRow id="presenter-lead" title="Built-in lead form" hint="Asks each visitor once for their name and email. Leads appear on your Leads page." checked={form.lead_form} onChange={(v) => p.set({ lead_form: v })} first>
        <SubHeading first>When to show</SubHeading>
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-xs">After slide</span>
          <Select value={String(form.lead_after_slide)} onValueChange={(v) => p.set({ lead_after_slide: Number(v) })}>
            <SelectTrigger className="w-24" aria-label="Show the lead form after slide"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <SubHeading>Send leads to</SubHeading>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={form.autoresponder_id ? String(form.autoresponder_id) : "none"} onValueChange={(v) => { p.setLists([]); p.set({ autoresponder_id: v === "none" ? null : Number(v), list_id: "" }); }}>
            <SelectTrigger aria-label="Autoresponder"><SelectValue placeholder="Autoresponder" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No autoresponder (Leads page only)</SelectItem>
              {data.autoresponders.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.title}</SelectItem>)}
            </SelectContent>
          </Select>
          {form.autoresponder_id ? (
            <Select value={form.list_id || undefined} onValueChange={(v) => p.set({ list_id: v })} disabled={listsLoading}>
              <SelectTrigger aria-label="List"><SelectValue placeholder={listsLoading ? "Loading lists…" : "Choose a list"} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {/* The saved list stays choosable while the service's lists load (or fail). */}
                {form.list_id && !lists.some((l) => l.id === form.list_id) ? <SelectItem value={form.list_id}>{form.list_id}</SelectItem> : null}
                {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        {data.autoresponders.length === 0 ? <p className="text-xs text-muted-foreground">Connect an autoresponder in Integrations to send leads to a mailing list.</p> : null}
      </ToggleRow>
      <SaveButton p={p} />
    </>
  );
}

export function FeedbackSection({ p }: { p: Loaded }) {
  return (
    <>
      <ToggleRow id="presenter-feedback" title="Ask for feedback" hint="At the end, asks each visitor once for a 1-5 star rating and a comment." checked={p.form.feedback} onChange={(v) => p.set({ feedback: v })} first />
      <SaveButton p={p} />
    </>
  );
}

export function InsightsSection({ p }: { p: Loaded }) {
  const stats = p.data.stats;
  const maxSlideViews = Math.max(1, ...stats.slide_views);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Views", stats.views],
          ["Questions", stats.questions],
          ["Leads", stats.leads],
          ["Rating", stats.rating !== null ? `${stats.rating}★ (${stats.feedback})` : "—"],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
            <p className="text-lg font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <section>
        <SubHeading>Views per slide</SubHeading>
        {stats.slide_views.length ? (
          <div className="space-y-1.5">
            {stats.slide_views.map((n, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-muted-foreground">Slide {i + 1}</span>
                <span className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (n / maxSlideViews) * 100)}%` }} aria-hidden />
                <span className="shrink-0 tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No visits yet. Publish and share the link; visits to Present are not counted.</p>
        )}
      </section>
      {stats.recent_feedback.length ? (
        <section>
          <SubHeading>Latest feedback</SubHeading>
          <ul className="space-y-2">
            {stats.recent_feedback.map((f, i) => (
              <li key={i} className="text-xs">
                <span className="text-amber-500">{"★".repeat(f.rating)}</span><span className="text-muted-foreground/50">{"★".repeat(5 - f.rating)}</span>
                <span className="ml-2 text-muted-foreground">{f.at.slice(0, 16)}</span>
                {f.message ? <p className="mt-0.5">{f.message}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
