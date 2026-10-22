import "server-only";
import path from "node:path";
import fs from "node:fs";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/server/env";

/**
 * Single PrismaClient per process. The driver adapter is selected from the
 * database config: MYSQL_* → RDS MySQL, DATABASE_URL postgres → pg,
 * otherwise file: → better-sqlite3 (local).
 */
function createClient(): PrismaClient {
  const e = env();
  if (e.MYSQL_HOST) {
    const missing = ["MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"].filter((key) => !e[key as "MYSQL_DATABASE" | "MYSQL_USER" | "MYSQL_PASSWORD"]);
    if (missing.length) throw new Error(`RDS MySQL configuration is missing: ${missing.join(", ")}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaMariaDb } = require("@prisma/adapter-mariadb") as typeof import("@prisma/adapter-mariadb");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient: MysqlClient } = require("../../generated/mysql-prisma/client") as typeof import("@/generated/mysql-prisma/client");
    const adapter = new PrismaMariaDb({
      host: e.MYSQL_HOST,
      port: e.MYSQL_PORT,
      user: e.MYSQL_USER!,
      password: e.MYSQL_PASSWORD!,
      database: e.MYSQL_DATABASE!,
      connectionLimit: 5,
    });
    return new MysqlClient({ adapter }) as unknown as PrismaClient;
  }
  const url = e.DATABASE_URL;
  if (/^postgres(ql)?:\/\//.test(url)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  if (e.NODE_ENV === "production") {
    throw new Error(
      "Production database is not configured. Set MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, and MYSQL_PASSWORD for RDS MySQL, or set a PostgreSQL DATABASE_URL.",
    );
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
