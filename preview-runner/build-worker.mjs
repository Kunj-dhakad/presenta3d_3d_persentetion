// Isolated preview build worker.
//
// Spawned by src/server/build/builder.ts as a separate Node.js process with a
// scrubbed environment (no API keys, no database URL, no session secret), a
// heap cap and a hard timeout. It reads one JSON job from stdin and writes one
// JSON result to stdout.
//
// It never executes generated code. esbuild only parses/transforms it, and all
// module resolution is served from the in-memory file list: the worker does
// not read project files from disk and generated code cannot reference host
// paths. Bare imports must be in the preview runtime allowlist.

import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_PACKAGES, THREE_ADDONS, isAllowedSpecifier, importMap, packageName } from "./registry.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "package.json"));

const CODE_EXT = new Set(["js", "jsx", "ts", "tsx", "mjs"]);
const ext = (p) => {
  const n = p.split("/").pop() ?? "";
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(i + 1).toLowerCase() : "";
};
const loaderFor = (p) => {
  const e = ext(p);
  if (e === "mjs") return "js";
  if (e === "svg") return "dataurl";
  if (e === "txt" || e === "md" || e === "glsl" || e === "vert" || e === "frag" || e === "csv") return "text";
  if (["js", "jsx", "ts", "tsx", "css", "json"].includes(e)) return e;
  return "text";
};

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function out(result) {
  process.stdout.write(JSON.stringify(result));
}

// ─── Runtime (vendor) build ──────────────────────────────────────────────

async function buildRuntime({ outDir }) {
  const entries = {};
  const seen = new Set();
  for (const pkg of Object.values(RUNTIME_PACKAGES)) {
    if (seen.has(pkg.file)) continue;
    seen.add(pkg.file);
    const name = pkg.file.replace(/\.js$/, "");
    if (pkg.kind === "cjs") {
      const keys = Object.keys(require(pkg.spec)).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "default");
      entries[name] =
        `import * as M from ${JSON.stringify(pkg.spec)};\nconst D = M.default ?? M;\nexport default D;\n` +
        (keys.length ? `export const { ${keys.join(", ")} } = D;\n` : "");
    } else {
      entries[name] =
        `export * from ${JSON.stringify(pkg.spec)};\n` + (pkg.defaultExport ? `export { default } from ${JSON.stringify(pkg.spec)};\n` : "");
    }
  }
  for (const addon of THREE_ADDONS) {
    entries[`three-addons/${addon.replace(/\.js$/, "")}`] = `export * from ${JSON.stringify(`three/addons/${addon}`)};\n`;
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  await esbuild.build({
    entryPoints: Object.keys(entries).map((k) => ({ in: `entry:${k}`, out: k })),
    bundle: true,
    splitting: true,
    format: "esm",
    outdir: outDir,
    chunkNames: "chunks/[name]-[hash]",
    minify: true,
    write: true,
    logLevel: "silent",
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "entries",
        setup(b) {
          b.onResolve({ filter: /^entry:/ }, (a) => ({ path: a.path.slice(6), namespace: "entry" }));
          b.onLoad({ filter: /.*/, namespace: "entry" }, (a) => ({ contents: entries[a.path], loader: "js", resolveDir: path.join(here, "..") }));
        },
      },
    ],
  });
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ builtAt: new Date().toISOString(), entries: Object.keys(entries) }, null, 2));
  return { ok: true, durationMs: Date.now() - t0, entries: Object.keys(entries).length };
}

// ─── Project validation ──────────────────────────────────────────────────

const IMPORT_RE = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"'\n]+)["']|(?:^|[^\w$.])import\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

function scanImports(code) {
  const specs = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(code))) specs.push(m[1] ?? m[2]);
  return specs;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const UNSAFE = [
  { re: /\beval\s*\(/, msg: "uses eval(); avoid dynamic code execution", severity: "warning" },
  { re: /\bnew\s+Function\s*\(/, msg: "uses new Function(); avoid dynamic code execution", severity: "warning" },
  { re: /document\.cookie/, msg: "accesses document.cookie (unavailable in the sandboxed preview)", severity: "warning" },
  { re: /\b(window\.)?(top|parent)\.(location|document)\b/, msg: "tries to access the parent window (blocked by the sandbox)", severity: "warning" },
  { re: /fetch\(\s*["'`]\/api\//, msg: "calls a relative /api endpoint; generated apps cannot reach the platform backend", severity: "warning" },
  { re: /import\(\s*["'`]https?:/, msg: "dynamic import of remote code is blocked", severity: "error" },
];

function resolveIn(files, fromFile, spec, browserStrict) {
  let base;
  if (spec.startsWith("/")) base = spec.slice(1);
  else {
    const parts = fromFile.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (!parts.length) return { error: "import escapes the project root" };
        parts.pop();
      } else parts.push(seg);
    }
    base = parts.join("/");
  }
  base = base.split("?")[0].split("#")[0];
  if (files.has(base)) return { path: base };
  const candidates = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", ".css", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"].map((s) => base + s);
  const hit = candidates.find((c) => files.has(c));
  if (hit && !browserStrict) return { path: hit };
  if (hit && browserStrict) return { error: `browsers need the full file name: import "${spec}" should reference "${hit}"` };
  return { error: `cannot find "${spec}"` };
}

function validateCode(files, file, code, diagnostics, browserStrict) {
  for (const u of UNSAFE) {
    const m = u.re.exec(code);
    if (m) diagnostics.push({ severity: u.severity, file, line: lineOf(code, m.index), column: 0, message: u.msg, source: "validator" });
  }
  for (const spec of scanImports(code)) {
    if (/^https?:\/\//.test(spec) || spec.startsWith("//")) {
      diagnostics.push({ severity: "error", file, line: 0, column: 0, message: `remote import "${spec}" is blocked; use an allowed package instead`, source: "validator" });
    } else if (spec.startsWith(".") || spec.startsWith("/")) {
      if (/\.(png|jpe?g|gif|webp|mp3|mp4|glb|gltf|hdr)$/i.test(spec)) continue; // asset URLs are checked at runtime
      const r = resolveIn(files, file, spec, browserStrict);
      if (r.error) diagnostics.push({ severity: "error", file, line: 0, column: 0, message: r.error, source: "validator" });
    } else if (!isAllowedSpecifier(spec)) {
      diagnostics.push({
        severity: "error",
        file,
        line: 0,
        column: 0,
        message: `package "${packageName(spec)}" (import "${spec}") is not available in the preview runtime`,
        source: "validator",
      });
    }
  }
}

async function syntaxCheck(file, code, diagnostics) {
  try {
    const e = ext(file);
    const r = await esbuild.transform(code, { loader: e === "mjs" ? "js" : e, jsx: "automatic", logLevel: "silent", sourcefile: file });
    for (const w of r.warnings.slice(0, 5)) {
      diagnostics.push({ severity: "warning", file, line: w.location?.line ?? 0, column: w.location?.column ?? 0, message: w.text, source: "esbuild" });
    }
    return r.code;
  } catch (err) {
    for (const e of (err.errors ?? []).slice(0, 10)) {
      diagnostics.push({ severity: "error", file, line: e.location?.line ?? 0, column: e.location?.column ?? 0, message: e.text, source: "esbuild" });
    }
    return null;
  }
}

function headInjection(runtimeBase, shim) {
  return (
    `<meta charset="utf-8">\n` +
    `<script type="importmap">${JSON.stringify(importMap(runtimeBase))}</script>\n` +
    `<script data-deck3d-shim>${shim}</script>\n`
  );
}

function injectHead(html, injection) {
  // Remove any import map the model wrote; ours must be authoritative.
  html = html.replace(/<script[^>]*type=["']importmap["'][^>]*>[\s\S]*?<\/script>/gi, "");
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${injection}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${injection}</head>`);
  return `<!doctype html>\n<html><head>\n${injection}</head><body>\n${html}\n</body></html>`;
}

function checkHtml(files, file, html, diagnostics) {
  const refRe = /<(script|link|img|source|video|audio)\b[^>]*?\s(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = refRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const ref = m[2];
    const line = lineOf(html, m.index);
    if (/^(data:|blob:|#|mailto:|tel:)/.test(ref)) continue;
    if (/^https?:\/\/|^\/\//.test(ref)) {
      if (tag === "script") diagnostics.push({ severity: "error", file, line, column: 0, message: `external script "${ref}" is blocked by the preview sandbox; import an allowed package instead`, source: "html" });
      else if (tag === "link" && !/fonts\.googleapis\.com/.test(ref)) diagnostics.push({ severity: "warning", file, line, column: 0, message: `external resource "${ref}" may be blocked by the preview sandbox`, source: "html" });
      continue;
    }
    const target = ref.startsWith("/") ? ref.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), ref));
    const clean = target.split("?")[0].split("#")[0];
    if (!files.has(clean) && !files.has(`public/${clean}`) && !/\.(png|jpe?g|gif|webp|ico|mp3|mp4|glb|gltf|hdr)$/i.test(clean)) {
      diagnostics.push({ severity: tag === "script" ? "error" : "warning", file, line, column: 0, message: `references missing file "${ref}"`, source: "html" });
    }
  }
  const inlineRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const inline = [];
  while ((m = inlineRe.exec(html))) {
    if (/\bsrc=/.test(m[1])) continue;
    if (/type=["'](importmap|application\/json|application\/ld\+json|x-shader\/[\w-]+)["']/.test(m[1])) continue;
    inline.push({ code: m[2], module: /type=["']module["']/.test(m[1]), line: lineOf(html, m.index) });
  }
  return inline;
}

async function buildProject(job) {
  const t0 = Date.now();
  const files = new Map(job.files.map((f) => [f.path, f.content]));
  const diagnostics = [];
  const shim = readFileSync(path.join(here, "shim.js"), "utf8");
  const injection = headInjection(job.runtimeBase, shim);
  const output = [];
  const isReact = job.framework === "react-ts" || job.framework === "react-js";

  // package.json sanity
  if (files.has("package.json")) {
    try {
      const pkg = JSON.parse(files.get("package.json"));
      for (const dep of Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })) {
        const known = Object.keys(RUNTIME_PACKAGES).some((s) => packageName(s) === dep);
        const tooling = /^(vite|@vitejs\/|typescript|@types\/|eslint|prettier|tailwindcss|postcss|autoprefixer)/.test(dep);
        if (!known && !tooling)
          diagnostics.push({ severity: "warning", file: "package.json", line: 0, column: 0, message: `dependency "${dep}" is not provided by the preview runtime`, source: "validator" });
      }
    } catch (e) {
      diagnostics.push({ severity: "error", file: "package.json", line: 0, column: 0, message: `invalid JSON: ${e.message}`, source: "validator" });
    }
  }
  for (const [p, c] of files) {
    if (ext(p) === "json" && p !== "package.json") {
      try {
        JSON.parse(c);
      } catch (e) {
        diagnostics.push({ severity: "error", file: p, line: 0, column: 0, message: `invalid JSON: ${e.message}`, source: "validator" });
      }
    }
  }

  // Per-file syntax + import validation.
  for (const [p, c] of files) {
    if (!CODE_EXT.has(ext(p))) continue;
    if (/(^|\/)(vite|tailwind|postcss|eslint)\.config\.\w+$/.test(p)) continue; // tooling configs are not part of the browser bundle
    const js = await syntaxCheck(p, c, diagnostics);
    if (js !== null) validateCode(files, p, js, diagnostics, !isReact);
  }

  let bundleJs = null;
  let bundleCss = null;
  if (isReact) {
    const entry = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx", "src/main.ts", "src/main.js", "main.tsx", "main.jsx", "index.tsx", "index.jsx"].find((e) => files.has(e));
    if (!entry) {
      diagnostics.push({ severity: "error", file: "", line: 0, column: 0, message: "no entry file found (expected src/main.tsx or src/main.jsx)", source: "validator" });
    } else if (!diagnostics.some((d) => d.severity === "error")) {
      try {
        const r = await esbuild.build({
          entryPoints: [`vfs:${entry}`],
          bundle: true,
          format: "esm",
          write: false,
          outdir: "out",
          entryNames: "bundle",
          jsx: "automatic",
          target: "es2022",
          minify: false,
          keepNames: true,
          logLevel: "silent",
          define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.MODE": '"production"' },
          plugins: [
            {
              name: "vfs",
              setup(b) {
                b.onResolve({ filter: /.*/ }, (a) => {
                  if (a.path.startsWith("vfs:")) return { path: a.path.slice(4), namespace: "vfs" };
                  if (a.kind === "url-token" && /^(https?:|data:|\/\/)/.test(a.path)) return { path: a.path, external: true };
                  if (a.path.startsWith(".") || a.path.startsWith("/")) {
                    const from = a.namespace === "vfs" ? a.importer : entry;
                    const r = resolveIn(files, from, a.path, false);
                    if (r.error) {
                      if (a.kind === "url-token") return { path: a.path, external: true };
                      return { errors: [{ text: r.error }] };
                    }
                    return { path: r.path, namespace: "vfs" };
                  }
                  if (/^https?:/.test(a.path)) return { errors: [{ text: `remote import "${a.path}" is blocked` }] };
                  if (isAllowedSpecifier(a.path)) return { path: a.path, external: true };
                  return { errors: [{ text: `package "${packageName(a.path)}" is not available in the preview runtime` }] };
                });
                b.onLoad({ filter: /.*/, namespace: "vfs" }, (a) => ({ contents: files.get(a.path), loader: loaderFor(a.path) }));
              },
            },
          ],
        });
        for (const f of r.outputFiles) {
          if (f.path.endsWith(".js")) bundleJs = f.text;
          else if (f.path.endsWith(".css")) bundleCss = f.text;
        }
        for (const w of r.warnings.slice(0, 10)) {
          diagnostics.push({ severity: "warning", file: w.location?.file?.replace(/^vfs:/, "") ?? "", line: w.location?.line ?? 0, column: w.location?.column ?? 0, message: w.text, source: "esbuild" });
        }
      } catch (err) {
        for (const e of (err.errors ?? [{ text: String(err.message ?? err) }]).slice(0, 15)) {
          diagnostics.push({ severity: "error", file: e.location?.file?.replace(/^vfs:/, "") ?? "", line: e.location?.line ?? 0, column: e.location?.column ?? 0, message: e.text, source: "esbuild" });
        }
      }
    }
  }

  // HTML documents.
  const htmlFiles = [...files.keys()].filter((p) => /\.html?$/.test(p));
  if (!isReact && !files.has("index.html")) {
    diagnostics.push({ severity: "error", file: "", line: 0, column: 0, message: "static projects need an index.html at the project root", source: "validator" });
  }
  for (const p of htmlFiles) {
    let html = files.get(p);
    const inline = checkHtml(files, p, html, diagnostics);
    for (const s of inline) {
      const js = await syntaxCheck(`${p} (inline script, line ${s.line})`, s.code, diagnostics);
      if (js !== null && s.module) validateCode(files, p, js, diagnostics, true);
    }
    if (isReact && p === "index.html") {
      html = html.replace(/<script\b[^>]*\bsrc=["'][^"']*\/?(src\/)?(main|index)\.(t|j)sx?["'][^>]*><\/script>/gi, "");
      const tags = `${bundleCss !== null ? '<link rel="stylesheet" href="./bundle.css">\n' : ""}<script type="module" src="./bundle.js"></script>\n`;
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tags}</body>`) : html + tags;
    }
    output.push({ path: p, content: injectHead(html, injection) });
  }
  if (isReact && !files.has("index.html")) {
    output.push({
      path: "index.html",
      content: injectHead(
        `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview</title>${bundleCss !== null ? '<link rel="stylesheet" href="./bundle.css">' : ""}</head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`,
        injection,
      ),
    });
  }
  if (bundleJs !== null) output.push({ path: "bundle.js", content: bundleJs });
  if (bundleCss !== null) output.push({ path: "bundle.css", content: bundleCss });

  // Static files: Vite-style public/ is served from the root; for static projects everything is served as-is.
  for (const [p, c] of files) {
    if (/\.html?$/.test(p)) continue;
    if (p.startsWith("public/")) output.push({ path: p.slice(7), content: c });
    else if (!isReact) {
      if (["ts", "tsx", "jsx"].includes(ext(p))) {
        // Static projects may use TS/JSX modules: serve a transpiled copy at the same path.
        const r = await esbuild.transform(c, { loader: ext(p), jsx: "automatic", format: "esm", logLevel: "silent" }).catch(() => null);
        if (r) output.push({ path: p, content: r.code });
      } else output.push({ path: p, content: c });
    }
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  return { ok: errors.length === 0, errors: errors.slice(0, 40), warnings: warnings.slice(0, 40), files: errors.length === 0 ? output : [], durationMs: Date.now() - t0 };
}

// ─── main ────────────────────────────────────────────────────────────────

try {
  const job = JSON.parse(await readStdin());
  if (job.mode === "runtime") out(await buildRuntime(job));
  else if (job.mode === "project") out(await buildProject(job));
  else out({ ok: false, errors: [{ severity: "error", file: "", line: 0, column: 0, message: "unknown job mode", source: "worker" }] });
} catch (err) {
  out({ ok: false, fatal: true, errors: [{ severity: "error", file: "", line: 0, column: 0, message: `build worker failed: ${String(err?.message ?? err).slice(0, 500)}`, source: "worker" }], warnings: [], files: [] });
} finally {
  esbuild.stop();
}
