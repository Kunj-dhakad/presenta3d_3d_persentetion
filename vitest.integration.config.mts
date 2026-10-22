import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@/server/db/client": path.resolve(import.meta.dirname, "tests/support/db-client.ts"),
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
