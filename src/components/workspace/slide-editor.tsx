"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, ImageUp, Info, Loader2, Plus, RotateCcw, SquarePen, Trash2, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import type { BuildSummary } from "@/lib/build-types";
import { useWorkspace } from "@/stores/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ACTION_BTN, SubHeading } from "./settings-parts";

/**
 * The Slide content panel (the v8 editor's), kept simple: one slide's words (small heading, title, subtitle,
 * bullets) and narration changed by hand, and on a cinematic slide the presenter's own picture. A slide's
 * layout and big numbers are not offered here (they stay as they are; the chat changes them). It follows the preview (the slide shown is the
 * slide edited) and its arrows move the preview. Save rebuilds the presentation and keeps a version
 * (api/projects/[id]/slides); unsaved words are saved before moving to another slide. Success shows in the
 * panel itself (the foot says Saved, the picture is marked), not in toasts: they would cover the Save button.
 */

type Layout = "hero" | "left" | "right" | "center" | "stats";
type Stat = { value: string; label: string };
type SlideView = { layout: Layout; kicker: string; title: string; subtitle: string; bullets: string[]; stats: Stat[]; notes: string; image: string; ownImage: boolean };
type SlidesView = { style: "3d" | "cinematic"; thankYou: boolean; slides: SlideView[] };
type Saved = SlidesView & { build: BuildSummary | null };
type Draft = Pick<SlideView, "layout" | "kicker" | "title" | "subtitle" | "bullets" | "stats" | "notes">;

const MAX_BULLETS = 5;
const MAX_IMAGE_MB = 5;

const draftOf = (s: SlideView): Draft => ({ layout: s.layout, kicker: s.kicker, title: s.title, subtitle: s.subtitle, bullets: [...s.bullets], stats: s.stats.map((x) => ({ ...x })), notes: s.notes });
const same = (a: Draft | null, b: Draft | null) => JSON.stringify(a) === JSON.stringify(b);

export function SlideEditor({ projectId, open, onClose, disabled, onOpenSettings, className }: { projectId: string; open: boolean; onClose: () => void; disabled: boolean; onOpenSettings: () => void; className?: string }) {
  const previewSlide = useWorkspace((s) => s.previewSlide);
  const [data, setData] = useState<SlidesView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [base, setBase] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [picture, setPicture] = useState<"" | "upload" | "ai">("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = Boolean(draft && base && !same(draft, base));
  const total = data?.slides.length ?? 0;
  const onThankYou = Boolean(data && index >= total);
  const slide = data && !onThankYou ? data.slides[index] : null;

  // The slide's words into the form (on opening, on moving, after a save).
  const showSlide = useCallback((view: SlidesView, i: number) => {
    const s = view.slides[i];
    const d = s ? draftOf(s) : null;
    setDraft(d);
    setBase(d);
  }, []);

  // While open, the preview does not play by itself (preview-pane.tsx).
  useEffect(() => {
    useWorkspace.getState().setSlideEditing(open);
    return () => useWorkspace.getState().setSlideEditing(false);
  }, [open]);

  // The slides, read when the panel opens (and again on "Try again"), on the slide the preview shows.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open || disabled) return;
    let live = true;
    api<SlidesView>(`/api/projects/${projectId}/slides`).then(
      (view) => {
        if (!live) return;
        const i = Math.max(0, useWorkspace.getState().previewSlide - 1);
        setLoadError(null);
        setData(view);
        setIndex(i);
        showSlide(view, i);
      },
      (e) => live && setLoadError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [open, disabled, projectId, reload, showSlide]);

  // The panel follows the preview, unless there are unsaved words (they would be lost).
  const [shownPreview, setShownPreview] = useState(previewSlide);
  if (shownPreview !== previewSlide) {
    setShownPreview(previewSlide);
    if (data && !dirty && !saving && previewSlide - 1 !== index) {
      setIndex(previewSlide - 1);
      showSlide(data, previewSlide - 1);
    }
  }

  // A save's answer: the slides as saved, and the rebuilt preview (it reopens on the same slide).
  const applySaved = useCallback((r: Saved) => {
    setData({ style: r.style, thankYou: r.thankYou, slides: r.slides });
    if (r.build) useWorkspace.getState().setBuildFromServer(r.build, null);
  }, []);

  /** Save the words; true when saved (or nothing to save). */
  const save = useCallback(async (): Promise<boolean> => {
    if (!draft || !dirty) return true;
    if (!draft.title.trim()) {
      toast.error("Give the slide a title.");
      return false;
    }
    setSaving(true);
    try {
      const r = await api<Saved>(`/api/projects/${projectId}/slides`, { method: "PATCH", json: { index, slide: draft } });
      applySaved(r);
      showSlide(r, index);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, dirty, projectId, index, applySaved, showSlide]);

  async function move(to: number) {
    if (!data || to < 0 || to > total - (data.thankYou ? 0 : 1) || saving) return;
    if (!(await save())) return;
    setIndex(to);
    showSlide(data, to);
    useWorkspace.getState().gotoSlide(to + 1);
  }

  async function close() {
    if (dirty && !(await save())) return;
    onClose();
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.error("Upload a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast.error(`The picture is too large. Use one under ${MAX_IMAGE_MB} MB.`);
      return;
    }
    setPicture("upload");
    try {
      const r = await api<Saved>(`/api/projects/${projectId}/slides/image?index=${index}`, { method: "POST", body: file, headers: { "Content-Type": file.type } });
      applySaved(r);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPicture("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function backToAi() {
    setPicture("ai");
    try {
      const r = await api<Saved>(`/api/projects/${projectId}/slides/image?index=${index}`, { method: "DELETE" });
      applySaved(r);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPicture("");
    }
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const busy = saving || picture !== "";
  const last = total - (data?.thankYou ? 0 : 1);

  return (
    <aside className={cn("flex h-full min-h-0 flex-col bg-white", className)} aria-label="Slide content" onKeyDown={(e) => { if (e.key === "Escape") void close(); }}>
      {/* Head: the slide edited, its arrows, close */}
      <div className="flex shrink-0 items-center gap-3 border-b border-black/10 px-4 py-3.5">
        <span className="flex size-[35px] shrink-0 items-center justify-center rounded-[7px] bg-[linear-gradient(180deg,rgb(0_166_238/0.1),rgb(1_201_251/0.1))] text-[#0088cc]">
          <SquarePen className="size-[17px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] leading-tight font-semibold text-black">Slide content</h2>
          <p className="truncate text-xs text-black/55">
            {!data ? "Loading…" : onThankYou ? `Thank-you slide (after slide ${total})` : `Slide ${index + 1} of ${total}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="size-8 rounded-lg" aria-label="Previous slide" title="Previous slide" disabled={!data || index <= 0 || busy} onClick={() => void move(index - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="icon" variant="outline" className="size-8 rounded-lg" aria-label="Next slide" title="Next slide" disabled={!data || index >= last || busy} onClick={() => void move(index + 1)}>
            <ChevronRight className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" className="ml-1 size-8 rounded-lg" aria-label="Close" title="Close" onClick={() => void close()}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 thin-scroll">
        {disabled ? (
          <Note>Available when the presentation has finished generating.</Note>
        ) : loadError ? (
          <div className="grid gap-3">
            <Note tone="error">{loadError}</Note>
            <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => setReload((n) => n + 1)}><RotateCcw /> Try again</Button>
          </div>
        ) : !data ? (
          <div className="flex items-center gap-2 py-6 text-sm text-black/55"><Loader2 className="size-4 animate-spin" /> Loading the slides…</div>
        ) : onThankYou ? (
          <div className="grid gap-3">
            <Note>This is the Thank-you slide the presentation ends with. Change its heading, message and buttons in Settings.</Note>
            <Button size="sm" variant="secondary" className="justify-self-start" onClick={onOpenSettings}>Open Thank-you settings</Button>
          </div>
        ) : draft && slide ? (
          <div className="grid gap-5">
            {/* Picture (cinematic) */}
            {data.style === "cinematic" && (
              <section>
                <SubHeading first>Picture</SubHeading>
                <div className="grid gap-2.5">
                  <div className="relative aspect-video overflow-hidden rounded-xl border border-black/10 bg-[#0b0d14]">
                    {slide.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slide.image} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-white/60">No picture yet</div>
                    )}
                    {slide.ownImage && <span className="absolute top-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-black/75">Your picture</span>}
                    {picture && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-xs font-medium text-white">
                        <Loader2 className="size-5 animate-spin" /> {picture === "upload" ? "Uploading…" : "Making the AI picture…"}
                      </div>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}><ImageUp /> {slide.ownImage ? "Upload another" : "Upload picture"}</Button>
                    {slide.ownImage && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void backToAi()}><RotateCcw /> Back to AI picture</Button>}
                  </div>
                  <p className="text-xs text-black/55">PNG, JPG or WebP, up to {MAX_IMAGE_MB} MB; 16:9 (e.g. 1920×1080) fits best. Your picture stays when you edit with the AI.</p>
                </div>
              </section>
            )}

            {/* Text */}
            <section className="grid gap-3">
              <SubHeading first>Text</SubHeading>
              <Field id="se-kicker" label="Small heading" hint="Optional, e.g. CHAPTER 02">
                <Input id="se-kicker" value={draft.kicker} maxLength={60} onChange={(e) => set({ kicker: e.target.value })} />
              </Field>
              <Field id="se-title" label="Title">
                <Textarea id="se-title" value={draft.title} maxLength={160} rows={2} onChange={(e) => set({ title: e.target.value })} aria-invalid={!draft.title.trim()} aria-describedby={draft.title.trim() ? undefined : "se-title-err"} />
                {/* Said here, not in a toast (a toast would cover the Save button). */}
                {!draft.title.trim() && <p id="se-title-err" className="text-xs text-red-600">Give the slide a title.</p>}
              </Field>
              <Field id="se-subtitle" label="Subtitle" hint="Optional">
                <Textarea id="se-subtitle" value={draft.subtitle} maxLength={400} rows={2} onChange={(e) => set({ subtitle: e.target.value })} />
              </Field>
            </section>

            {/* Bullets (a slide's big numbers, if it has any, stay as they are) */}
            <section className="grid gap-2">
                <SubHeading first>Bullets</SubHeading>
                {draft.bullets.map((b, i) => (
                  <div key={i} className="flex gap-2">
                    <Input value={b} maxLength={200} aria-label={`Bullet ${i + 1}`} onChange={(e) => set({ bullets: draft.bullets.map((y, j) => (j === i ? e.target.value : y)) })} />
                    <Button size="icon" variant="ghost" aria-label={`Remove bullet ${i + 1}`} onClick={() => set({ bullets: draft.bullets.filter((_, j) => j !== i) })}><Trash2 /></Button>
                  </div>
                ))}
                {draft.bullets.length < MAX_BULLETS ? (
                  <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => set({ bullets: [...draft.bullets, ""] })}><Plus /> Add bullet</Button>
                ) : (
                  <p className="text-xs text-black/55">Up to {MAX_BULLETS} bullets.</p>
                )}
            </section>

            {/* Narration */}
            <section className="grid gap-1.5">
              <SubHeading first>Narration</SubHeading>
              <Textarea id="se-notes" value={draft.notes} maxLength={2000} rows={4} aria-label="Narration" placeholder="What the presenter says on this slide" onChange={(e) => set({ notes: e.target.value })} />
              <p className="text-xs text-black/55">Read aloud with captions when the voice-over is on.</p>
            </section>
          </div>
        ) : null}
      </div>

      {/* Foot: what is saved, Save */}
      {data && slide && !disabled && (
        <div className="flex shrink-0 items-center gap-3 border-t border-black/10 bg-[#f9fbfc] px-4 py-3">
          <span className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-xs", dirty ? "text-amber-700" : "text-black/55")}>
            {saving ? <><Loader2 className="size-3.5 animate-spin" /> Saving and rebuilding…</> : dirty ? (draft?.title.trim() ? "Unsaved changes" : "Add a title to save") : <><Check className="size-3.5 text-[#16a34a]" /> Saved</>}
          </span>
          <Button className={cn(ACTION_BTN, "h-9")} disabled={!dirty || busy || !draft?.title.trim()} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save
          </Button>
        </div>
      )}
    </aside>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <span className="text-[11px] text-black/45">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px]", tone === "error" ? "bg-red-50 text-red-700" : "bg-brand-soft text-foreground/80")}>
      <Info className={cn("mt-0.5 size-3.5 shrink-0", tone === "error" ? "text-red-600" : "text-brand")} /> {children}
    </p>
  );
}
