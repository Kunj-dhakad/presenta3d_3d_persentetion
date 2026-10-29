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
      // Always talk UTF-8 (4-byte) to the server. The core database is MySQL 5.6 with a latin1
      // default; slides contain "→", "·" and emoji, which failed with error 1366 otherwise.
      collation: "UTF8MB4_UNICODE_CI",
      initSql: "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
      // The workspace opens ~7 requests at once; a small pool makes them queue behind each other.
      // A serverless instance (Amplify/Lambda) serves one request at a time, so it needs far fewer:
      // with many instances, 10 each would use up the database's max_connections.
      connectionLimit: process.env.NODE_ENV === "production" ? 4 : 10,
      // A frozen or recycled serverless instance never closes its connections, and MySQL's default
      // wait_timeout keeps them open for 8 hours until the server refuses new ones. Let the server
      // drop connections idle for 3 minutes (the pool itself recycles idle ones after 60 s).
      sessionVariables: { wait_timeout: 180 },
      // RDS connections that sit idle can be dropped silently by the network; a query sent on
      // one then hangs for minutes (jobs were reported as "interrupted" while waiting on it).
      // Recycle idle connections early, keep the rest alive, and let a stuck query fail fast.
      idleTimeout: 60, // seconds
      keepAliveDelay: 20_000,
      connectTimeout: 10_000,
      acquireTimeout: 20_000,
      socketTimeout: 90_000,
    },
    { onConnectionError: (error) => console.error("[rds-mysql] connection error", error.code, error.errno) },
  );
  return new MysqlClient({ adapter });
}

import type { PrismaClient } from "@/generated/mysql-prisma/client";

const globalForPrisma = globalThis as unknown as { __deck3dPrisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.__deck3dPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__deck3dPrisma = db;
