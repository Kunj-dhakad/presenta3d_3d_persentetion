import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const missing = ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"].filter((key) => !process.env[key]?.trim());
if (missing.length) {
  console.error(`RDS MySQL configuration is required. Missing: ${missing.join(", ")}`);
  process.exit(1);
}

