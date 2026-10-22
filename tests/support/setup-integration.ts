import nextEnv from "@next/env";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";

nextEnv.loadEnvConfig(process.cwd());

// Real OpenAI settings come from .env / the environment; test records stay in an isolated fixture DB.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-int-"));
const dbFile = path.join(dir, "int.db").split(path.sep).join("/");
process.env.DATA_DIR = dir;
process.env.STRATA_TEST_DATABASE_FILE = dbFile;
process.env.AI_PROVIDER = "openai";
(process.env as Record<string, string>).NODE_ENV = "test";
const testDb = new Database(dbFile);
const migrationsDir = path.join(process.cwd(), "prisma", "test", "migrations");
for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  testDb.exec(fs.readFileSync(path.join(migrationsDir, entry.name, "migration.sql"), "utf8"));
}
testDb.close();
