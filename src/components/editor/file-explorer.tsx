"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FilePlus2, FolderPlus, Pencil, Search, Trash2, Folder, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/stores/workspace";
import { validateProjectPath } from "@/lib/vfs/paths";
import { FileIcon } from "./file-icon";
import { Input } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type TreeNode = { name: string; path: string; children: TreeNode[]; isFile: boolean };

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [], isFile: false };
  for (const p of [...paths].sort()) {
    const parts = p.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part && c.isFile === isFile);
      if (!child) {
        child = { name: part, path, children: [], isFile };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

type Pending = { kind: "new-file" | "rename"; base: string; from?: string } | null;

export function FileExplorer({ readOnly = false }: { readOnly?: boolean }) {
  const files = useWorkspace((s) => s.files);
  const saved = useWorkspace((s) => s.saved);
  const activePath = useWorkspace((s) => s.activePath);
  const { openFile, createFile, renameFile, deleteFile, save } = useWorkspace.getState();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [mode, setMode] = useState<"tree" | "search">("tree");
  const [query, setQuery] = useState("");
  const tree = useMemo(() => buildTree(Object.keys(files)), [files]);

  const results = useMemo(() => {
    if (mode !== "search" || query.trim().length < 2) return [];
    const q = query.toLowerCase();
    const out: { path: string; line: number; text: string }[] = [];
    for (const [path, content] of Object.entries(files)) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && out.length < 200; i++) if (lines[i].toLowerCase().includes(q)) out.push({ path, line: i + 1, text: lines[i].trim().slice(0, 140) });
      if (path.toLowerCase().includes(q) && !out.some((r) => r.path === path)) out.unshift({ path, line: 1, text: "(file name match)" });
    }
    return out;
  }, [mode, query, files]);

  function commit() {
    if (!pending) return;
    const name = draft.trim().replace(/^\/+/, "");
    const path = pending.kind === "rename" ? name : pending.base ? `${pending.base}/${name}` : name;
    const v = validateProjectPath(path);
    if (!v.ok) {
      toast.error(v.error);
      return;
    }
    if (v.path in files && v.path !== pending.from) {
      toast.error(`${v.path} already exists`);
      return;
    }
    if (pending.kind === "new-file") createFile(v.path, "");
    else if (pending.from && pending.from !== v.path) renameFile(pending.from, v.path);
    setPending(null);
    setDraft("");
    void save({ snapshot: true }).catch((e) => toast.error(e instanceof Error ? e.message : "Save failed"));
  }

  const startNew = (base: string, folder = false) => {
    setPending({ kind: "new-file", base });
    setDraft(folder ? "new-folder/index.js" : "");
  };

  const renderInput = (depth: number) => (
    <div style={{ paddingLeft: 8 + depth * 12 }} className="py-0.5 pr-2">
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setPending(null);
        }}
        onBlur={() => (draft.trim() ? commit() : setPending(null))}
        placeholder={pending?.kind === "rename" ? "new/path.ext" : "file-name.ext"}
        className="h-6 px-1.5 font-mono text-xs"
        aria-label={pending?.kind === "rename" ? "New path" : "New file name"}
      />
    </div>
  );

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    if (n.isFile) {
      if (pending?.kind === "rename" && pending.from === n.path) return <div key={n.path}>{renderInput(depth)}</div>;
      const isDirty = files[n.path] !== saved[n.path];
      const row = (
        <button
          onClick={() => openFile(n.path)}
          style={{ paddingLeft: 8 + depth * 12 + 14 }}
          className={cn("flex w-full items-center gap-1.5 py-0.75 pr-2 text-left text-[12.5px] text-muted-foreground transition hover:bg-accent/60 hover:text-foreground", activePath === n.path && "bg-accent text-foreground")}
          title={n.path}
        >
          <FileIcon path={n.path} />
          <span className="truncate">{n.name}</span>
          {isDirty && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warning" aria-label="Unsaved changes" />}
        </button>
      );
      if (readOnly) return <div key={n.path}>{row}</div>;
      return (
        <ContextMenu key={n.path}>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => { setPending({ kind: "rename", base: "", from: n.path }); setDraft(n.path); }}><Pencil /> Rename / move</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => setConfirmDelete(n.path)}><Trash2 /> Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );
    }
    const open = !collapsed.has(n.path);
    return (
      <div key={`d:${n.path}`}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              onClick={() => setCollapsed((c) => { const x = new Set(c); if (x.has(n.path)) x.delete(n.path); else x.add(n.path); return x; })}
              style={{ paddingLeft: 8 + depth * 12 }}
              className="flex w-full items-center gap-1 py-0.75 pr-2 text-left text-[12.5px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              aria-expanded={open}
            >
              <ChevronRight className={cn("size-3 transition", open && "rotate-90")} />
              {open ? <FolderOpen className="size-3.5 text-muted-foreground" /> : <Folder className="size-3.5 text-muted-foreground" />}
              <span className="truncate">{n.name}</span>
            </button>
          </ContextMenuTrigger>
          {!readOnly && (
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => startNew(n.path)}><FilePlus2 /> New file here</ContextMenuItem>
            </ContextMenuContent>
          )}
        </ContextMenu>
        {open && (
          <>
            {pending?.kind === "new-file" && pending.base === n.path && renderInput(depth + 1)}
            {n.children.map((c) => renderNode(c, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
        <div className="flex gap-0.5 text-[11px] font-medium uppercase tracking-wider">
          <button onClick={() => setMode("tree")} className={cn("rounded px-1.5 py-0.5", mode === "tree" ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>Files</button>
          <button onClick={() => setMode("search")} className={cn("rounded px-1.5 py-0.5", mode === "search" ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>Search</button>
        </div>
        {!readOnly && mode === "tree" && (
          <div className="flex">
            <Tooltip><TooltipTrigger asChild><button onClick={() => startNew("")} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="New file"><FilePlus2 className="size-3.5" /></button></TooltipTrigger><TooltipContent>New file</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><button onClick={() => startNew("", true)} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="New folder"><FolderPlus className="size-3.5" /></button></TooltipTrigger><TooltipContent>New folder (type folder/file.ext)</TooltipContent></Tooltip>
          </div>
        )}
      </div>
      {mode === "tree" ? (
        <div className="min-h-0 flex-1 overflow-auto py-1 thin-scroll" role="tree" aria-label="Project files">
          {pending?.kind === "new-file" && pending.base === "" && renderInput(0)}
          {tree.length === 0 && !pending && <p className="px-3 py-4 text-xs text-muted-foreground">No files yet.</p>}
          {tree.map((n) => renderNode(n, 0))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in project" className="h-7 pl-7 text-xs" aria-label="Search in project" />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1 pb-2 thin-scroll">
            {query.trim().length >= 2 && results.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>}
            {results.map((r, i) => (
              <button key={`${r.path}:${r.line}:${i}`} onClick={() => openFile(r.path, r.line)} className="block w-full rounded px-2 py-1 text-left hover:bg-accent">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><FileIcon path={r.path} />{r.path}:{r.line}</span>
                <span className="block truncate font-mono text-[11.5px] text-foreground/90">{r.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete}?</AlertDialogTitle>
            <AlertDialogDescription>The file is removed from the project. You can still restore it from version history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDelete) {
                  deleteFile(confirmDelete);
                  void save({ snapshot: true }).catch((e) => toast.error(e instanceof Error ? e.message : "Save failed"));
                }
                setConfirmDelete(null);
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
