import fs from "node:fs";

// Next.js SSR needs selected Amplify variables in a recognized env file.
// JSON quoting protects whitespace/newlines; escaping $ prevents dotenv-expand
// from treating literal characters in passwords and tokens as variable names.
const keys = [
  "MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD",
  "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_IMAGE_MODEL", "OPENAI_VIDEO_MODEL", "OPENAI_TTS_MODEL",
  "OPENAI_PRICE_INPUT_PER_1M", "OPENAI_PRICE_OUTPUT_PER_1M", "OPENAI_TIMEOUT_MS", "OPENAI_BASE_URL", "AI_PROVIDER",
  "AUTH_MODE", "SESSION_SECRET", "APP_ORIGIN", "PREVIEW_ORIGIN", "STORAGE_DRIVER",
  "S3_BUCKET", "S3_REGION", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
  "KD_AWS_REGION", "KD_AWS_S3_BUCKET_NAME", "KD_AWS_ACCESS_KEY_ID", "KD_AWS_SECRET_ACCESS_KEY",
  "PUBLISH_PROVIDER", "VERCEL_TOKEN", "VERCEL_TEAM_ID", "MESHY_API_KEY", "ELEVENLABS_API_KEY",
  "MAX_REPAIR_ATTEMPTS", "AGENT_CONCURRENCY", "GENERATION_RATE_LIMIT_PER_MIN", "DATA_DIR",
];

const lines = keys
  .filter((key) => Object.hasOwn(process.env, key))
  .map((key) => `${key}=${JSON.stringify(process.env[key]).replaceAll("$", "\\$")}`);

fs.writeFileSync(".env.production", `${lines.join("\n")}\n`, { mode: 0o600 });
