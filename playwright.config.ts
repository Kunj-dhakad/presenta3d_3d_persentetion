import { defineConfig, devices } from "@playwright/test";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

/**
 * End-to-end tests use a separate disposable RDS database so the application
 * runtime and test runtime exercise the same MySQL adapter.
 */
const PORT = 3200;
const database = process.env.E2E_MYSQL_DATABASE;
if (!database) throw new Error("Set E2E_MYSQL_DATABASE to a separate disposable RDS database before running Playwright.");
const env = {
  AI_PROVIDER: "mock",
  STRATA_ALLOW_MOCK: "1",
  APP_ORIGIN: `http://localhost:${PORT}`,
  MYSQL_HOST: process.env.MYSQL_HOST ?? "",
  MYSQL_PORT: process.env.MYSQL_PORT ?? "3306",
  MYSQL_DATABASE: database,
  MYSQL_USER: process.env.MYSQL_USER ?? "",
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? "",
  DATA_DIR: ".data/e2e-playwright",
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef-0123456789",
  // A sentinel "secret" that must never appear in any response delivered to the browser.
  OPENAI_API_KEY: "sk-e2e-SENTINEL-must-not-leak-0000",
  OPENAI_MODEL: "",
  GENERATION_RATE_LIMIT_PER_MIN: "60",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npm run db:deploy && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env,
  },
});
