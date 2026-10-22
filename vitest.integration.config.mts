import { defineConfig } from "vitest/config";
import path from "node:path";

/** Live OpenAI integration tests. They use your real OPENAI_API_KEY / OPENAI_MODEL and cost a little money. */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/support/setup-integration.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
