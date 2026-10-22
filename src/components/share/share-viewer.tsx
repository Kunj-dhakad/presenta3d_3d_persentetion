"use client";

import "@/components/editor/monaco-setup";
import Editor from "@monaco-editor/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Code2, Eye, Lock } from "lucide-react";
import { configureMonaco } from "@/components/editor/monaco-setup";
import { FileIcon } from "@/components/editor/file-icon";
import { Logo } from "@/components/brand/logo";
import { languageForPath } from "@/lib/vfs/paths";
import { cn } from "@/lib/utils";
import { useDeckRemote } from "@/components/present/use-deck-remote";

/**
 * Read-only view of a shared project. By default it shows only the
 * presentation, full screen with no chrome (keyboard, click, swipe and mouse
 * wheel all navigate). `showCode` adds a header with a source-code tab.
 */
export function ShareViewer({ name, description, files, previewUrl, showCode = false }: { name: string; description: string; files: { path: string; content: string }[]; previewUrl: string | null; showCode?: boolean }) {
  const [active, setActive] = useState(files.find((f) => f.path === "index.html")?.path ?? files[0]?.path ?? null);
  const [tab, setTab] = useState<"preview" | "code">(previewUrl ? "preview" : "code");
  const frame = useRef<HTMLIFrameElement>(null);
  useDeckRemote(frame);
  const file = files.find((f) => f.path === active);

  if (!showCode) {
    return previewUrl ? (
      <iframe
        ref={frame}
        src={previewUrl}
        title={name}
        sandbox="allow-scripts allow-popups"
        allow="fullscreen"
        className="fixed inset-0 size-full border-0 bg-black"
        onLoad={() => frame.current?.focus()}
      />
    ) : (
      <div className="flex h-dvh items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">This presentation has no preview yet.</div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link href="/"><Logo withWordmark={false} /></Link>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
        <span className="ml-2 hidden items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline-flex"><Lock className="size-3" /> Read-only</span>
        <div className="ml-auto flex rounded-lg border border-border p-0.5" role="tablist">
          <button role="tab" aria-selected={tab === "preview"} disabled={!previewUrl} onClick={() => setTab("preview")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground disabled:opacity-40", tab === "preview" && "bg-accent text-foreground")}><Eye className="size-3.5" /> Preview</button>
          <button role="tab" aria-selected={tab === "code"} onClick={() => setTab("code")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground", tab === "code" && "bg-accent text-foreground")}><Code2 className="size-3.5" /> Code</button>
        </div>
      </header>
      {tab === "preview" && previewUrl ? (
        <iframe ref={frame} src={previewUrl} title={`${name} preview`} sandbox="allow-scripts allow-popups" allow="fullscreen" className="min-h-0 flex-1 border-0 bg-white" onLoad={() => frame.current?.focus()} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface py-1 thin-scroll" aria-label="Files">
            {files.map((f) => (
              <button key={f.path} onClick={() => setActive(f.path)} className={cn("flex w-full items-center gap-1.5 px-3 py-1 text-left text-[12.5px] text-muted-foreground hover:bg-accent/60", active === f.path && "bg-accent text-foreground")}>
                <FileIcon path={f.path} /> <span className="truncate">{f.path}</span>
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {file ? (
              <Editor path={`share://${file.path}`} value={file.content} language={languageForPath(file.path)} theme="strata-dark" beforeMount={configureMonaco} options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true }} />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">This project has no files.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
