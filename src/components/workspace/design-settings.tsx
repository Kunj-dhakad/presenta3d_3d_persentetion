"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Palette, Play, Plus, Sparkles, Stamp, Trash2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api-client";
import { useWorkspace } from "@/stores/workspace";
import { DECK_PALETTES, DECK_TEMPLATES, type DeckColors, type DeckDesign } from "@/lib/deck-design";
import type { DeckSettings, DeckSpec } from "@/lib/schemas/deck";
import type { BuildSummary } from "@/lib/build-types";
import { getParentBranding } from "@/components/embed/parent-bridge";
import { cn } from "@/lib/utils";

type DeckView = { title: string; theme: DeckSpec["theme"]; colors: DeckColors; settings: DeckSettings; slideCount: number };

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

/**
 * The Design panel: templates and colours, the Thank You slide, footer
 * branding and auto-play. Changes are applied without AI and rebuild the
 * preview; each one is saved as a version.
 */
export function DesignDialog({ projectId, open, onOpenChange, onSaved }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [deck, setDeck] = useState<DeckView | null>(null);
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  const [colors, setColors] = useState<DeckColors | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = (d: DeckView) => {
    setDeck(d);
    setSettings(d.settings);
    setColors(d.colors);
  };

  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ deck: DeckView }>(`/api/projects/${projectId}/deck`).then(
      (r) => {
        if (!live) return;
        setError(null);
        show(r.deck);
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
      // Keep unsaved edits on the other tabs: refresh only what was saved.
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
  const branding = getParentBranding();
  const busyIcon = (key: string, icon: React.ReactNode) => (busy === key ? <Loader2 className="animate-spin" /> : icon);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] w-[calc(100vw-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Design</DialogTitle>
          <DialogDescription>Change the look and the closing slide. Every change rebuilds the preview and can be undone from the version history.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !deck || !settings || !colors ? (
          <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading…</p>
        ) : (
          <Tabs defaultValue="templates" className="min-h-0 min-w-0">
            <TabsList className="w-full">
              <TabsTrigger value="templates"><Sparkles /> Templates</TabsTrigger>
              <TabsTrigger value="colors"><Palette /> Colours</TabsTrigger>
              <TabsTrigger value="thanks"><Trophy /> Thank you</TabsTrigger>
              <TabsTrigger value="brand"><Stamp /> Branding</TabsTrigger>
              <TabsTrigger value="play"><Play /> Auto-play</TabsTrigger>
            </TabsList>

            <TabsContent value="templates" className="mt-3 grid max-h-[calc(100dvh-14rem)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              {DECK_TEMPLATES.map((t) => {
                const current = deck.theme.environment === t.environment && deck.theme.font === t.font && deck.colors.accent === t.colors.accent && deck.colors.background === t.colors.background;
                return (
                  <button
                    key={t.id}
                    disabled={busy !== null}
                    onClick={() => void save(`template:${t.id}`, { design: { environment: t.environment, font: t.font, ...t.colors } }, `“${t.name}” applied`)}
                    className={cn("flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition hover:border-brand/60 disabled:opacity-60", current && "border-brand")}
                  >
                    <Swatches colors={t.colors} className="h-8" />
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {busy === `template:${t.id}` ? <Loader2 className="size-3.5 animate-spin" /> : current && <Check className="size-3.5 text-brand" />}
                      {t.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.description}</span>
                  </button>
                );
              })}
            </TabsContent>

            <TabsContent value="colors" className="mt-3 grid max-h-[calc(100dvh-14rem)] gap-4 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DECK_PALETTES.map((p) => (
                  <button key={p.id} disabled={busy !== null} onClick={() => void save(`palette:${p.id}`, { design: p.colors }, `“${p.name}” colours applied`)} className="flex flex-col gap-1.5 rounded-lg border border-border p-2 text-left text-xs transition hover:border-brand/60 disabled:opacity-60">
                    <Swatches colors={p.colors} className="h-6" />
                    <span className="flex items-center gap-1">{busy === `palette:${p.id}` && <Loader2 className="size-3 animate-spin" />}{p.name}</span>
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">Custom colours</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {COLOR_FIELDS.map(([key, label]) => (
                    <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {label}
                      <span className="flex items-center gap-2">
                        <input type="color" value={colors[key]} onChange={(e) => setColors({ ...colors, [key]: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" />
                        <code className="text-[11px]">{colors[key]}</code>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" disabled={busy !== null} onClick={() => void save("colors", { design: colors }, "Colours applied")}>{busyIcon("colors", <Check />)} Apply colours</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="thanks" className="mt-3 grid max-h-[calc(100dvh-14rem)] gap-3 overflow-y-auto pr-1">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                End with a Thank You slide
                <Switch checked={settings.thankYou.enabled} onCheckedChange={(v) => set("thankYou", { enabled: v })} />
              </label>
              <div className={cn("grid gap-3", !settings.thankYou.enabled && "pointer-events-none opacity-50")}>
                <div className="grid gap-1.5">
                  <Label htmlFor="ty-title">Title</Label>
                  <Input id="ty-title" value={settings.thankYou.title} maxLength={120} onChange={(e) => set("thankYou", { title: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ty-message">Message</Label>
                  <Textarea id="ty-message" value={settings.thankYou.message} maxLength={400} rows={2} placeholder="e.g. Questions? Let's talk." onChange={(e) => set("thankYou", { message: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label>Buttons</Label>
                  {settings.thankYou.buttons.map((b, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={b.label} maxLength={40} placeholder="Label, e.g. Book a call" aria-label={`Button ${i + 1} label`} className="w-2/5" onChange={(e) => set("thankYou", { buttons: settings.thankYou.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                      <Input value={b.url} placeholder="https://… , mailto: or tel:" aria-label={`Button ${i + 1} link`} onChange={(e) => set("thankYou", { buttons: settings.thankYou.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                      <Button size="icon" variant="ghost" aria-label={`Remove button ${i + 1}`} onClick={() => set("thankYou", { buttons: settings.thankYou.buttons.filter((_, j) => j !== i) })}><Trash2 /></Button>
                    </div>
                  ))}
                  {settings.thankYou.buttons.length < 3 && (
                    <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => set("thankYou", { buttons: [...settings.thankYou.buttons, { label: "", url: "https://" }] })}><Plus /> Add button</Button>
                  )}
                  <p className="text-xs text-muted-foreground">Up to 3 buttons. Buttons without a label or a valid link are left out.</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={busy !== null} onClick={() => saveSettings("thanks", "Thank You slide saved")}>{busyIcon("thanks", <Check />)} Save</Button>
              </div>
            </TabsContent>

            <TabsContent value="brand" className="mt-3 grid max-h-[calc(100dvh-14rem)] gap-3 overflow-y-auto pr-1">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                Show my branding on every slide
                <Switch checked={settings.footer.enabled} onCheckedChange={(v) => set("footer", { enabled: v })} />
              </label>
              <div className={cn("grid gap-3", !settings.footer.enabled && "pointer-events-none opacity-50")}>
                {branding && (branding.logo || branding.name) && (
                  <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => set("footer", { logoUrl: branding.logo, name: branding.name, link: branding.link })}>
                    <Stamp /> Use my whitelabel branding
                  </Button>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="brand-logo">Logo URL</Label>
                  <Input id="brand-logo" value={settings.footer.logoUrl} placeholder="https://…/logo.png" onChange={(e) => set("footer", { logoUrl: e.target.value })} />
                  <p className="text-xs text-muted-foreground">Must start with https://.</p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="brand-name">Brand name</Label>
                  <Input id="brand-name" value={settings.footer.name} maxLength={80} onChange={(e) => set("footer", { name: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="brand-link">Link</Label>
                  <Input id="brand-link" value={settings.footer.link} placeholder="https://your-website.com" onChange={(e) => set("footer", { link: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={busy !== null} onClick={() => saveSettings("brand", "Branding saved")}>{busyIcon("brand", <Check />)} Save</Button>
              </div>
            </TabsContent>

            <TabsContent value="play" className="mt-3 grid max-h-[calc(100dvh-14rem)] gap-3 overflow-y-auto pr-1">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <span>
                  Start playing automatically
                  <span className="block text-xs text-muted-foreground">Slides move on by themselves (no narration). Viewers can always pause with ▶ or the P key.</span>
                </span>
                <Switch checked={settings.autoplay.enabled} onCheckedChange={(v) => set("autoplay", { enabled: v })} />
              </label>
              <div className="grid gap-1.5">
                <Label htmlFor="play-seconds">Seconds per slide</Label>
                <Input id="play-seconds" type="number" min={3} max={60} value={settings.autoplay.seconds} className="w-28" onChange={(e) => set("autoplay", { seconds: Number(e.target.value) })} />
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={busy !== null} onClick={() => saveSettings("play", "Auto-play saved")}>{busyIcon("play", <Check />)} Save</Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
