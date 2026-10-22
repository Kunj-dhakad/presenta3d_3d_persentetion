"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Box, Download, Film, Image as ImageIcon, Loader2, Music, Search, Trash2, Upload, Pencil, Palette, FileQuestion } from "lucide-react";
import { api, errorMessage, formatBytes, timeAgo } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ModelViewer } from "@/components/studio/model-viewer";
import { cn } from "@/lib/utils";

type Asset = { id: string; name: string; type: string; mimeType: string; size: number; source: string; prompt: string | null; provider: string | null; createdAt: string; url: string };
const TYPES = [
  { id: "", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "model3d", label: "3D models" },
  { id: "material", label: "Materials" },
];
const ICON: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Film, audio: Music, model3d: Box, material: Palette };

function Thumb({ a }: { a: Asset }) {
  if (a.mimeType.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={a.url} alt={a.name} loading="lazy" className="size-full object-cover" />;
  }
  if (a.mimeType.startsWith("video/")) return <video src={a.url} muted preload="metadata" className="size-full object-cover" />;
  const Icon = ICON[a.type] ?? FileQuestion;
  return <div className="flex size-full items-center justify-center bg-accent/40"><Icon className="size-7 text-muted-foreground" /></div>;
}

export function AssetLibrary() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<Asset | null>(null);
  const [toDelete, setToDelete] = useState<Asset | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (type) p.set("type", type);
      if (q.trim()) p.set("q", q.trim());
      const r = await api<{ assets: Asset[] }>(`/api/assets?${p}`);
      setAssets(r.assets);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [type, q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function upload(files: FileList | File[]) {
    setUploading(true);
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.append("file", f);
      try {
        await api("/api/assets", { method: "POST", body: form });
        toast.success(`Uploaded ${f.name}`);
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
    }
    setUploading(false);
    await load();
  }

  async function rename(a: Asset) {
    const name = window.prompt("Rename asset", a.name)?.trim();
    if (!name || name === a.name) return;
    try {
      await api(`/api/assets/${a.id}`, { method: "PATCH", json: { name } });
      await load();
      setOpen((o) => (o && o.id === a.id ? { ...o, name } : o));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div
      className={cn("h-full overflow-y-auto thin-scroll", dragOver && "ring-2 ring-inset ring-brand")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
            <p className="text-sm text-muted-foreground">Uploaded and generated media. Drop files anywhere on this page to upload.</p>
          </div>
          <Button onClick={() => input.current?.click()} disabled={uploading}>{uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload</Button>
          <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,video/mp4,video/webm,.glb,model/gltf-binary" className="hidden" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Asset type">
            {TYPES.map((t) => (
              <button key={t.id} role="radio" aria-checked={type === t.id} onClick={() => setType(t.id)} className={cn("rounded-md px-2.5 py-1 text-xs text-muted-foreground", type === t.id && "bg-accent text-foreground")}>{t.label}</button>
            ))}
          </div>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets" className="pl-8" aria-label="Search assets" />
          </div>
        </div>
        {error && <p className="mt-8 text-sm text-destructive">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {assets === null && !error && Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
          {assets?.length === 0 && (
            <div className="col-span-full flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
              <ImageIcon className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">{q || type ? "No matching assets" : "No assets yet"}</p>
              <p className="text-xs text-muted-foreground">Upload files, or generate media in the Studio and save it here.</p>
            </div>
          )}
          {assets?.map((a) => (
            <button key={a.id} onClick={() => setOpen(a)} className="group overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-brand/40">
              <div className="aspect-square overflow-hidden"><Thumb a={a} /></div>
              <div className="px-2.5 py-2">
                <p className="truncate text-xs font-medium">{a.name}</p>
                <p className="text-[11px] text-muted-foreground">{a.source === "generated" ? "Generated" : "Uploaded"} · {formatBytes(a.size)}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-6">{open.name}</DialogTitle>
                <DialogDescription>{open.mimeType} · {formatBytes(open.size)} · added {timeAgo(open.createdAt)}{open.provider ? ` · ${open.provider}` : ""}</DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[60vh] justify-center overflow-hidden rounded-lg border border-border bg-black/40">
                {open.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={open.url} alt={open.name} className="max-h-[60vh] object-contain" />
                ) : open.mimeType.startsWith("video/") ? (
                  <video src={open.url} controls className="max-h-[60vh] w-full" />
                ) : open.mimeType.startsWith("audio/") ? (
                  <audio src={open.url} controls className="m-6 w-full" />
                ) : open.mimeType.startsWith("model/") ? (
                  <ModelViewer url={open.url} />
                ) : null}
              </div>
              {open.prompt && <p className="text-xs text-muted-foreground"><span className="text-foreground">Prompt:</span> {open.prompt}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => void rename(open)}><Pencil /> Rename</Button>
                <Button variant="ghost" asChild><a href={`${open.url}?download=1`}><Download /> Download</a></Button>
                <Button variant="destructive" onClick={() => setToDelete(open)}><Trash2 /> Delete</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Canvases or projects that reference this asset will show a missing image.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const a = toDelete;
                setToDelete(null);
                setOpen(null);
                if (a) void api(`/api/assets/${a.id}`, { method: "DELETE" }).then(load, (e) => toast.error(errorMessage(e)));
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
