// Rewrites Tailwind classes to their canonical form, the same check the
// Tailwind CSS VS Code extension reports as "suggestCanonicalClasses"
// (e.g. `w-[100px]` → `w-25`, `bg-black/[.06]` → `bg-black/6`).
//
//   node scripts/canonicalize-tailwind.mjs          # dry run: list changes
//   node scripts/canonicalize-tailwind.mjs --write  # apply them
//
// Only whole tokens inside string literals are touched, and only tokens that
// Tailwind recognises as valid utilities, so ordinary strings are unaffected.
import fs from "node:fs";
import path from "node:path";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";

const root = process.cwd();
const write = process.argv.includes("--write");
const cssPath = path.join(root, "src", "app", "globals.css");
const ds = await __unstable__loadDesignSystem(fs.readFileSync(cssPath, "utf8"), { base: path.dirname(cssPath) });

const cache = new Map();
function canonical(token) {
  if (cache.has(token)) return cache.get(token);
  let out = null;
  try {
    if (ds.candidatesToCss([token])[0] !== null) {
      const c = ds.canonicalizeCandidates([token], { rem: 16 })[0];
      if (c && c !== token && ds.candidatesToCss([c])[0] !== null) out = c;
    }
  } catch {
    out = null;
  }
  cache.set(token, out);
  return out;
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : files(p);
    return /\.(tsx|ts|jsx|js)$/.test(e.name) ? [p] : [];
  });
}

// String literal bodies: "…", '…', and template literal text (without ${…} parts).
const STRING = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
const TOKEN = /(^|[\s])([!-]?[a-z@*[][^\s"'`]*)(?=$|[\s])/g;

let total = 0;
for (const file of files(path.join(root, "src"))) {
  const src = fs.readFileSync(file, "utf8");
  const changes = [];
  const next = src.replace(STRING, (whole, d, s, t) => {
    const body = d ?? s ?? t ?? "";
    // In template literals, leave interpolations untouched.
    const parts = t !== undefined ? body.split(/(\$\{[^}]*\})/) : [body];
    const fixed = parts
      .map((part) =>
        part.startsWith("${")
          ? part
          : part.replace(TOKEN, (m, lead, tok) => {
              const c = canonical(tok);
              if (!c) return m;
              changes.push(`${tok} → ${c}`);
              return lead + c;
            }),
      )
      .join("");
    if (fixed === body) return whole;
    const q = d !== undefined ? '"' : s !== undefined ? "'" : "`";
    return q + fixed + q;
  });
  if (changes.length) {
    total += changes.length;
    console.log(`${path.relative(root, file)}  (${changes.length})`);
    for (const c of [...new Set(changes)]) console.log(`    ${c}`);
    if (write) fs.writeFileSync(file, next);
  }
}
console.log(`\n${total} class${total === 1 ? "" : "es"} ${write ? "rewritten" : "would be rewritten (use --write)"}`);
