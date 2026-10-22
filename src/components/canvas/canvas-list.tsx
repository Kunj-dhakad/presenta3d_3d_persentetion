"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, PenTool, Plus, Trash2 } from "lucide-react";
import { api, errorMessage, timeAgo } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type Row = { id: string; name: string; updatedAt: string; revision: number };

export function CanvasList() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const load = () => api<{ canvases: Row[] }>("/api/canvas").then((r) => setRows(r.canvases), (e) => setError(errorMessage(e)));
  useEffect(() => void load(), []);

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ canvas: { id: string } }>("/api/canvas", { method: "POST", json: { name: "Untitled canvas" } });
      router.push(`/canvas/${r.canvas.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Canvas</h1>
            <p className="text-sm text-muted-foreground">Design boards with frames, text, shapes, media and live project previews.</p>
          </div>
          <Button onClick={() => void create()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} New canvas</Button>
        </div>
        {error && <p className="mt-8 text-sm text-destructive">{error}</p>}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows === null && !error && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          {rows?.length === 0 && (
            <div className="col-span-full flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
              <PenTool className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">No canvases yet</p>
              <Button size="sm" onClick={() => void create()}><Plus /> Create your first canvas</Button>
            </div>
          )}
          {rows?.map((c) => (
            <div key={c.id} className="group relative overflow-hidden rounded-xl border border-border bg-card transition hover:border-brand/40">
              <Link href={`/canvas/${c.id}`} className="block">
                <div className="grid-dots h-24 border-b border-border bg-[#0e0e12]" />
                <div className="px-3 py-2.5">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">Edited {timeAgo(c.updatedAt)}</p>
                </div>
              </Link>
              <button onClick={() => setToDelete(c)} aria-label={`Delete ${c.name}`} className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-background/70 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100 focus:opacity-100">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The canvas and its version history are permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const c = toDelete;
                setToDelete(null);
                if (c) void api(`/api/canvas/${c.id}`, { method: "DELETE" }).then(load, (e) => toast.error(errorMessage(e)));
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
