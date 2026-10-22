"use client";

import "./monaco-setup";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import { X, Search, Replace, Wand2, Undo2, Redo2, Save, Loader2 } from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { configureMonaco, modelUri } from "./monaco-setup";
import { languageForPath } from "@/lib/vfs/paths";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FileIcon } from "./file-icon";

const CODE_LANGS = new Set(["typescript", "javascript"]);

function ToolButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} disabled={disabled} aria-label={label} className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function CodeEditor({ readOnly = false }: { readOnly?: boolean }) {
  const files = useWorkspace((s) => s.files);
  const saved = useWorkspace((s) => s.saved);
  const openTabs = useWorkspace((s) => s.openTabs);
  const activePath = useWorkspace((s) => s.activePath);
  const revealLine = useWorkspace((s) => s.revealLine);
  const buildErrors = useWorkspace((s) => s.build.errors);
  const saving = useWorkspace((s) => s.saving);
  const { openFile, closeTab, editFile, save } = useWorkspace.getState();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Keep a Monaco model for every code file so the TS service resolves cross-file imports.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const wanted = new Set<string>();
    for (const [path, content] of Object.entries(files)) {
      const lang = languageForPath(path);
      if (!CODE_LANGS.has(lang)) continue;
      const uri = modelUri(monaco, path);
      wanted.add(uri.toString());
      const model = monaco.editor.getModel(uri);
      if (!model) monaco.editor.createModel(content, lang, uri);
      else if (model.getValue() !== content && path !== activePath) model.setValue(content);
    }
    for (const m of monaco.editor.getModels()) {
      if (m.uri.toString().startsWith("file:///project/") && !wanted.has(m.uri.toString()) && !(m.uri.path.slice(9) in files)) m.dispose();
    }
  }, [files, activePath]);

  // Build diagnostics → editor markers.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    for (const m of monaco.editor.getModels()) {
      const path = m.uri.path.replace(/^\/project\//, "");
      const markers = buildErrors
        .filter((d) => d.file === path && d.line > 0)
        .map((d) => ({ severity: monaco.MarkerSeverity.Error, message: d.message, startLineNumber: d.line, startColumn: Math.max(1, d.column + 1), endLineNumber: d.line, endColumn: Math.max(2, d.column + 2) + 40, source: "build" }));
      monaco.editor.setModelMarkers(m, "strata-build", markers);
    }
  }, [buildErrors, activePath]);

  useEffect(() => {
    if (!revealLine || revealLine.path !== activePath || !editorRef.current) return;
    const ed = editorRef.current;
    ed.revealLineInCenter(revealLine.line);
    ed.setPosition({ lineNumber: revealLine.line, column: 1 });
    ed.focus();
  }, [revealLine, activePath]);

  const onMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save({ snapshot: true }).catch(() => {});
    });
    // trigger model sync effect
    useWorkspace.setState((s) => ({ files: { ...s.files } }));
  };

  const run = (id: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    if (id === "undo" || id === "redo") ed.trigger("toolbar", id, null);
    else void ed.getAction(id)?.run();
  };

  const dirty = (p: string) => files[p] !== saved[p];
  const content = activePath ? files[activePath] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#141418]">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-surface">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto thin-scroll" role="tablist" aria-label="Open files">
          {openTabs.map((t) => (
            <div key={t} role="tab" aria-selected={t === activePath} className={cn("group flex shrink-0 items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-[12.5px] text-muted-foreground", t === activePath && "bg-[#141418] text-foreground")}>
              <button className="flex items-center gap-1.5" onClick={() => openFile(t)} title={t}>
                <FileIcon path={t} />
                {t.split("/").pop()}
              </button>
              <button onClick={() => closeTab(t)} aria-label={`Close ${t}`} className="flex size-4 items-center justify-center rounded hover:bg-accent">
                {dirty(t) ? <span className="size-1.5 rounded-full bg-foreground group-hover:hidden" /> : null}
                <X className={cn("size-3", dirty(t) && "hidden group-hover:block")} />
              </button>
            </div>
          ))}
        </div>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-0.5 px-1.5">
            <ToolButton label="Find (Ctrl+F)" onClick={() => run("actions.find")} disabled={!activePath}><Search className="size-3.5" /></ToolButton>
            <ToolButton label="Find and replace (Ctrl+H)" onClick={() => run("editor.action.startFindReplaceAction")} disabled={!activePath}><Replace className="size-3.5" /></ToolButton>
            <ToolButton label="Format document (Shift+Alt+F)" onClick={() => run("editor.action.formatDocument")} disabled={!activePath}><Wand2 className="size-3.5" /></ToolButton>
            <ToolButton label="Undo" onClick={() => run("undo")} disabled={!activePath}><Undo2 className="size-3.5" /></ToolButton>
            <ToolButton label="Redo" onClick={() => run("redo")} disabled={!activePath}><Redo2 className="size-3.5" /></ToolButton>
            <ToolButton label="Save (Ctrl+S)" onClick={() => void save({ snapshot: true }).catch(() => {})}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            </ToolButton>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {activePath && content !== undefined ? (
          <Editor
            key="strata-editor"
            path={`file:///project/${activePath}`}
            language={languageForPath(activePath)}
            value={content}
            theme="strata-dark"
            beforeMount={configureMonaco}
            onMount={onMount}
            onChange={(v) => {
              if (!readOnly && activePath) editFile(activePath, v ?? "");
            }}
            loading={<div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading editor…</div>}
            options={{
              readOnly,
              fontSize: 13,
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              tabSize: 2,
              renderLineHighlight: "line",
              padding: { top: 10 },
              automaticLayout: true,
              fixedOverflowWidgets: true,
              bracketPairColorization: { enabled: true },
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a file to edit</div>
        )}
      </div>
    </div>
  );
}
