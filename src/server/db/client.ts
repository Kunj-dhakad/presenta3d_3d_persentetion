import "server-only";
import path from "node:path";
import fs from "node:fs";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/server/env";

/**
 * Single PrismaClient per process. The driver adapter is selected from the
 * DATABASE_URL scheme: `file:` → better-sqlite3 (local), `postgres://` → pg.
 */
function createClient(): PrismaClient {
  const url = env().DATABASE_URL;
  if (/^postgres(ql)?:\/\//.test(url)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3");
  const file = url.replace(/^file:/, "");
  const abs = path.isAbsolute(file) ? file : path.join(/*turbopackIgnore: true*/ process.cwd(), file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${abs}` }) });
}

const globalForPrisma = globalThis as unknown as { __strataPrisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.__strataPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__strataPrisma = db;
