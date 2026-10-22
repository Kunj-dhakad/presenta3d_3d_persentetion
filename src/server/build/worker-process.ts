import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Runs one job in the isolated build worker process.
 *
 * Isolation measures:
 *  - separate OS process (a crash or runaway parse cannot take the app down)
 *  - scrubbed environment: only what Node/esbuild need to start; no API keys,
 *    database URL, session secret or any other app configuration
 *  - V8 heap cap and a hard wall-clock timeout (SIGKILL)
 *  - bounded stdout size
 *  - the worker never reads project sources from disk (they arrive on stdin)
 *
 * For untrusted multi-tenant production use, run this worker inside a
 * container or microVM with no network; see README "Production isolation".
 */

const WORKER = path.join(/*turbopackIgnore: true*/ process.cwd(), "preview-runner", "build-worker.mjs");
const MAX_STDOUT = 40 * 1024 * 1024;

export type WorkerOptions = { timeoutMs?: number; maxHeapMb?: number };

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly code: "TIMEOUT" | "CRASH" | "OUTPUT_TOO_LARGE" | "BAD_OUTPUT",
  ) {
    super(message);
  }
}

export function scrubbedEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "ESBUILD_BINARY_PATH"];
  const out: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const k of keep) if (process.env[k]) out[k] = process.env[k];
  return out;
}

let active = 0;
const waiters: (() => void)[] = [];
const MAX_CONCURRENT = 2;

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}

export async function runWorker<T>(job: unknown, opts: WorkerOptions = {}): Promise<T> {
  await acquire();
  try {
    return await new Promise<T>((resolve, reject) => {
      const child = spawn(process.execPath, [`--max-old-space-size=${opts.maxHeapMb ?? 512}`, WORKER], {
        env: scrubbedEnv(),
        cwd: /*turbopackIgnore: true*/ process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new WorkerError(`build exceeded ${(opts.timeoutMs ?? 45_000) / 1000}s time limit`, "TIMEOUT")));
      }, opts.timeoutMs ?? 45_000);
      child.stdout.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_STDOUT) {
          child.kill("SIGKILL");
          finish(() => reject(new WorkerError("build output exceeded size limit", "OUTPUT_TOO_LARGE")));
          return;
        }
        chunks.push(c);
      });
      child.stderr.on("data", (c: Buffer) => {
        if (stderr.length < 4000) stderr += c.toString("utf8");
      });
      child.on("error", (err) => finish(() => reject(new WorkerError(`worker failed to start: ${err.message}`, "CRASH"))));
      child.on("close", (code) => {
        finish(() => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!text) {
            reject(new WorkerError(`worker exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`, "CRASH"));
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(new WorkerError("worker returned malformed output", "BAD_OUTPUT"));
          }
        });
      });
      child.stdin.on("error", () => {
        /* the close handler reports the failure */
      });
      child.stdin.end(JSON.stringify(job));
    });
  } finally {
    release();
  }
}
