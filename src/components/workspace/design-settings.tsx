"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Stamp, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { useWorkspace } from "@/stores/workspace";
import { DECK_PALETTES, DECK_TEMPLATES, type DeckColors, type DeckDesign } from "@/lib/deck-design";
import type { DeckSettings, DeckSpec } from "@/lib/schemas/deck";
import type { BuildSummary } from "@/lib/build-types";
import { cn } from "@/lib/utils";
import { getParentBranding } from "@/components/embed/parent-bridge";
import { phpPost } from "@/lib/php-api";
import { ACTION_BTN, SubHeading, ToggleRow } from "./settings-parts";

/**
 * The design part of the Settings drawer: templates and colours, the Thank
 * You slide, footer branding and auto-play. Changes are applied without AI
 * and rebuild the preview; each one is saved as a version.
 */

type DeckView = { title: string; style: "3d" | "cinematic"; theme: DeckSpec["theme"]; colors: DeckColors; settings: DeckSettings; slideCount: number };

// In the design's order (two columns): Background, Text / 3D color 1, 3D color 2 / Accent.
const COLOR_FIELDS: [keyof DeckColors, string][] = [
  ["background", "Background"],
  ["text", "Text"],
  ["primary", "3D color 1"],
  ["secondary", "3D color 2"],
  ["accent", "Accent"],
];

/** A small picture of a template: its background, a glow in its 3D colours and the deck title. */
function TemplateArt({ colors, title }: { colors: DeckColors; title: string }) {
  return (
    <div
      aria-hidden
      className="relative flex aspect-video flex-col justify-center overflow-hidden rounded-lg px-3"
      style={{ background: `radial-gradient(70% 90% at 85% 30%, ${colors.primary}55, transparent 70%), radial-gradient(60% 70% at 10% 110%, ${colors.secondary}40, transparent 70%), ${colors.background}` }}
    >
      <span className="mb-1 text-[7px] font-bold tracking-[0.2em] uppercase" style={{ color: colors.accent }}>Presentation</span>
      <span className="line-clamp-2 max-w-[75%] text-[11px] leading-tight font-bold" style={{ color: colors.text }}>{title}</span>
    </div>
  );
}

export function useDesignSettings(projectId: string, open: boolean, onSaved: () => void) {
  const [deck, setDeck] = useState<DeckView | null>(null);
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  const [colors, setColors] = useState<DeckColors | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ deck: DeckView }>(`/api/projects/${projectId}/deck`).then(
      (r) => {
        if (!live) return;
        setError(null);
        setDeck(r.deck);
        setSettings(r.deck.settings);
        setColors(r.deck.colors);
      },
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [open, projectId]);

  async function save(key: string, body: { design?: DeckDesign; settings?: DeckSettings }, done: string) {
    setBusy(key);
    try {
      const r = await api<{ deck: DeckView; build: BuildSummary }>(`/api/projects/${projectId}/deck`, { method: "PATCH", json: body });
      // Keep unsaved edits in the other sections: refresh only what was saved.
      setDeck(r.deck);
      if (body.settings) setSettings(r.deck.settings);
      if (body.design) setColors(r.deck.colors);
      useWorkspace.getState().setBuildFromServer(r.build, null);
      onSaved();
      if (r.build.status === "succeeded") toast.success(done);
      else toast.error("Saved, but the preview could not be rebuilt.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const saveSettings = (key: string, done: string) => settings && void save(key, { settings }, done);
  const set = <K extends "thankYou" | "footer" | "autoplay">(part: K, patch: Partial<DeckSettings[K]>) => setSettings((s) => (s ? { ...s, [part]: { ...s[part], ...patch } } : s));

  return { projectId, deck, settings, colors, setColors, busy, error, save, saveSettings, set };
}

export type DesignState = ReturnType<typeof useDesignSettings>;
type Loaded = DesignState & { deck: DeckView; settings: DeckSettings; colors: DeckColors };

/** Renders `children` once the deck has loaded; until then a spinner, or the error. */
export function DesignGate({ d, children }: { d: DesignState; children: (d: Loaded) => React.ReactNode }) {
  if (d.error) return <p className="text-sm text-destructive">{d.error}</p>;
  if (!d.deck || !d.settings || !d.colors) return <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading…</p>;
  return <>{children(d as Loaded)}</>;
}

function SaveButton({ d, id, onClick, label = "Save" }: { d: DesignState; id: string; onClick: () => void; label?: string }) {
  return (
    <div className="mt-[15px] flex justify-end">
      <Button className={ACTION_BTN} disabled={d.busy !== null} onClick={onClick}>{d.busy === id && <Loader2 className="animate-spin" />} {label}</Button>
    </div>
  );
}

/**
 * The ready-made templates (look + colours). Hidden from the Settings drawer for now:
 * kept here to bring back by rendering <TemplatePicker d={d} /> in TemplateSection.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept to bring the templates back
function TemplatePicker({ d }: { d: Loaded }) {
  const { deck, busy } = d;
  return (
    <>
      <SubHeading first>Template</SubHeading>
      <div className="grid grid-cols-2 gap-3">
        {DECK_TEMPLATES.map((t) => {
          const current = deck.theme.environment === t.environment && deck.theme.font === t.font && deck.colors.accent === t.colors.accent && deck.colors.background === t.colors.background;
          return (
            <button
              key={t.id}
              disabled={busy !== null}
              aria-pressed={current}
              title={t.description}
              onClick={() => void d.save(`template:${t.id}`, { design: { environment: t.environment, font: t.font, ...t.colors } }, `“${t.name}” applied`)}
              className={cn(
                "relative flex flex-col gap-2 rounded-2xl border-[1.5px] border-border bg-card p-1.5 pb-2.5 text-left transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
                current && "border-brand shadow-[0_0_0_4px_rgb(0_136_204/0.12)]",
              )}
            >
              <TemplateArt colors={t.colors} title={deck.title} />
              <span className="flex items-center gap-1.5 px-1.5 text-sm font-semibold">
                {busy === `template:${t.id}` && <Loader2 className="size-3.5 animate-spin" />}
                {t.name}
              </span>
              <span className={cn("absolute top-3 right-3 flex size-5 items-center justify-center rounded-full border-[1.5px] border-white/80 bg-white/90", current && "border-brand bg-brand text-white")} aria-hidden>
                {current && <Check className="size-3" />}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * Colours of the presentation, as in the Figma "Colors" section: palette cards (a click applies one)
 * and custom colours with "Apply Color" (the templates are hidden: TemplatePicker).
 */
export function TemplateSection({ d }: { d: Loaded }) {
  const { colors, busy } = d;
  return (
    <>
      <SubHeading first>Color palettes</SubHeading>
      <div className="flex flex-wrap justify-center gap-[15px]">
        {DECK_PALETTES.map((p) => (
          <button
            key={p.id}
            disabled={busy !== null}
            title={`Apply “${p.name}”`}
            onClick={() => void d.save(`palette:${p.id}`, { design: p.colors }, `“${p.name}” colours applied`)}
            className="flex w-[106px] flex-col items-center gap-2.5 rounded-xl border border-black/5 bg-[#f4f8fb] p-2.5 transition hover:border-[#00a6ee]/40 hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
          >
            <span className="flex h-[21px] w-full overflow-hidden rounded-md bg-white" aria-hidden>
              {p.swatch.map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c }} />)}
            </span>
            <span className="flex items-center gap-1 text-xs leading-[1.26] font-medium text-black/60">{busy === `palette:${p.id}` && <Loader2 className="size-3 animate-spin" />}{p.name}</span>
          </button>
        ))}
      </div>

      <div className="mt-[15px] border-t border-black/10" />
      <SubHeading>Custom palettes</SubHeading>
      <div className="grid grid-cols-2 gap-x-[15px] gap-y-2.5 rounded-xl border border-black/5 bg-[#f4f8fb] p-[15px]">
        {/* Cinematic slides are photographs: only the background, text and accent colours apply. */}
        {COLOR_FIELDS.filter(([key]) => d.deck.style !== "cinematic" || (key !== "primary" && key !== "secondary")).map(([key, label]) => (
          <label key={key} className="flex h-[26px] cursor-pointer items-center justify-between gap-2 rounded-md border border-[#e5e7eb] bg-white pr-[5px] pl-2.5 text-[10px] leading-normal text-[#6b7280]" title={colors[key]}>
            {label}
            <input
              type="color"
              value={colors[key]}
              onChange={(e) => d.setColors({ ...colors, [key]: e.target.value })}
              aria-label={`${label} colour`}
              className="h-4 w-[45px] shrink-0 cursor-pointer appearance-none rounded border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
            />
          </label>
        ))}
      </div>
      <SaveButton d={d} id="colors" label="Apply Color" onClick={() => void d.save("colors", { design: colors }, "Colours applied")} />
    </>
  );
}

export function AutoplaySection({ d }: { d: Loaded }) {
  const { settings } = d;
  return (
    <>
      <ToggleRow id="design-autoplay" title="Auto-play" hint="Slides move on by themselves (no narration). Viewers can always pause with ▶ or the P key." checked={settings.autoplay.enabled} onChange={(v) => d.set("autoplay", { enabled: v })} first />
      <div className="mt-2 grid gap-1.5">
        <Label htmlFor="play-seconds">Seconds per slide</Label>
        <Input id="play-seconds" type="number" min={3} max={60} value={settings.autoplay.seconds} className="w-28" onChange={(e) => d.set("autoplay", { seconds: Number(e.target.value) })} />
      </div>
      <SaveButton d={d} id="play" onClick={() => d.saveSettings("play", "Auto-play saved")} />
    </>
  );
}

export function ThankYouSection({ d }: { d: Loaded }) {
  const { settings } = d;
  const buttons = settings.thankYou.buttons;
  return (
    <>
      <ToggleRow id="design-thanks" title="End with a Thank-you slide" hint="A closing slide with your message and call-to-action buttons." checked={settings.thankYou.enabled} onChange={(v) => d.set("thankYou", { enabled: v })} first />
      <div className={cn("grid gap-3", !settings.thankYou.enabled && "pointer-events-none opacity-50")}>
        <div className="grid gap-1.5">
          <Label htmlFor="ty-title">Heading</Label>
          <Input id="ty-title" value={settings.thankYou.title} maxLength={120} onChange={(e) => d.set("thankYou", { title: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ty-message">Message</Label>
          <Textarea id="ty-message" value={settings.thankYou.message} maxLength={400} rows={2} placeholder="e.g. Questions? Let's talk." onChange={(e) => d.set("thankYou", { message: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label>Call-to-action buttons</Label>
          {buttons.map((b, i) => (
            <div key={i} className="flex gap-2">
              <Input value={b.label} maxLength={40} placeholder="Label, e.g. Book a call" aria-label={`Button ${i + 1} label`} className="w-2/5" onChange={(e) => d.set("thankYou", { buttons: buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Input value={b.url} placeholder="https://… , mailto: or tel:" aria-label={`Button ${i + 1} link`} onChange={(e) => d.set("thankYou", { buttons: buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <Button size="icon" variant="ghost" aria-label={`Remove button ${i + 1}`} onClick={() => d.set("thankYou", { buttons: buttons.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          {buttons.length < 3 && (
            <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => d.set("thankYou", { buttons: [...buttons, { label: "", url: "https://" }] })}><Plus /> Add button</Button>
          )}
          <p className="text-xs text-muted-foreground">Up to 3 buttons. Buttons without a label or a valid link are left out.</p>
        </div>
      </div>
      <SaveButton d={d} id="thanks" onClick={() => d.saveSettings("thanks", "Thank-you slide saved")} />
    </>
  );
}

/**
 * Footer branding on every slide (PRD 27): logo, brand name and link. The logo
 * is uploaded (PHP: 3d-view/settings, action logo_upload, stored on S3) or given
 * as an https address. The workspace's whitelabel branding (sent by the PHP app)
 * fills it in one click, and is used at once when it is turned on with nothing
 * filled in yet. Save applies it to the slides.
 */
export function BrandingSection({ d }: { d: Loaded }) {
  const { settings } = d;
  const branding = getParentBranding();
  const hasBranding = !!branding && !!(branding.logo || branding.name);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);
  const logo = settings.footer.logoUrl;
  const fillFromBranding = () =>
    branding && d.set("footer", { logoUrl: branding.logo || settings.footer.logoUrl, name: branding.name || settings.footer.name, link: branding.link || settings.footer.link });
  const toggle = (on: boolean) => {
    d.set("footer", { enabled: on });
    if (on && !settings.footer.name && !settings.footer.logoUrl) fillFromBranding();
  };
  async function upload(file: File) {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.error("Upload a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("The logo is too large. Use one smaller than 2 MB.");
      return;
    }
    setUploading(true);
    try {
      const r = await phpPost<{ url: string }>("3d-view/settings", { id: d.projectId, action: "logo_upload", logo: file }, { timeoutMs: 60_000 });
      setLogoBroken(false);
      d.set("footer", { enabled: true, logoUrl: r.url });
      toast.success("Logo uploaded. Press Save to show it on the slides.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <>
      <ToggleRow id="design-brand" title="Show my branding on every slide" hint="Your logo, name and link in the slide footer." checked={settings.footer.enabled} onChange={toggle} first />
      <div className={cn("grid gap-3", !settings.footer.enabled && "pointer-events-none opacity-50")}>
        {hasBranding ? (
          <Button size="sm" variant="secondary" className="justify-self-start" onClick={fillFromBranding}>
            <Stamp /> Use my whitelabel branding
          </Button>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="brand-logo">Logo</Label>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
              {logo && !logoBroken ? (
                // eslint-disable-next-line @next/next/no-img-element -- any https logo, shown as it will appear on the slides
                <img src={logo} alt="Your logo" className="max-h-full max-w-full object-contain" onError={() => setLogoBroken(true)} />
              ) : (
                <span className="text-xs text-muted-foreground">{logo ? "Can't load" : "No logo"}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />} {logo ? "Change logo" : "Upload logo"}
              </Button>
              {logo ? (
                <Button size="sm" variant="ghost" disabled={uploading} onClick={() => d.set("footer", { logoUrl: "" })}>
                  <X /> Remove
                </Button>
              ) : null}
            </div>
          </div>
          <Input id="brand-logo" value={logo} placeholder="or paste https://…/logo.png" onChange={(e) => { setLogoBroken(false); d.set("footer", { logoUrl: e.target.value }); }} />
          <p className="text-xs text-muted-foreground">PNG, JPG or WebP up to 2 MB, or an address starting with https://.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="brand-name">Brand name</Label>
          <Input id="brand-name" value={settings.footer.name} maxLength={80} onChange={(e) => d.set("footer", { name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="brand-link">Link</Label>
          <Input id="brand-link" value={settings.footer.link} placeholder="https://your-website.com" onChange={(e) => d.set("footer", { link: e.target.value })} />
        </div>
      </div>
      <SaveButton d={d} id="brand" onClick={() => d.saveSettings("brand", "Branding saved. Publish again to show it on the public link.")} />
      <p className="text-xs text-muted-foreground">Save shows it in the preview; the public link changes when you publish again.</p>
    </>
  );
}
