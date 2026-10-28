import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * End-to-end tests use a separate disposable RDS database so the application
 * runtime and test runtime exercise the same MySQL adapter.
 */
const PORT = 3200;
const database = process.env.E2E_MYSQL_DATABASE;
if (!database) throw new Error("Set E2E_MYSQL_DATABASE to a separate disposable RDS database before running Playwright.");
const env = {
  // The app runs inside the PHP app's iframe; tests/e2e/support.ts plays that page and makes its tokens.
  PHP_TOKEN_KEY: "e2e-php-token-key",
  // Lets the simulated PHP page frame the app (next.config.ts frame-ancestors). Read at build time:
  // build with FRAME_ANCESTORS=http://php.localhost before running the e2e tests.
  FRAME_ANCESTORS: "http://php.localhost",
  AI_PROVIDER: "mock",
  ALLOW_MOCK_AI: "1",
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
  // Short generation steps, so every test also exercises a job resuming across several requests
  // (on serverless hosts each step must end within about a minute).
  JOB_STEP_BUDGET_MS: process.env.E2E_JOB_STEP_BUDGET_MS ?? "16000",
  STORAGE_DRIVER: process.env.E2E_STORAGE_DRIVER ?? "local",
};

// The simulated PHP page (tests/e2e/support.ts) has no real address, so Chromium would treat it as a
// public site and block it from framing localhost. Real deployments are public→public or local→local.
const chromiumArgs = ["--disable-features=LocalNetworkAccessChecks"];

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 1440, height: 900 } },
  // E2E_BROWSERS=chromium,firefox runs a subset.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { args: chromiumArgs } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    { name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge", viewport: { width: 1440, height: 900 }, launchOptions: { args: chromiumArgs } } },
  ].filter((p) => !process.env.E2E_BROWSERS || process.env.E2E_BROWSERS.split(",").includes(p.name)),
  webServer: {
    command: `npm run db:deploy && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env,
  },
});
