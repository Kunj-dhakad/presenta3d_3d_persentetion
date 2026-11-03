"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MessageCircleQuestion, Mic, Pause, Play, Subtitles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { phpPost } from "@/lib/php-api";
import { cn } from "@/lib/utils";

/**
 * The Presenter panel: what plays over the presentation on its public link
 * and in Present (the PHP viewer, views/default/presentation3d/viewer.php):
 * narration voice, subtitles, the avatar, visitors' Q&A and a welcome text.
 * Stored by the PHP app (3d-view/settings, Presentation3d_view_controller)
 * and applied at once, without rebuilding or republishing the deck.
 */

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
};
type Voice = { id: string; name: string; locale: string; gender: string; image: string; preview: string };
type Avatar = { id: number; name: string; image: string; video: string };
type SettingsResponse = { settings: PresenterSettings; voices: Voice[]; avatars: Avatar[] };

const WELCOME_MAX = 300;

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

function Row({ icon, title, hint, checked, onChange, children }: { icon: React.ReactNode; title: string; hint: string; checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode }) {
  const id = `presenter-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-brand">{icon}</span>
        <div className="min-w-0 flex-1">
          <Label htmlFor={id} className="text-sm font-medium">{title}</Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      {checked && children ? <div className="mt-3 space-y-3 pl-8">{children}</div> : null}
    </section>
  );
}

export function PresenterDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [form, setForm] = useState<PresenterSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const sample = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    phpPost<SettingsResponse>("3d-view/settings", { id: projectId }).then(
      (r) => {
        if (!live) return;
        setError(null);
        setData(r);
        setForm(r.settings);
      },
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
      sample.current?.pause();
      setPreviewing(false);
    };
  }, [open, projectId]);

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

  async function save() {
    if (!form) return;
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
      });
      setForm(r.settings);
      toast.success(r.message || "Presenter settings saved.");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const [bgColor, bgAlpha] = splitColor(form?.subtitle_bg_color ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] w-[calc(100vw-2rem)] max-w-xl max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Presenter</DialogTitle>
          <DialogDescription>Narration, subtitles, an avatar and Q&amp;A over your presentation, on its public link and in Present. Changes apply at once; no need to publish again.</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !form || !data ? (
          <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading…</p>
        ) : (
          <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
            <Row icon={<Mic className="size-4" />} title="Narration" hint="A voice reads each slide and moves on when it is done." checked={form.narration} onChange={(v) => set({ narration: v })}>
              <div className="flex items-center gap-2">
                <Select value={form.voice_id} onValueChange={(v) => set({ voice_id: v })}>
                  <SelectTrigger className="min-w-0 flex-1" aria-label="Voice"><SelectValue placeholder="Choose a voice" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {data.voices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.name} <span className="text-muted-foreground">· {v.gender}{v.locale ? ` · ${v.locale}` : ""}</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="secondary" onClick={playSample} disabled={!voice?.preview} title="Listen to this voice">
                  {previewing ? <Pause /> : <Play />} Listen
                </Button>
              </div>
            </Row>

            <Row icon={<Subtitles className="size-4" />} title="Subtitles" hint="The narration as text, each word lit as it is said." checked={form.subtitles} onChange={(v) => set({ subtitles: v })}>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <input type="color" value={splitColor(form.subtitle_text_color)[0]} onChange={(e) => set({ subtitle_text_color: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent" aria-label="Text colour" />
                  Text
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="color" value={bgColor} onChange={(e) => set({ subtitle_bg_color: joinColor(e.target.value, bgAlpha) })} className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent" aria-label="Background colour" />
                  Background
                </label>
                <div className="flex min-w-40 flex-1 items-center gap-2 text-xs">
                  <span className="shrink-0">Opacity</span>
                  <Slider value={[bgAlpha]} min={0} max={100} step={5} onValueChange={([a]) => set({ subtitle_bg_color: joinColor(bgColor, a) })} aria-label="Background opacity" />
                  <span className="w-9 shrink-0 text-right tabular-nums">{bgAlpha}%</span>
                </div>
              </div>
              <div className="rounded-md p-3 text-center" style={{ backgroundColor: "#111827" }}>
                <span className="rounded px-2 py-1 text-sm font-semibold" style={{ color: form.subtitle_text_color, background: form.subtitle_bg_color }}>Your subtitles look like this</span>
              </div>
            </Row>

            <Row icon={<UserRound className="size-4" />} title="Avatar" hint="A presenter in the corner who speaks with the narration." checked={form.avatar} onChange={(v) => set({ avatar: v })}>
              <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5" role="radiogroup" aria-label="Avatar">
                {[{ id: 0, name: "Default", image: "", video: "" } as Avatar, ...data.avatars].map((a) => {
                  const chosen = (form.avatar_id ?? 0) === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      title={a.name + (a.video ? " (video)" : "")}
                      onClick={() => set({ avatar_id: a.id || null })}
                      className={cn("relative aspect-square overflow-hidden rounded-lg border-2 border-transparent bg-muted transition hover:border-brand/50", chosen && "border-brand")}
                    >
                      {a.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- avatar library images on the PHP app's CDN
                        <img src={a.image} alt={a.name} className="size-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-xs text-muted-foreground">Default</span>
                      )}
                      {a.video ? <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white">video</span> : null}
                      {chosen ? <Check className="absolute right-1 top-1 size-4 rounded-full bg-brand p-0.5 text-brand-foreground" /> : null}
                    </button>
                  );
                })}
              </div>
              {data.avatars.length === 0 ? <p className="text-xs text-muted-foreground">No avatars in your library yet; the default presenter is used.</p> : null}
            </Row>

            <Row icon={<MessageCircleQuestion className="size-4" />} title="Q&A" hint="Viewers ask questions; answers come from this presentation's content." checked={form.chat} onChange={(v) => set({ chat: v })} />

            <section className="space-y-1.5 rounded-lg border border-border p-3">
              <Label htmlFor="presenter-welcome" className="text-sm font-medium">Welcome text</Label>
              <Textarea id="presenter-welcome" value={form.welcome_text} maxLength={WELCOME_MAX} rows={2} onChange={(e) => set({ welcome_text: e.target.value })} placeholder="Your presenter will walk you through every slide. Ask questions any time." />
              <p className="text-right text-xs text-muted-foreground">{form.welcome_text.length}/{WELCOME_MAX}</p>
            </section>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!form || saving}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
