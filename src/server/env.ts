import "server-only";
import { z } from "zod";

/**
 * Server-side configuration. Every secret is read here and nowhere else, so it is
 * easy to audit that none of them reach client bundles (this module imports
 * `server-only`, which makes any client import a build error).
 */

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? Number(v) : undefined))
  .refine((v) => v === undefined || Number.isFinite(v), "must be a number");

const intWithDefault = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number.parseInt(v, 10) : def))
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, `must be an integer in [${min}, ${max}]`);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OPENAI_IMAGE_MODEL: optionalString,
  OPENAI_VIDEO_MODEL: optionalString,
  OPENAI_TTS_MODEL: optionalString,
  OPENAI_PRICE_INPUT_PER_1M: optionalNumber,
  OPENAI_PRICE_OUTPUT_PER_1M: optionalNumber,
  OPENAI_TIMEOUT_MS: intWithDefault(120_000, 5_000, 600_000),
  OPENAI_BASE_URL: optionalString,
  AI_PROVIDER: z.enum(["openai", "mock"]).default("openai"),
  /** local = single local user, no sign-in (development only); accounts = email/password sign-in. */
  AUTH_MODE: z.enum(["local", "accounts"]).optional(),
  DATABASE_URL: z.string().default("file:./.data/strata.db"),
  MYSQL_HOST: optionalString,
  MYSQL_PORT: intWithDefault(3306, 1, 65535),
  MYSQL_DATABASE: optionalString,
  MYSQL_USER: optionalString,
  MYSQL_PASSWORD: optionalString,
  SESSION_SECRET: optionalString,
  APP_ORIGIN: optionalString,
  PREVIEW_ORIGIN: optionalString,
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: optionalString,
  S3_REGION: optionalString,
  S3_ENDPOINT: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  KD_AWS_REGION: optionalString,
  KD_AWS_S3_BUCKET_NAME: optionalString,
  KD_AWS_ACCESS_KEY_ID: optionalString,
  KD_AWS_SECRET_ACCESS_KEY: optionalString,
  PUBLISH_PROVIDER: z.enum(["local", "vercel"]).default("local"),
  VERCEL_TOKEN: optionalString,
  VERCEL_TEAM_ID: optionalString,
  MESHY_API_KEY: optionalString,
  ELEVENLABS_API_KEY: optionalString,
  MAX_REPAIR_ATTEMPTS: intWithDefault(2, 0, 5),
  AGENT_CONCURRENCY: intWithDefault(3, 1, 8),
  GENERATION_RATE_LIMIT_PER_MIN: intWithDefault(6, 1, 120),
  DATA_DIR: z.string().default(".data"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Report which variables are invalid, never their values.
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.AI_PROVIDER === "mock" && !process.env.STRATA_ALLOW_MOCK) {
    throw new Error("AI_PROVIDER=mock is a test-only setting and is refused in production.");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.AUTH_MODE === "local") {
    throw new Error("AUTH_MODE=local disables sign-in and is refused in production. Use AUTH_MODE=accounts.");
  }
  cached = parsed.data;
  return cached;
}

/** For tests: drop the memoized configuration so process.env changes apply. */
export function resetEnvCache() {
  cached = null;
}

const DEV_SESSION_SECRET = "strata-dev-only-session-secret-change-me-0000";

export function sessionSecret(): string {
  const e = env();
  if (e.SESSION_SECRET && e.SESSION_SECRET.length >= 32) return e.SESSION_SECRET;
  if (e.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (>= 32 chars) in production.");
  }
  return DEV_SESSION_SECRET;
}

/** Single-user local mode: default outside production, never allowed in production. */
export function authMode(): "local" | "accounts" {
  const e = env();
  if (e.NODE_ENV === "production") return "accounts";
  return e.AUTH_MODE ?? "local";
}

/** Non-secret summary of configuration that is safe to show in the UI. */
export function publicConfigStatus() {
  const e = env();
  return {
    aiProvider: e.AI_PROVIDER,
    authMode: authMode(),
    openai: {
      configured: Boolean(e.OPENAI_API_KEY && e.OPENAI_MODEL),
      hasKey: Boolean(e.OPENAI_API_KEY),
      model: e.OPENAI_MODEL ?? null,
      imageModel: e.OPENAI_IMAGE_MODEL ?? null,
      videoModel: e.OPENAI_VIDEO_MODEL ?? null,
      ttsModel: e.OPENAI_TTS_MODEL ?? null,
      pricingConfigured: e.OPENAI_PRICE_INPUT_PER_1M !== undefined && e.OPENAI_PRICE_OUTPUT_PER_1M !== undefined,
    },
    storage: e.STORAGE_DRIVER,
    publish: {
      provider: e.PUBLISH_PROVIDER,
      publicHosting: e.PUBLISH_PROVIDER === "vercel" && Boolean(e.VERCEL_TOKEN),
    },
    external: {
      model3d: Boolean(e.MESHY_API_KEY),
      soundEffects: Boolean(e.ELEVENLABS_API_KEY),
    },
    previewOrigin: e.PREVIEW_ORIGIN ?? null,
    limits: {
      maxRepairAttempts: e.MAX_REPAIR_ATTEMPTS,
      agentConcurrency: e.AGENT_CONCURRENCY,
      generationRatePerMin: e.GENERATION_RATE_LIMIT_PER_MIN,
    },
  };
}

export type PublicConfigStatus = ReturnType<typeof publicConfigStatus>;
