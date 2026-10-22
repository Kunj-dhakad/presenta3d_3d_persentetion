"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Copy, LayoutGrid, List, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, AlertCircle, FolderOpen, Play } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, timeAgo } from "@/lib/api-client";
import { CATEGORY_LABELS, PROJECT_CATEGORIES, type ProjectCategory } from "@/lib/schemas/project";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectThumb } from "./project-thumb";
import { cn } from "@/lib/utils";
import { useLocalPref } from "@/lib/use-local-pref";

export type ProjectRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  framework: string;
  status: string;
  isScene: boolean;
  updatedAt: string;
  lastBuildStatus: string | null;
  fileCount: number | null;
};

export function ProjectsDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [view, changeView] = useLocalPref("strata.projects.view", "grid", ["grid", "list"] as const);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ProjectRow | null>(null);
  const [toRename, setToRename] = useState<ProjectRow | null>(null);
  const [nameDraft, setNameDraft] = useState("");


  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (q.trim()) params.set("q", q.trim());
      if (category !== "all") params.set("category", category);
      const r = await api<{ projects: ProjectRow[] }>(`/api/projects?${params}`);
      setProjects(r.projects);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q, category, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const href = (p: ProjectRow) => `/chat/${p.id}`;

  async function act(p: ProjectRow, action: "duplicate" | "archive" | "unarchive" | "delete" | "rename", name?: string) {
    setBusy(p.id);
    try {
      if (action === "duplicate") {
        const r = await api<{ project: ProjectRow }>(`/api/projects/${p.id}/duplicate`, { method: "POST" });
        toast.success(`Duplicated as “${r.project.name}”`);
      } else if (action === "delete") {
        await api(`/api/projects/${p.id}`, { method: "DELETE" });
        toast.success("Project deleted");
      } else if (action === "rename") {
        await api(`/api/projects/${p.id}`, { method: "PATCH", json: { name } });
      } else {
        await api(`/api/projects/${p.id}`, { method: "PATCH", json: { status: action === "archive" ? "archived" : "active" } });
        toast.success(action === "archive" ? "Archived" : "Restored");
      }
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => projects?.length ?? 0, [projects]);

  const menu = (p: ProjectRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Actions for ${p.name}`} onClick={(e) => e.stopPropagation()}>
          {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => router.push(href(p))}><FolderOpen /> Open</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push(`/present/${p.id}`)}><Play /> Present</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { setToRename(p); setNameDraft(p.name); }}><Pencil /> Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void act(p, "duplicate")}><Copy /> Duplicate</DropdownMenuItem>
        {p.status === "archived" ? (
          <DropdownMenuItem onSelect={() => void act(p, "unarchive")}><ArchiveRestore /> Unarchive</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void act(p, "archive")}><Archive /> Archive</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(p)}><Trash2 /> Delete…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Presentations</h1>
            <p className="text-sm text-muted-foreground">{projects ? `${counts} ${status === "archived" ? "archived " : ""}presentation${counts === 1 ? "" : "s"}` : "Loading…"}</p>
          </div>
          <div className="flex gap-2">
            <Button asChild><Link href="/chat"><Plus /> New presentation</Link></Button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search presentations" className="pl-8" aria-label="Search presentations" />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-40" aria-label="Category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {PROJECT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as "active" | "archived")}>
            <SelectTrigger className="w-32" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="View">
            <button role="radio" aria-checked={view === "grid"} aria-label="Grid view" onClick={() => changeView("grid")} className={cn("flex size-7 items-center justify-center rounded-md text-muted-foreground", view === "grid" && "bg-accent text-foreground")}><LayoutGrid className="size-4" /></button>
            <button role="radio" aria-checked={view === "list"} aria-label="List view" onClick={() => changeView("list")} className={cn("flex size-7 items-center justify-center rounded-md text-muted-foreground", view === "list" && "bg-accent text-foreground")}><List className="size-4" /></button>
          </div>
        </div>

        {error && (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p className="text-sm">{error}</p>
            <Button variant="secondary" onClick={() => void load()}>Try again</Button>
          </div>
        )}

        {!error && projects === null && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
          </div>
        )}

        {!error && projects?.length === 0 && (
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <FolderOpen className="size-8 text-muted-foreground" />
            <p className="font-medium">{q || category !== "all" ? "No presentations match your filters" : status === "archived" ? "No archived presentations" : "No presentations yet"}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{q || category !== "all" ? "Try a different search or category." : "Describe a topic and get a cinematic 3D presentation."}</p>
            {!q && category === "all" && status === "active" && <Button asChild><Link href="/chat"><Plus /> Create a presentation</Link></Button>}
          </div>
        )}

        {!error && projects && projects.length > 0 && view === "grid" && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div key={p.id} className="group overflow-hidden rounded-xl border border-border bg-card transition hover:border-brand/40">
                <Link href={href(p)} className="block" aria-label={`Open ${p.name}`}>
                  <ProjectThumb category={p.category} name={p.name} seed={p.id} />
                </Link>
                <div className="flex items-start gap-2 p-3">
                  <Link href={href(p)} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("size-1.5 rounded-full", p.lastBuildStatus === "succeeded" ? "bg-success" : p.lastBuildStatus === "failed" ? "bg-destructive" : "bg-muted-foreground/40")} />
                      {CATEGORY_LABELS[p.category as ProjectCategory] ?? p.category} · {timeAgo(p.updatedAt)}
                    </p>
                  </Link>
                  {menu(p)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!error && projects && projects.length > 0 && view === "list" && (
          <div className="mt-6 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Category</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Framework</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Build</th>
                  <th className="px-3 py-2 font-medium">Modified</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="cursor-pointer border-t border-border hover:bg-accent/40" onClick={() => router.push(href(p))}>
                    <td className="max-w-0 truncate px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">{CATEGORY_LABELS[p.category as ProjectCategory] ?? p.category}</td>
                    <td className="hidden px-3 py-2.5 font-mono text-xs text-muted-foreground md:table-cell">{p.isScene ? "scene" : p.framework}</td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      <span className={cn("text-xs", p.lastBuildStatus === "succeeded" ? "text-success" : p.lastBuildStatus === "failed" ? "text-destructive" : "text-muted-foreground")}>{p.lastBuildStatus ?? "—"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{timeAgo(p.updatedAt)}</td>
                    <td className="px-2" onClick={(e) => e.stopPropagation()}>{menu(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes the presentation, its version history, conversation, share links and published site. This cannot be undone. Consider archiving instead.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (toDelete) void act(toDelete, "delete"); setToDelete(null); }}>Delete permanently</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={toRename !== null} onOpenChange={(o) => !o && setToRename(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename presentation</DialogTitle></DialogHeader>
          <form id="rename" onSubmit={(e) => { e.preventDefault(); if (toRename && nameDraft.trim()) void act(toRename, "rename", nameDraft.trim()); setToRename(null); }}>
            <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={120} aria-label="Presentation name" />
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToRename(null)}>Cancel</Button>
            <Button type="submit" form="rename" disabled={!nameDraft.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
