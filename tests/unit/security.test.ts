import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, randomBytes } from "node:crypto";
import { env, publicConfigStatus, resetEnvCache } from "@/server/env";
import { decodePhpToken, ownerIdFor } from "@/server/auth/php-token";
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
  delete process.env.PHP_TOKEN_KEY;
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
    for (const f of ["server/env.ts", "server/ai/openai-provider.ts", "server/auth/php-token.ts", "server/db/client.ts"]) {
      expect(fs.readFileSync(path.join(root, f), "utf8")).toMatch(/^import "server-only";/m);
    }
  });

  it("documents placeholders only in .env.example", () => {
    const example = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    expect(example).toMatch(/^OPENAI_API_KEY=$/m);
    expect(example).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    // Only the parent-page allow-list (no secret) is exposed to the browser bundle.
    expect(example.match(/^NEXT_PUBLIC_\w+/gm) ?? []).toEqual(["NEXT_PUBLIC_PARENT_ORIGINS"]);
  });

  it("refuses the mock AI provider in production", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.AI_PROVIDER = "mock";
    resetEnvCache();
    expect(() => env()).toThrow(/test-only/);
    process.env.AI_PROVIDER = "openai";
    resetEnvCache();
    expect(() => env()).not.toThrow();
    process.env.AI_PROVIDER = "mock";
  });
});

describe("authentication and request protection", () => {
  /** What PHP's encrypt_user_token() produces (application/helpers/tokengenerate_helper.php). */
  function phpToken(data: string, passphrase = "your-256-bit-secret") {
    const key = Buffer.alloc(32);
    Buffer.from(passphrase).copy(key);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]).toString("base64");
    return Buffer.concat([iv, Buffer.from(encrypted)]).toString("base64");
  }

  it("reads the PHP app's access tokens and nothing else", () => {
    const identity = decodePhpToken(phpToken("user_id=2:business_id=7"));
    expect(identity).toEqual({ userId: "2", businessId: "7" });
    expect(ownerIdFor(identity!)).toBe("7_2");
    // A real token from the PHP app's database.
    expect(decodePhpToken("kxlSGdm7D6ZTYpJ0yvvh9XQ1Zi9wSGU3YzlBYTN5RnNEeE9PQWQ3QlA4WU0yeExLVDBWNmlRaWhIRlE9")).toEqual({ userId: "2", businessId: "2" });
    expect(decodePhpToken("")).toBeNull();
    expect(decodePhpToken("not a token")).toBeNull();
    expect(decodePhpToken(phpToken("user_id=x:business_id=7"))).toBeNull();
    expect(decodePhpToken(phpToken("user_id=2:business_id=7", "another-key"))).toBeNull();
    process.env.PHP_TOKEN_KEY = "another-key";
    resetEnvCache();
    expect(decodePhpToken(phpToken("user_id=2:business_id=7", "another-key"))).toEqual({ userId: "2", businessId: "7" });
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
