import "server-only";
import { env } from "@/server/env";

/**
 * Single PrismaClient per process. Application data is stored only in RDS MySQL.
 */
function createClient(): PrismaClient {
  const e = env();
  const missing = ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"].filter((key) => !e[key as "MYSQL_HOST" | "MYSQL_DATABASE" | "MYSQL_USER" | "MYSQL_PASSWORD"]);
  if (missing.length) throw new Error(`RDS MySQL configuration is missing: ${missing.join(", ")}`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaMariaDb } = require("@prisma/adapter-mariadb") as typeof import("@prisma/adapter-mariadb");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient: MysqlClient } = require("../../generated/mysql-prisma/client") as typeof import("@/generated/mysql-prisma/client");
  const adapter = new PrismaMariaDb(
    {
      host: e.MYSQL_HOST!,
      port: e.MYSQL_PORT,
      user: e.MYSQL_USER!,
      password: e.MYSQL_PASSWORD!,
      database: e.MYSQL_DATABASE!,
      connectionLimit: 5,
    },
    { onConnectionError: (error) => console.error("[rds-mysql] connection error", error.code, error.errno) },
  );
  return new MysqlClient({ adapter });
}

import type { PrismaClient } from "@/generated/mysql-prisma/client";

const globalForPrisma = globalThis as unknown as { __strataPrisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.__strataPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__strataPrisma = db;
