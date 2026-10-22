import type { FileOperation } from "@/lib/schemas/project";
import { VFS_LIMITS, byteLength, validateProjectPath } from "./paths";

export type FileMap = Map<string, string>;

export type FileChange = {
  path: string;
  kind: "created" | "modified" | "deleted";
  before: string | null;
  after: string | null;
};

export type ApplyResult =
  | { ok: true; files: FileMap; changes: FileChange[] }
  | { ok: false; errors: string[]; partial: FileChange[] };

export function toFileMap(files: Iterable<{ path: string; content: string }>): FileMap {
  const m: FileMap = new Map();
  for (const f of files) m.set(f.path, f.content);
  return m;
}

export function fromFileMap(m: FileMap): { path: string; content: string }[] {
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, content }));
}

/** Apply one search/replace hunk. Exact match first, then a trailing-whitespace-tolerant line match. */
export function applyHunk(source: string, search: string, replace: string): { ok: true; result: string } | { ok: false; error: string } {
  if (search.length === 0) return { ok: false, error: "empty search block" };
  const first = source.indexOf(search);
  if (first !== -1) {
    if (source.indexOf(search, first + 1) !== -1) return { ok: false, error: "search block matches more than once; include more context" };
    return { ok: true, result: source.slice(0, first) + replace + source.slice(first + search.length) };
  }
  // Tolerant: compare line-by-line ignoring trailing whitespace and CRLF differences.
  const norm = (s: string) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd());
  const srcLines = source.replace(/\r\n/g, "\n").split("\n");
  const srcNorm = srcLines.map((l) => l.trimEnd());
  const needle = norm(search);
  while (needle.length && needle[needle.length - 1] === "") needle.pop();
  while (needle.length && needle[0] === "") needle.shift();
  if (needle.length === 0) return { ok: false, error: "empty search block" };
  const hits: number[] = [];
  for (let i = 0; i + needle.length <= srcNorm.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (srcNorm[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) hits.push(i);
  }
  if (hits.length === 0) return { ok: false, error: "search block not found in file" };
  if (hits.length > 1) return { ok: false, error: "search block matches more than once; include more context" };
  const i = hits[0];
  const out = [...srcLines.slice(0, i), ...replace.replace(/\r\n/g, "\n").split("\n"), ...srcLines.slice(i + needle.length)];
  return { ok: true, result: out.join("\n") };
}

/**
 * Validate and apply a batch of AI/editor file operations against a file map.
 * All-or-nothing: if any operation is invalid the original map is untouched.
 */
export function applyOperations(current: FileMap, ops: FileOperation[]): ApplyResult {
  const files: FileMap = new Map(current);
  const errors: string[] = [];
  const changes = new Map<string, FileChange>();
  const touched = new Set<string>();

  for (const op of ops) {
    const v = validateProjectPath(op.path);
    if (!v.ok) {
      errors.push(`${op.path}: ${v.error}`);
      continue;
    }
    const path = v.path;
    if (touched.has(path) && op.operation !== "patch") {
      errors.push(`${path}: multiple conflicting operations in one change set`);
      continue;
    }
    touched.add(path);
    const before = files.get(path) ?? null;
    const original = current.get(path) ?? null;
    switch (op.operation) {
      case "create":
      case "replace": {
        // Models sometimes say "create" for an existing file; that is treated as a replace.
        if (byteLength(op.content) > VFS_LIMITS.maxFileBytes) {
          errors.push(`${path}: file exceeds ${VFS_LIMITS.maxFileBytes / 1024} KB`);
          break;
        }
        files.set(path, op.content);
        break;
      }
      case "patch": {
        if (before === null) {
          errors.push(`${path}: cannot patch a file that does not exist`);
          break;
        }
        if (!op.patches.length) {
          errors.push(`${path}: patch operation without hunks`);
          break;
        }
        let text = before;
        let failed = false;
        op.patches.forEach((h, idx) => {
          if (failed) return;
          const r = applyHunk(text, h.search, h.replace);
          if (!r.ok) {
            errors.push(`${path}: hunk ${idx + 1}: ${r.error}`);
            failed = true;
          } else text = r.result;
        });
        if (!failed) {
          if (byteLength(text) > VFS_LIMITS.maxFileBytes) errors.push(`${path}: file exceeds ${VFS_LIMITS.maxFileBytes / 1024} KB`);
          else files.set(path, text);
        }
        break;
      }
      case "delete": {
        if (before === null) {
          errors.push(`${path}: cannot delete a file that does not exist`);
          break;
        }
        files.delete(path);
        break;
      }
    }
    const after = files.get(path) ?? null;
    if (original === after) changes.delete(path);
    else
      changes.set(path, {
        path,
        kind: original === null ? "created" : after === null ? "deleted" : "modified",
        before: original,
        after,
      });
  }

  if (files.size > VFS_LIMITS.maxFiles) errors.push(`project would exceed ${VFS_LIMITS.maxFiles} files`);
  let total = 0;
  for (const c of files.values()) total += byteLength(c);
  if (total > VFS_LIMITS.maxProjectBytes) errors.push(`project would exceed ${VFS_LIMITS.maxProjectBytes / 1024 / 1024} MB`);

  if (errors.length) return { ok: false, errors, partial: [...changes.values()] };
  return { ok: true, files, changes: [...changes.values()] };
}

/** Line-based diff summary (added/removed counts) for change lists. */
export function diffStats(before: string | null, after: string | null): { added: number; removed: number } {
  const a = before === null ? [] : before.split("\n");
  const b = after === null ? [] : after.split("\n");
  const setA = new Map<string, number>();
  for (const l of a) setA.set(l, (setA.get(l) ?? 0) + 1);
  let common = 0;
  for (const l of b) {
    const n = setA.get(l) ?? 0;
    if (n > 0) {
      common++;
      setA.set(l, n - 1);
    }
  }
  return { added: b.length - common, removed: a.length - common };
}
