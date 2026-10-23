import "server-only";
import os from "node:os";
import path from "node:path";
import { env } from "@/server/env";

/**
 * Serverless hosts (AWS Amplify compute, Lambda) mount the app read-only; only
 * the OS temp directory is writable there.
 */
export function isServerless(): boolean {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV || process.env.LAMBDA_TASK_ROOT);
}

/** Absolute path inside the runtime data directory (default ./.data, or <tmp>/deck3d-data on serverless hosts). */
export function dataPath(...segments: string[]): string {
  const configured = env().DATA_DIR;
  const root = path.isAbsolute(configured)
    ? configured
    : isServerless()
      ? path.join(os.tmpdir(), "deck3d-data")
      : path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("path escapes data directory");
  return target;
}
