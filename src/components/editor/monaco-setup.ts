"use client";

import { loader, type Monaco } from "@monaco-editor/react";

// Monaco is served from this app (/vendor/monaco), never from a CDN.
loader.config({ paths: { vs: "/vendor/monaco/vs" } });

let configured = false;

export const MODEL_ROOT = "file:///project/";
export const modelUri = (monaco: Monaco, path: string) => monaco.Uri.parse(`${MODEL_ROOT}${path}`);

/** One-time Monaco configuration: theme and TypeScript/JavaScript language service options. */
export function configureMonaco(monaco: Monaco) {
  if (configured) return;
  configured = true;
  monaco.editor.defineTheme("deck3d-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7080", fontStyle: "italic" },
      { token: "keyword", foreground: "b4a7ff" },
      { token: "string", foreground: "9fe3c0" },
      { token: "number", foreground: "ffc58a" },
      { token: "type", foreground: "8fd3ff" },
    ],
    colors: {
      "editor.background": "#141418",
      "editor.foreground": "#e6e7ec",
      "editorLineNumber.foreground": "#4a4d5a",
      "editorLineNumber.activeForeground": "#a8abb8",
      "editor.lineHighlightBackground": "#1b1b21",
      "editor.selectionBackground": "#3a3f6a88",
      "editorIndentGuide.background1": "#24252c",
      "editorWidget.background": "#1a1a20",
      "editorWidget.border": "#2a2b33",
      "editorGutter.background": "#141418",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff22",
    },
  });
  const ts = monaco.languages.typescript;
  const compilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
  };
  ts.typescriptDefaults.setCompilerOptions(compilerOptions);
  ts.javascriptDefaults.setCompilerOptions({ ...compilerOptions, checkJs: false });
  // Package type definitions are not loaded into the editor; ignore the diagnostics
  // that only exist because of that. Real build errors come from the build worker.
  // 2307/2792/7016: module or its types not found · 7026/2875: JSX runtime types · 2503/2686: React namespace/UMD
  // 2580/2591: Node globals · 7006/7031: implicit any · 18046: unknown-typed values from untyped modules
  const diagnosticCodesToIgnore = [2307, 2792, 7016, 7026, 2875, 2503, 2686, 2580, 2591, 7006, 7031, 18046];
  ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore });
  ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  ts.typescriptDefaults.setEagerModelSync(true);
}
