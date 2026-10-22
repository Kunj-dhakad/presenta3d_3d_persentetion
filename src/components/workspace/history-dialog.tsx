"use client";

import { useCallback, useEffect, useState } from "react";
import { Bookmark, GitCompare, History, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage, timeAgo } from "@/lib/api-client";
import { useWorkspace } from "@/stores/workspace";
import { DiffDialog, type FileSet } from "./diff-dialog";

type Version = { id: string; kind: string; label: string | null; summary: string | null; fileCount: number; isWorking: boolean; isLastWorking: boolean; createdAt: string };

const KIND: Record<string, string> = { auto: "Autosave", checkpoint: "Checkpoint", "pre-ai": "Before AI change", ai: "AI change", restore: "Restore", import: "Initial" };

export function HistoryDialog({ open, onOpenChange, onRestored }: { open: boolean; onOpenChange: (o: boolean) => void; onRestored: () => void }) {
  const projectId = useWorkspace((s) => s.projectId);
  const liveFiles = useWorkspace((s) => s.files);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ version: Version; files: FileSet | null } | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await api<{ versions: Version[] }>(`/api/projects/${projectId}/versions`);
      setVersions(r.versions);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    let live = true;
    api<{ versions: Version[] }>(`/api/projects/${projectId}/versions`).then(
      (r) => live && (setVersions(r.versions), setError(null)),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [open, projectId]);

  async function checkpoint() {
    if (!label.trim() || !projectId) return;
    setBusy("checkpoint");
    try {
      await useWorkspace.getState().save({ rebuild: false });
      await api(`/api/projects/${projectId}/versions`, { method: "POST", json: { label: label.trim() } });
      setLabel("");
      toast.success("Checkpoint saved");
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function restore(v: Version, paths?: string[]) {
    if (!projectId) return;
    setBusy(v.id);
    try {
      const r = await api<{ files: FileSet }>(`/api/projects/${projectId}/versions/${v.id}/restore`, { method: "POST", json: paths ? { paths } : {} });
      useWorkspace.getState().loadFiles(r.files);
      await useWorkspace.getState().runBuild();
      toast.success(paths ? `Reverted ${paths[0]}` : "Version restored");
      onRestored();
      await load();
      if (!paths) onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function openCompare(v: Version) {
    setCompare({ version: v, files: null });
    try {
      const r = await api<{ version: { files: FileSet } }>(`/api/projects/${projectId}/versions/${v.id}`);
      setCompare({ version: v, files: r.version.files });
    } catch (e) {
      toast.error(errorMessage(e));
      setCompare(null);
    }
  }

  const currentFiles = Object.entries(liveFiles).map(([path, content]) => ({ path, content }));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="size-4" /> Version history</DialogTitle>
            <DialogDescription>Snapshots are created automatically around AI changes, builds and saves. Restoring keeps the current state as a new snapshot.</DialogDescription>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void checkpoint();
            }}
          >
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name a checkpoint, e.g. Before redesign" maxLength={80} aria-label="Checkpoint name" />
            <Button type="submit" disabled={!label.trim() || busy !== null}>
              {busy === "checkpoint" ? <Loader2 className="animate-spin" /> : <Bookmark />} Save
            </Button>
          </form>
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-border thin-scroll">
            {error && <p className="p-4 text-sm text-destructive">{error}</p>}
            {!versions && !error && <p className="flex items-center p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading…</p>}
            {versions?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No versions yet. They appear after the first save or generation.</p>}
            {versions?.map((v) => (
              <div key={v.id} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{v.label ?? KIND[v.kind] ?? v.kind}</span>
                    {v.isLastWorking && (
                      <span className="inline-flex items-center gap-1 rounded bg-success/15 px-1.5 py-px text-[10.5px] text-success"><ShieldCheck className="size-3" />Last working</span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{timeAgo(v.createdAt)} · {v.fileCount} files{v.summary ? ` · ${v.summary}` : ""}</p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => void openCompare(v)}><GitCompare /> Compare</Button>
                <Button size="xs" variant="secondary" disabled={busy !== null} onClick={() => void restore(v)}>
                  {busy === v.id ? <Loader2 className="animate-spin" /> : <RotateCcw />} Restore
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <DiffDialog
        open={compare !== null}
        onOpenChange={(o) => !o && setCompare(null)}
        title="Compare with current"
        description="Left: selected version. Right: current files. Revert individual files or restore the whole version."
        before={compare?.files ?? null}
        after={currentFiles}
        beforeLabel={compare ? (compare.version.label ?? KIND[compare.version.kind] ?? "version") : ""}
        afterLabel="current"
        loading={compare !== null && compare.files === null}
        onRevertFile={compare ? (p) => restore(compare.version, [p]) : undefined}
        footer={compare && <Button onClick={() => void restore(compare.version).then(() => setCompare(null))}><RotateCcw /> Restore entire version</Button>}
      />
    </>
  );
}
