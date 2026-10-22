import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Each test process uses an isolated data directory and SQLite database; never the dev database.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-test-"));
const dbFile = path.join(dir, "test.db").split(path.sep).join("/");
process.env.DATA_DIR = dir;
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789";
process.env.AI_PROVIDER = "mock";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_MODEL = "";
(process.env as Record<string, string>).NODE_ENV = "test";

// Apply migrations to the fresh test database.
execFileSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
  stdio: "ignore",
});
