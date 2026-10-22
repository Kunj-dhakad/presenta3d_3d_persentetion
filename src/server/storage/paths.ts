import "server-only";
import path from "node:path";
import { env } from "@/server/env";

/** Absolute path inside the runtime data directory (default ./.data). */
export function dataPath(...segments: string[]): string {
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().DATA_DIR);
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("path escapes data directory");
  return target;
}
