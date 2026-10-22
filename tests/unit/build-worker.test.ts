import { describe, expect, it } from "vitest";
import { runWorker } from "@/server/build/worker-process";
import { EXAMPLE_PROJECTS, starterFiles } from "@/server/examples";
import type { BuildDiagnostic } from "@/lib/build-types";

type Result = { ok: boolean; errors: BuildDiagnostic[]; warnings: BuildDiagnostic[]; files: { path: string; content: string }[] };

const build = (framework: string, files: { path: string; content: string }[]) =>
  runWorker<Result>({ mode: "project", framework, files, runtimeBase: "/preview-runtime/test" }, { timeoutMs: 60_000 });

describe("isolated build worker", () => {
  for (const ex of EXAMPLE_PROJECTS) {
    it(`builds example "${ex.id}" without errors`, async () => {
      const r = await build(ex.framework, ex.files());
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      const html = r.files.find((f) => f.path === "index.html")!;
      expect(html.content).toContain('<script type="importmap">');
      expect(html.content).toContain("data-strata-shim");
    });
  }

  for (const fw of ["vanilla", "three", "react-ts", "react-js"] as const) {
    it(`builds the ${fw} starter`, async () => {
      const r = await build(fw, starterFiles(fw));
      expect(r.errors).toEqual([]);
    });
  }

  it("rejects packages outside the runtime allowlist", async () => {
    const r = await build("react-ts", [
      { path: "src/main.tsx", content: 'import axios from "axios";\nconsole.log(axios);\n' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.message).join("\n")).toMatch(/package "axios".*not available/);
  });

  it("reports syntax errors with file and line", async () => {
    const r = await build("react-ts", [{ path: "src/main.tsx", content: "const x = ;\n" }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ file: "src/main.tsx", line: 1, source: "esbuild" });
  });

  it("reports missing relative imports", async () => {
    const r = await build("react-ts", [{ path: "src/main.tsx", content: 'import { A } from "./Missing";\nconsole.log(A);\n' }]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /cannot find "\.\/Missing"/.test(e.message))).toBe(true);
  });

  it("requires full file names for browser ES modules in static projects", async () => {
    const r = await build("vanilla", [
      { path: "index.html", content: '<script type="module" src="./a.js"></script>' },
      { path: "a.js", content: 'import { b } from "./b";\nconsole.log(b);\n' },
      { path: "b.js", content: "export const b = 1;\n" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/full file name/);
  });

  it("blocks remote scripts and remote dynamic imports", async () => {
    const r = await build("vanilla", [
      { path: "index.html", content: '<script src="https://evil.example/x.js"></script><script type="module" src="./a.js"></script>' },
      { path: "a.js", content: 'import("https://evil.example/y.js");\n' },
    ]);
    expect(r.ok).toBe(false);
    const msgs = r.errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/external script/);
    expect(msgs).toMatch(/remote/);
  });

  it("flags unsafe patterns as warnings", async () => {
    const r = await build("vanilla", [
      { path: "index.html", content: '<script type="module" src="./a.js"></script>' },
      { path: "a.js", content: 'eval("1"); console.log(document.cookie);\n' },
    ]);
    expect(r.ok).toBe(true);
    const msgs = r.warnings.map((w) => w.message).join("\n");
    expect(msgs).toMatch(/eval/);
    expect(msgs).toMatch(/document\.cookie/);
  });

  it("replaces a model-written import map with the runtime import map", async () => {
    const r = await build("vanilla", [{ path: "index.html", content: '<html><head><script type="importmap">{"imports":{"three":"https://cdn.example/three.js"}}</script></head><body></body></html>' }]);
    const html = r.files.find((f) => f.path === "index.html")!.content;
    expect(html).not.toContain("cdn.example");
    expect(html).toContain("/preview-runtime/test/three.js");
  });

  it("never receives server secrets in its environment", async () => {
    process.env.OPENAI_API_KEY = "sk-test-should-not-leak";
    const r = await build("vanilla", [
      { path: "index.html", content: "<p>x</p>" },
    ]);
    process.env.OPENAI_API_KEY = "";
    expect(JSON.stringify(r)).not.toContain("sk-test-should-not-leak");
  });
});
