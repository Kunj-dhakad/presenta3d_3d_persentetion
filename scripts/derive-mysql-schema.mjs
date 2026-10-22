// Derives the RDS MySQL Prisma schema from the SQLite source schema.
// Keep both provider schemas in sync by editing prisma/schema.prisma first.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const source = readFileSync("prisma/schema.prisma", "utf8");
const longTextFields = new Set(["content", "description", "error", "prompt", "summary"]);
const out = source
  .replace('provider = "sqlite"', 'provider = "mysql"')
  .replace('output   = "../src/generated/prisma"', 'output   = "../../src/generated/mysql-prisma"')
  .replace(/^\/\/ This file targets SQLite[\s\S]*?identically\.\n/m, "// GENERATED from prisma/schema.prisma by scripts/derive-mysql-schema.mjs. Do not edit.\n")
  .replace(/^([ \t]*)(\w+)([ \t]+String\??)([ \t]+[^\r\n]*)?$/gm, (line, indent, name, type, rest = "") => {
    if (!longTextFields.has(name) || rest.includes("@db.")) return line;
    return `${indent}${name}${type}${rest} @db.LongText`;
  });

mkdirSync("prisma/mysql", { recursive: true });
writeFileSync("prisma/mysql/schema.prisma", out);
console.log("wrote prisma/mysql/schema.prisma");
