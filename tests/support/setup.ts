import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";

// Unit tests use a private SQLite fixture; application runtime only connects to RDS MySQL.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-test-"));
const dbFile = path.join(dir, "test.db").split(path.sep).join("/");
process.env.DATA_DIR = dir;
process.env.STRATA_TEST_DATABASE_FILE = dbFile;
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789";
process.env.AI_PROVIDER = "mock";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_MODEL = "";
process.env.STORAGE_DRIVER = "local";
(process.env as Record<string, string>).NODE_ENV = "test";

// Apply the checked-in SQLite SQL directly. The Prisma schema engine's
// migrate deploy currently fails on fresh Windows test databases.
const testDb = new Database(dbFile);
const migrationsDir = path.join(process.cwd(), "prisma", "test", "migrations");
for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  testDb.exec(fs.readFileSync(path.join(migrationsDir, entry.name, "migration.sql"), "utf8"));
}
testDb.close();
