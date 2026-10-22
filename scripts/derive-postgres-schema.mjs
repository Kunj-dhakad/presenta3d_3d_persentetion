// Derives prisma/postgres/schema.prisma from the SQLite source schema so the
// two providers never drift. Run via `npm run db:use-postgres`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
const out = src
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace('output   = "../src/generated/prisma"', 'output   = "../../src/generated/prisma"')
  .replace(/^\/\/ This file targets SQLite[\s\S]*?identically\.\n/m, "// GENERATED from prisma/schema.prisma by scripts/derive-postgres-schema.mjs. Do not edit.\n");
mkdirSync("prisma/postgres", { recursive: true });
writeFileSync("prisma/postgres/schema.prisma", out);
console.log("wrote prisma/postgres/schema.prisma");
