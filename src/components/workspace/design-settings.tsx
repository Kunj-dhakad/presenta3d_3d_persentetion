"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
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
import { SubHeading, ToggleRow } from "./settings-parts";

/**
 * The design part of the Settings drawer: templates and colours, the Thank
 * You slide, footer branding and auto-play. Changes are applied without AI
 * and rebuild the preview; each one is saved as a version.
 */

type DeckView = { title: string; style: "3d" | "cinematic"; theme: DeckSpec["theme"]; colors: DeckColors; settings: DeckSettings; slideCount: number };

const COLOR_FIELDS: [keyof DeckColors, string][] = [
  ["background", "Background"],
  ["text", "Text"],
  ["accent", "Accent"],
  ["primary", "3D colour 1"],
  ["secondary", "3D colour 2"],
];

function Swatches({ colors, className }: { colors: DeckColors; className?: string }) {
  return (
    <div className={cn("flex overflow-hidden rounded-md border border-border", className)} aria-hidden>
      {[colors.background, colors.accent, colors.primary, colors.secondary, colors.text].map((c, i) => (
        <span key={i} className="h-full flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}

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
  const set = <K extends keyof DeckSettings>(part: K, patch: Partial<DeckSettings[K]>) => setSettings((s) => (s ? { ...s, [part]: { ...s[part], ...patch } } : s));

  return { deck, settings, colors, setColors, busy, error, save, saveSettings, set };
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
    <div className="mt-4 flex justify-end">
      <Button size="sm" disabled={d.busy !== null} onClick={onClick}>{d.busy === id ? <Loader2 className="animate-spin" /> : <Check />} {label}</Button>
    </div>
  );
}

export function TemplateSection({ d }: { d: Loaded }) {
  const { deck, colors, busy } = d;
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

      <SubHeading>Colour palettes</SubHeading>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DECK_PALETTES.map((p) => (
          <button key={p.id} disabled={busy !== null} onClick={() => void d.save(`palette:${p.id}`, { design: p.colors }, `“${p.name}” colours applied`)} className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-2 text-left text-xs transition hover:border-brand/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60">
            <Swatches colors={p.colors} className="h-6" />
            <span className="flex items-center gap-1">{busy === `palette:${p.id}` && <Loader2 className="size-3 animate-spin" />}{p.name}</span>
          </button>
        ))}
      </div>

      <SubHeading>Custom colours</SubHeading>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {COLOR_FIELDS.map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {d.deck.style === "cinematic" ? label.replace("3D colour", "Glow colour") : label}
            <span className="flex items-center gap-1.5">
              <input type="color" value={colors[key]} onChange={(e) => d.setColors({ ...colors, [key]: e.target.value })} className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent" />
              <code className="truncate text-[10.5px]">{colors[key]}</code>
            </span>
          </label>
        ))}
      </div>
      <SaveButton d={d} id="colors" label="Apply colours" onClick={() => void d.save("colors", { design: colors }, "Colours applied")} />
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
