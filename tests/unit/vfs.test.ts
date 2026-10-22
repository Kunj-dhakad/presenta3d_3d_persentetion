import { describe, expect, it } from "vitest";
import { VFS_LIMITS, resolveRelative, validateProjectPath } from "@/lib/vfs/paths";
import { applyHunk, applyOperations, diffStats, toFileMap } from "@/lib/vfs/apply";
import type { FileOperation } from "@/lib/schemas/project";

const op = (o: Partial<FileOperation> & Pick<FileOperation, "path" | "operation">): FileOperation => ({ content: "", patches: [], explanation: "", ...o });

describe("file path validation", () => {
  it.each(["index.html", "src/App.tsx", "src/components/Hero.jsx", "public/data.json", "styles/main.css", "a-b_c@v2+x.ts"])("accepts %s", (p) => {
    expect(validateProjectPath(p)).toEqual({ ok: true, path: p });
  });

  it.each([
    ["../etc/passwd.txt", "relative segments"],
    ["src/../../x.js", "relative segments"],
    ["/etc/hosts.txt", "relative to the project root"],
    ["C:/Windows/x.js", "drive letters"],
    ["src\\App.tsx", "forward slashes"],
    ["src//App.tsx", "empty path segment"],
    ["node_modules/react/index.js", "reserved"],
    [".git/config.txt", "reserved"],
    [".env", "reserved"],
    ["con.js", "reserved device"],
    ["src/app.exe", "not supported"],
    ["Makefile", "not supported"],
    ["src/a b.js", "invalid characters"],
    ["src/\u0000x.js", "control characters"],
    ["src/", "must name a file"],
    ["", "empty"],
  ])("rejects %j (%s)", (p, why) => {
    const r = validateProjectPath(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(why);
  });

  it("rejects overly long and deep paths and non-strings", () => {
    expect(validateProjectPath(`${"a".repeat(VFS_LIMITS.maxPathLength)}.js`).ok).toBe(false);
    expect(validateProjectPath(`${"d/".repeat(VFS_LIMITS.maxDepth)}x.js`).ok).toBe(false);
    expect(validateProjectPath(42).ok).toBe(false);
  });

  it("resolves relative imports and refuses to escape the root", () => {
    expect(resolveRelative("src/components/A.tsx", "../lib/b")).toBe("src/lib/b");
    expect(resolveRelative("main.js", "./world.js")).toBe("world.js");
    expect(resolveRelative("main.js", "../x.js")).toBeNull();
  });
});

describe("file operations", () => {
  const base = toFileMap([
    { path: "index.html", content: "<h1>Hi</h1>\n<p>body</p>\n" },
    { path: "app.js", content: "const a = 1;\nconst b = 2;\n" },
  ]);

  it("creates, replaces, patches and deletes with a change log", () => {
    const r = applyOperations(base, [
      op({ path: "new.css", operation: "create", content: "body{}" }),
      op({ path: "index.html", operation: "patch", patches: [{ search: "<h1>Hi</h1>", replace: "<h1>Hello</h1>" }] }),
      op({ path: "app.js", operation: "delete" }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.get("index.html")).toContain("<h1>Hello</h1>");
    expect(r.files.has("app.js")).toBe(false);
    expect(r.changes.map((c) => [c.path, c.kind]).sort()).toEqual([
      ["app.js", "deleted"],
      ["index.html", "modified"],
      ["new.css", "created"],
    ]);
  });

  it("is all-or-nothing: one invalid operation leaves the original untouched", () => {
    const r = applyOperations(base, [op({ path: "ok.js", operation: "create", content: "1" }), op({ path: "../escape.js", operation: "create", content: "x" })]);
    expect(r.ok).toBe(false);
    expect(base.has("ok.js")).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/relative segments/);
  });

  it("rejects patches that do not match, are ambiguous, or target missing files", () => {
    expect(applyOperations(base, [op({ path: "app.js", operation: "patch", patches: [{ search: "nope", replace: "x" }] })]).ok).toBe(false);
    expect(applyOperations(base, [op({ path: "app.js", operation: "patch", patches: [{ search: "const", replace: "let" }] })]).ok).toBe(false);
    expect(applyOperations(base, [op({ path: "missing.js", operation: "patch", patches: [{ search: "a", replace: "b" }] })]).ok).toBe(false);
    expect(applyOperations(base, [op({ path: "missing.js", operation: "delete" })]).ok).toBe(false);
  });

  it("rejects conflicting operations on the same path", () => {
    const r = applyOperations(base, [op({ path: "x.js", operation: "create", content: "1" }), op({ path: "x.js", operation: "create", content: "2" })]);
    expect(r.ok).toBe(false);
  });

  it("enforces file and project size limits", () => {
    const big = "x".repeat(VFS_LIMITS.maxFileBytes + 1);
    expect(applyOperations(base, [op({ path: "big.js", operation: "create", content: big })]).ok).toBe(false);
    const many = Array.from({ length: VFS_LIMITS.maxFiles + 1 }, (_, i) => op({ path: `f${i}.js`, operation: "create", content: "1" }));
    expect(applyOperations(new Map(), many).ok).toBe(false);
  });

  it("applies hunks tolerant of trailing whitespace and CRLF", () => {
    const r = applyHunk("a\r\n  b   \r\nc\r\n", "  b\nc", "B\nC");
    expect(r).toEqual({ ok: true, result: "a\nB\nC\n" });
  });

  it("computes diff stats", () => {
    expect(diffStats("a\nb\nc", "a\nB\nc\nd")).toEqual({ added: 2, removed: 1 });
    expect(diffStats(null, "a\nb")).toEqual({ added: 2, removed: 0 });
  });
});
