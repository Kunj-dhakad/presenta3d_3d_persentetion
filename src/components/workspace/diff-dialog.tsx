"use client";

import "@/components/editor/monaco-setup";
import { DiffEditor } from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { configureMonaco } from "@/components/editor/monaco-setup";
import { FileIcon } from "@/components/editor/file-icon";
import { languageForPath } from "@/lib/vfs/paths";
import { diffStats } from "@/lib/vfs/apply";
import { cn } from "@/lib/utils";

export type FileSet = { path: string; content: string }[];

export function DiffDialog({
  open,
  onOpenChange,
  title,
  description,
  before,
  after,
  beforeLabel,
  afterLabel,
  loading,
  footer,
  onRevertFile,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  before: FileSet | null;
  after: FileSet | null;
  beforeLabel: string;
  afterLabel: string;
  loading?: boolean;
  footer?: React.ReactNode;
  onRevertFile?: (path: string) => Promise<void>;
}) {
  const changes = useMemo(() => {
    if (!before || !after) return [];
    const a = new Map(before.map((f) => [f.path, f.content]));
    const b = new Map(after.map((f) => [f.path, f.content]));
    const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
    return paths
      .filter((p) => a.get(p) !== b.get(p))
      .map((p) => ({ path: p, before: a.get(p) ?? null, after: b.get(p) ?? null, kind: !a.has(p) ? "added" : !b.has(p) ? "deleted" : "modified", ...diffStats(a.get(p) ?? null, b.get(p) ?? null) }));
  }, [before, after]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const current = changes.find((c) => c.path === selected) ?? changes[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-[min(1200px,95vw)] flex-col gap-3 p-4 sm:max-w-[min(1200px,95vw)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading versions…</div>
        ) : changes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No differences.</div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
            <ul className="w-60 shrink-0 overflow-auto border-r border-border bg-surface py-1 thin-scroll">
              {changes.map((c) => (
                <li key={c.path}>
                  <button onClick={() => setSelected(c.path)} className={cn("flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs hover:bg-accent", current?.path === c.path && "bg-accent")}>
                    <FileIcon path={c.path} />
                    <span className="min-w-0 flex-1 truncate">{c.path}</span>
                    <span className="shrink-0 font-mono text-[10.5px]"><span className="text-success">+{c.added}</span> <span className="text-destructive">−{c.removed}</span></span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3 text-xs text-muted-foreground">
                <span className="truncate">{beforeLabel} → {afterLabel} · <span className="text-foreground">{current?.path}</span> ({current?.kind})</span>
                {onRevertFile && current && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={reverting !== null}
                    onClick={async () => {
                      setReverting(current.path);
                      try {
                        await onRevertFile(current.path);
                      } finally {
                        setReverting(null);
                      }
                    }}
                  >
                    {reverting === current.path ? <Loader2 className="animate-spin" /> : <Undo2 />} Revert this file
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1">
                {current && (
                  <DiffEditor
                    original={current.before ?? ""}
                    modified={current.after ?? ""}
                    originalModelPath={`inmemory://diff/before/${current.path}`}
                    modifiedModelPath={`inmemory://diff/after/${current.path}`}
                    language={languageForPath(current.path)}
                    theme="strata-dark"
                    beforeMount={configureMonaco}
                    options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, automaticLayout: true }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
        {footer && <div className="flex shrink-0 justify-end gap-2">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}
