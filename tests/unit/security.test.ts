import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { authMode, env, publicConfigStatus, resetEnvCache } from "@/server/env";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { checkOrigin, readJson } from "@/server/http/api";
import { rateLimit, resetRateLimits } from "@/server/http/rate-limit";
import { scrubbedEnv } from "@/server/build/worker-process";
import { assertStorageKey } from "@/server/storage/storage";
import { safeJoin } from "@/server/http/static";
import { z } from "zod";

const SECRET = "sk-test-SENTINEL-do-not-leak-1234567890";

afterEach(() => {
  process.env.OPENAI_API_KEY = "";
  delete process.env.SESSION_SECRET_BACKUP;
  (process.env as Record<string, string>).NODE_ENV = "test";
  delete process.env.AUTH_MODE;
  resetEnvCache();
});

describe("secret handling", () => {
  it("never includes secret values in the public configuration status", () => {
    process.env.OPENAI_API_KEY = SECRET;
    process.env.OPENAI_MODEL = "m";
    resetEnvCache();
    const status = JSON.stringify(publicConfigStatus());
    expect(status).not.toContain(SECRET);
    expect(status).not.toContain("test-session-secret");
    expect(JSON.parse(status).openai).toMatchObject({ configured: true, hasKey: true });
  });

  it("does not pass app secrets into the build worker environment", () => {
    process.env.OPENAI_API_KEY = SECRET;
    const scrubbed = JSON.stringify(scrubbedEnv());
    expect(scrubbed).not.toContain(SECRET);
    expect(scrubbed).not.toContain("DATABASE_URL");
    expect(scrubbed).not.toContain("SESSION_SECRET");
  });

  it("keeps server-only modules out of client code", () => {
    const root = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(e.name)) {
          const src = fs.readFileSync(p, "utf8");
          if (!/^["']use client["']/m.test(src)) continue;
          // Type-only imports are erased; value imports from server code are not allowed.
          for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["'](@\/server\/[^"']+|@\/generated\/[^"']+)["']/gm)) offenders.push(`${path.relative(root, p)} -> ${m[1]}`);
          if (/process\.env\.(OPENAI|SESSION|DATABASE|S3_|VERCEL|MESHY|ELEVENLABS)/.test(src)) offenders.push(`${path.relative(root, p)} reads a server env var`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    // Every server module that touches secrets is marked server-only.
    for (const f of ["server/env.ts", "server/ai/openai-provider.ts", "server/auth/session.ts", "server/db/client.ts"]) {
      expect(fs.readFileSync(path.join(root, f), "utf8")).toMatch(/^import "server-only";/m);
    }
  });

  it("documents placeholders only in .env.example", () => {
    const example = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    expect(example).toMatch(/^OPENAI_API_KEY=$/m);
    expect(example).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    // No variable is exposed to the browser bundle.
    expect(example).not.toMatch(/^NEXT_PUBLIC_/m);
  });

  it("allows local single-user mode in production and requires explicit opt-in for accounts", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.AI_PROVIDER = "mock";
    resetEnvCache();
    expect(() => env()).toThrow(/test-only/);
    process.env.AI_PROVIDER = "openai";
    process.env.AUTH_MODE = "local";
    resetEnvCache();
    expect(() => env()).not.toThrow();
    expect(authMode()).toBe("local");
    delete process.env.AUTH_MODE;
    resetEnvCache();
    expect(authMode()).toBe("local");
    process.env.AUTH_MODE = "accounts";
    resetEnvCache();
    expect(authMode()).toBe("accounts");
    process.env.AI_PROVIDER = "mock";
  });
});

describe("authentication and request protection", () => {
  it("hashes passwords with scrypt and verifies them", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\$/);
    expect(h).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "!local-mode-no-password")).toBe(false);
  });

  it("rejects cross-origin and opaque-origin (sandboxed preview) mutations", () => {
    const req = (headers: Record<string, string>, method = "POST") => new Request("http://app.local/api/projects", { method, headers: { host: "app.local", ...headers } });
    expect(checkOrigin(req({ origin: "http://app.local" }))).toBe(true);
    expect(checkOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(checkOrigin(req({ origin: "null" }))).toBe(false);
    expect(checkOrigin(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(checkOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(checkOrigin(req({ origin: "https://evil.example" }, "GET"))).toBe(true);
  });

  it("rate limits per key within a window", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000).ok).toBe(true);
    const r = rateLimit("k", 3, 60_000);
    expect(r.ok).toBe(false);
    expect(rateLimit("other", 3, 60_000).ok).toBe(true);
  });

  it("enforces request body size limits and JSON validation", async () => {
    const big = new Request("http://x", { method: "POST", body: JSON.stringify({ a: "x".repeat(5000) }) });
    await expect(readJson(big, z.object({ a: z.string() }), 1000)).rejects.toMatchObject({ status: 413 });
    await expect(readJson(new Request("http://x", { method: "POST", body: "{nope" }), z.object({}))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(new Request("http://x", { method: "POST", body: '{"a":1}' }), z.object({ a: z.string() }))).rejects.toBeInstanceOf(z.ZodError);
  });

  it("only accepts server-generated storage keys and safe static paths", () => {
    expect(() => assertStorageKey("user1/abcdefgh12345678.png")).not.toThrow();
    for (const k of ["../x/abcdefgh.png", "user1/../../etc.png", "a/b/c.png", "user1/short.png"]) expect(() => assertStorageKey(k)).toThrow();
    expect(safeJoin("/root", ["a", "..", "..", "x"])).toBeNull();
    expect(safeJoin("/root", ["a\\..\\x"])).toBeNull();
    expect(safeJoin(path.resolve("/root"), ["a", "b.js"])).toBe(path.resolve("/root", "a", "b.js"));
  });
});
