import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build (`npm run build` first) with
 * the deterministic offline test provider and an isolated database, so they
 * need no API key and never touch the development database.
 */
const PORT = 3200;
const DB = "file:./.data/e2e-playwright.db";
const env = {
  AI_PROVIDER: "mock",
  STRATA_ALLOW_MOCK: "1",
  APP_ORIGIN: `http://localhost:${PORT}`,
  DATABASE_URL: DB,
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
    command: `npx prisma migrate deploy && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env,
  },
});
