import "dotenv/config";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Real OpenAI settings come from .env / the environment; everything else is isolated.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-int-"));
const dbFile = path.join(dir, "int.db").split(path.sep).join("/");
process.env.DATA_DIR = dir;
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.AI_PROVIDER = "openai";
execFileSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { env: { ...process.env }, stdio: "ignore" });
