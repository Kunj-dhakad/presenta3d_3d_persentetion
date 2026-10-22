"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Boxes, Image as ImageIcon, Film, Mic, Volume2, Box, Palette, Loader2, Plus, Sparkles } from "lucide-react";
import { api, errorMessage, timeAgo } from "@/lib/api-client";
import { MEDIA_KINDS, MEDIA_LABELS, type MediaKind, type MediaProviderInfo } from "@/lib/media";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectThumb } from "@/components/projects/project-thumb";
import { MediaGenerator } from "./media-generator";
import { useLocalPref } from "@/lib/use-local-pref";

const KIND_ICON: Record<MediaKind, typeof ImageIcon> = { image: ImageIcon, video: Film, audio: Mic, sfx: Volume2, model3d: Box, material: Palette };
type Template = { id: string; name: string; description: string };
type SceneRow = { id: string; name: string; updatedAt: string; category: string };
type Providers = Record<MediaKind, (MediaProviderInfo & { availableForKind: boolean })[]>;

export function StudioHome() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [scenes, setScenes] = useState<SceneRow[] | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useLocalPref("strata.studio.tab", "scenes", ["scenes", ...MEDIA_KINDS] as const);

  useEffect(() => {
    api<{ scenes: Template[] }>("/api/examples").then((r) => setTemplates(r.scenes), () => setTemplates([]));
    api<{ scenes: SceneRow[] }>("/api/scenes").then((r) => setScenes(r.scenes), () => setScenes([]));
    api<{ providers: Providers }>("/api/media/providers").then((r) => setProviders(r.providers), (e) => toast.error(errorMessage(e)));
  }, []);

  async function create(template?: string) {
    setBusy(template ?? "blank");
    try {
      const r = await api<{ scene: { id: string } }>("/api/scenes", { method: "POST", json: template ? { template } : { name: "Untitled scene" } });
      router.push(`/studio/scene/${r.scene.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
        <p className="text-sm text-muted-foreground">Build interactive 3D scenes and generate creative assets.</p>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          className="mt-6"
        >
          <TabsList className="flex h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="scenes"><Boxes /> 3D scenes</TabsTrigger>
            {MEDIA_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return <TabsTrigger key={k} value={k}><Icon /> {MEDIA_LABELS[k]}</TabsTrigger>;
            })}
          </TabsList>

          <TabsContent value="scenes" className="mt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium">Your scenes</h2>
                <p className="text-xs text-muted-foreground">Declarative scenes you can edit visually, animate, play and export to code.</p>
              </div>
              <Button onClick={() => void create()} disabled={busy !== null}>{busy === "blank" ? <Loader2 className="animate-spin" /> : <Plus />} Empty scene</Button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {scenes === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
              {scenes?.length === 0 && <p className="col-span-full rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No scenes yet. Start from a template below or create an empty scene and use the AI 3D specialist.</p>}
              {scenes?.map((s) => (
                <button key={s.id} onClick={() => router.push(`/studio/scene/${s.id}`)} className="overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-brand/40">
                  <ProjectThumb category="scene3d" name={s.name} seed={s.id} />
                  <span className="block px-3 py-2 text-xs text-muted-foreground">Edited {timeAgo(s.updatedAt)}</span>
                </button>
              ))}
            </div>
            <h2 className="mt-10 text-sm font-medium">Templates</h2>
            <p className="text-xs text-muted-foreground">Complete, working scenes. Each opens as your own editable copy.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {templates === null && Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
              {templates?.map((t) => (
                <button key={t.id} onClick={() => void create(t.id)} disabled={busy !== null} className="group rounded-xl border border-border bg-card/50 p-3.5 text-left transition hover:border-brand/40 hover:bg-card disabled:opacity-60">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {busy === t.id ? <Loader2 className="size-4 animate-spin text-brand" /> : <Sparkles className="size-4 text-brand" />} {t.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{t.description}</span>
                </button>
              ))}
            </div>
          </TabsContent>

          {MEDIA_KINDS.map((k) => (
            <TabsContent key={k} value={k} className="mt-6">
              {providers ? <MediaGenerator kind={k} providers={providers[k]} /> : <Skeleton className="h-72 rounded-xl" />}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
