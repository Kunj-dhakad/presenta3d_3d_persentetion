import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/test-prisma/client";

const file = process.env.STRATA_TEST_DATABASE_FILE;
if (!file) throw new Error("Test database path is missing.");

/** SQLite adapter is available only through Vitest's test alias, never app runtime. */
export const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) }) as unknown as import("@/generated/mysql-prisma/client").PrismaClient;
