"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, Search, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api-client";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { phpPost } from "@/lib/php-api";
import { cn } from "@/lib/utils";
import { SubHeading, ToggleRow } from "./settings-parts";
import { FEEDBACK_STYLES, FeedbackIcon, type FeedbackStyle } from "./feedback-style";

/**
 * The presenter part of the Settings drawer: what plays over the
 * presentation on its public link and in Present (the PHP viewer,
 * views/default/presentation3d/viewer.php): narration voice, subtitles, the
 * (talking) avatar, a welcome text, and the lead and feedback forms.
 * Q&A is kept as saved but no longer offered here. Stored by the PHP app
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
  /** Which of the lead form's fields show, and which are required (none by default). */
  lead_fields: LeadFields;
  autoresponder_id: number | null;
  list_id: string;
  feedback: boolean;
  /** The feedback form's look in the viewer (absent from an older server: stars). */
  feedback_style?: FeedbackStyle;
  /** AI summary report: viewers can download the key summary (PDF) at the end. */
  summary: boolean;
  avatar_video_status: AvatarVideoStatus;
  /** What it was made from ("ai", "url", "pdf", or "" when not recorded): a PDF has no captions (PRD 5). */
  source: string;
};
type LeadField = { show: boolean; required: boolean };
type LeadFields = { name: LeadField; email: LeadField; phone: LeadField };
/** featured: one of the recommended voices shown first (PRD 4); gender is known only for those. */
type Voice = { id: string; name: string; locale: string; gender: string; featured?: boolean; image: string; preview: string };
/** library: an avatar every workspace has (not one of this workspace's own photos). */
type Avatar = { id: number; name: string; image: string; video: string; library?: boolean };
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
        lead_fields: JSON.stringify(form.lead_fields),
        autoresponder_id: form.lead_form ? (form.autoresponder_id ?? "") : "",
        list_id: form.lead_form ? form.list_id : "",
        feedback: form.feedback,
        feedback_style: form.feedback_style ?? "stars",
        summary: form.summary,
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

/** One avatar to pick: its picture, a caption (the library's names), and a tick when chosen. */
function AvatarTile({ a, chosen, caption, onPick }: { a: Avatar; chosen: boolean; caption?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      title={a.name + (a.video ? " (video)" : "")}
      onClick={onPick}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-xl border-2 border-transparent bg-muted shadow-sm transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        chosen && "border-brand ring-2 ring-brand/25",
      )}
    >
      {a.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatar library images on the PHP app's CDN
        <img src={a.image} alt={a.name} className="size-full object-cover" loading="lazy" />
      ) : (
        <span className="flex size-full items-center justify-center text-xs text-muted-foreground">Default</span>
      )}
      {caption ? <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1 pt-3 pb-0.5 text-center text-[10px] font-medium text-white">{caption}</span> : null}
      {a.video ? <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">video</span> : null}
      {chosen ? <Check className="absolute top-1 right-1 size-4 rounded-full bg-brand p-0.5 text-brand-foreground" /> : null}
    </button>
  );
}

/** The presenter's picture: the default, this workspace's own photos (with upload / AI), then the avatar library. */
function AvatarPicker({ p }: { p: Loaded }) {
  const { form, data } = p;
  const [query, setQuery] = useState("");
  const own = data.avatars.filter((a) => !a.library);
  const library = data.avatars.filter((a) => a.library);
  const q = query.trim().toLowerCase();
  const shown = q ? library.filter((a) => a.name.toLowerCase().includes(q)) : library;
  const pick = (a: Avatar) => p.set({ avatar_id: a.id || null });
  const isChosen = (a: Avatar) => (form.avatar_id ?? 0) === a.id;
  const defaultAvatar: Avatar = { id: 0, name: "Default", image: data.default_avatar ?? "", video: "" };
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Your photos</p>
        <div className="grid grid-cols-4 gap-2 p-0.5 sm:grid-cols-5" role="radiogroup" aria-label="Your photos">
          {[defaultAvatar, ...own].map((a) => (
            <AvatarTile key={a.id} a={a} chosen={isChosen(a)} caption={a.id === 0 && a.image ? "Default" : undefined} onPick={() => pick(a)} />
          ))}
        </div>
        <NewAvatar p={p} />
      </div>
      {library.length ? (
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-muted-foreground">Avatar library <span className="font-normal">({library.length})</span></p>
            <div className="relative w-40">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" aria-label="Search the avatar library" className="h-7 pl-7 text-xs" />
            </div>
          </div>
          <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5" role="radiogroup" aria-label="Avatar library">
            {shown.map((a) => <AvatarTile key={a.id} a={a} chosen={isChosen(a)} caption={a.name} onPick={() => pick(a)} />)}
          </div>
          {!shown.length ? <p className="py-2 text-center text-xs text-muted-foreground">No avatar matches “{query.trim()}”.</p> : null}
        </div>
      ) : null}
    </div>
  );
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
  const { form, avatarStatus } = p;
  return (
    <>
      <ToggleRow id="presenter-avatar" title="Show AI presenter" hint="A presenter in the corner. A photo avatar becomes a talking video of slide 1." checked={form.avatar} onChange={(v) => p.set({ avatar: v })} first>
        <SubHeading first>Profile image</SubHeading>
        <AvatarPicker p={p} />
        {!form.narration && !form.chat ? <p className="text-xs text-amber-600 dark:text-amber-400">The presenter appears with the voice-over. Turn Voice-over on below.</p> : null}
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

function VoiceItem({ v }: { v: Voice }) {
  const details = [v.gender, v.locale].filter(Boolean).join(" · ");
  return (
    <SelectItem value={v.id}>
      {v.name}
      {details ? <span className="text-muted-foreground"> · {details}</span> : null}
    </SelectItem>
  );
}

export function VoiceSection({ p }: { p: Loaded }) {
  const { form, data } = p;
  const [bgColor, bgAlpha] = splitColor(form.subtitle_bg_color);
  return (
    <>
      {/* Viewers always get a VO button to turn the voice-over on or off (PRD 4); this only chooses
          the voice and whether it is on when the presentation opens (off by default). */}
      <div className="space-y-2 pb-3">
        <Label className="text-sm font-semibold">Voice</Label>
        <p className="text-xs text-muted-foreground">Viewers turn the voice-over on or off with the VO button. It reads each slide and moves on when it is done.</p>
        <div className="flex items-center gap-2">
          <Select value={form.voice_id} onValueChange={(v) => p.set({ voice_id: v })}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="Voice"><SelectValue placeholder="Choose a voice" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {/* The best voices first (PRD 4): male, female, then every other voice. */}
              {(["male", "female"] as const).map((g) => {
                const top = data.voices.filter((v) => v.featured && v.gender === g);
                return top.length ? (
                  <SelectGroup key={g}>
                    <SelectLabel>Recommended · {g === "male" ? "Male" : "Female"}</SelectLabel>
                    {top.map((v) => <VoiceItem key={v.id} v={v} />)}
                  </SelectGroup>
                ) : null;
              })}
              {data.voices.some((v) => v.featured) ? <SelectSeparator /> : null}
              <SelectGroup>
                {data.voices.some((v) => v.featured) ? <SelectLabel>All voices</SelectLabel> : null}
                {data.voices.filter((v) => !v.featured).map((v) => <VoiceItem key={v.id} v={v} />)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="secondary" onClick={p.playSample} disabled={!p.voice?.preview} title="Listen to this voice">
            {p.previewing ? <Pause /> : <Play />} Listen
          </Button>
        </div>
      </div>
      <ToggleRow id="presenter-narration" title="Start with the voice-over on" hint="Off: the presentation opens silent and viewers can turn the voice on." checked={form.narration} onChange={(v) => p.set({ narration: v })} />

      {form.source === "pdf" ? (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Made from a PDF: the voice reads each slide&apos;s own text, and captions are not shown.
        </p>
      ) : null}
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
      <div className="space-y-1.5 border-t border-border pt-3">
        <Label htmlFor="presenter-welcome" className="text-sm font-semibold">Welcome text</Label>
        <Textarea id="presenter-welcome" value={form.welcome_text} maxLength={WELCOME_MAX} rows={2} onChange={(e) => p.set({ welcome_text: e.target.value })} placeholder="Your presenter will walk you through every slide." />
        <p className="text-right text-xs text-muted-foreground">Shown on the start screen with the voice-over · {form.welcome_text.length}/{WELCOME_MAX}</p>
      </div>
      <SaveButton p={p} />
    </>
  );
}

const LEAD_FIELDS: { key: keyof LeadFields; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone number" },
];

/** The lead form's fields: show each or not, and make a shown one required. At least one shows. */
function LeadFieldsTable({ p }: { p: Loaded }) {
  const fields = p.form.lead_fields;
  const shown = LEAD_FIELDS.filter((f) => fields[f.key].show).length;
  const change = (key: keyof LeadFields, next: Partial<LeadField>) => {
    const field = { ...fields[key], ...next };
    if (!field.show) field.required = false;
    p.set({ lead_fields: { ...fields, [key]: field } });
  };
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid grid-cols-[1fr_64px_72px] items-center bg-muted/50 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
        <span>Field</span>
        <span className="text-center">Show</span>
        <span className="text-center">Required</span>
      </div>
      {LEAD_FIELDS.map((f) => {
        const field = fields[f.key];
        const last = field.show && shown === 1;
        return (
          <div key={f.key} className="grid grid-cols-[1fr_64px_72px] items-center border-t px-3 py-2 text-sm">
            <span className={cn(!field.show && "text-muted-foreground")}>{f.label}</span>
            <span className="flex justify-center">
              <Switch checked={field.show} disabled={last} onCheckedChange={(v) => change(f.key, { show: v })} aria-label={`Show ${f.label}`} title={last ? "The form needs at least one field" : undefined} />
            </span>
            <span className="flex justify-center">
              <input
                type="checkbox"
                className="size-4 accent-[var(--brand)] disabled:opacity-40"
                checked={field.required}
                disabled={!field.show}
                onChange={(e) => change(f.key, { required: e.target.checked })}
                aria-label={`${f.label} is required`}
              />
            </span>
          </div>
        );
      })}
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">No field is required unless you tick it; visitors fill in at least one.</p>
    </div>
  );
}

/** `slideCount`: the deck's slides, once loaded; the form can show after any of them (else 1-15). */
export function LeadSection({ p, slideCount }: { p: Loaded; slideCount?: number }) {
  const { form, data, lists, listsLoading } = p;
  const afterOptions = Array.from({ length: slideCount || 15 }, (_, i) => i + 1);
  // A saved slide the deck no longer has (it got shorter) stays listed, so the field is not blank.
  if (!afterOptions.includes(form.lead_after_slide)) afterOptions.push(form.lead_after_slide);
  return (
    <>
      <ToggleRow id="presenter-lead" title="Built-in lead form" hint="Asks each visitor once for their details. Leads appear on your Leads page and in the CRM." checked={form.lead_form} onChange={(v) => p.set({ lead_form: v })} first>
        <SubHeading first>Form fields</SubHeading>
        <LeadFieldsTable p={p} />
        <SubHeading>When to show</SubHeading>
        <div className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-xs">After slide</span>
          <Select value={String(form.lead_after_slide)} onValueChange={(v) => p.set({ lead_after_slide: Number(v) })}>
            <SelectTrigger className="w-24" aria-label="Show the lead form after slide"><SelectValue /></SelectTrigger>
            <SelectContent>
              {afterOptions.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
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

export function SummarySection({ p }: { p: Loaded }) {
  return (
    <>
      <ToggleRow
        id="presenter-summary"
        title="Offer the AI summary report"
        hint="At the end, viewers can download the key points of the presentation, written by AI, as a PDF."
        checked={p.form.summary}
        onChange={(v) => p.set({ summary: v })}
        first
      />
      <p className="mt-3 text-xs text-muted-foreground">Your own report (the summary plus views, leads, ratings and what visitors asked) is in the presentation list&apos;s menu: AI report (PDF).</p>
      <SaveButton p={p} />
    </>
  );
}

export function FeedbackSection({ p }: { p: Loaded }) {
  return (
    <>
      <ToggleRow id="presenter-feedback" title="Ask for feedback" hint="At the end, asks each visitor once for a 1-5 rating and a comment." checked={p.form.feedback} onChange={(v) => p.set({ feedback: v })} first />
      <div className={cn("grid gap-2", !p.form.feedback && "pointer-events-none opacity-50")}>
        <SubHeading>Rating style</SubHeading>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rating style">
          {FEEDBACK_STYLES.map((s) => {
            const on = (p.form.feedback_style ?? "stars") === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => p.set({ feedback_style: s.id })}
                className={cn(
                  "grid gap-1.5 rounded-lg border p-2 text-left transition-colors",
                  on ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/50",
                )}
              >
                <span className="flex gap-1">
                  {([1, 3, 5] as const).map((lv) => (
                    <span key={lv} className="flex size-8 items-center justify-center rounded-md bg-sky-100">
                      <FeedbackIcon style={s.id} level={lv} className="size-6" />
                    </span>
                  ))}
                </span>
                <span className="flex items-center gap-1 text-xs font-semibold">{on ? <Check className="size-3.5 text-primary" /> : null}{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <SaveButton p={p} />
    </>
  );
}
