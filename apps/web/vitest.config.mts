import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { config as dotenvConfig } from "dotenv";

// Load .env.test so DATABASE_URL_TEST is available at config time
dotenvConfig({ path: new URL("../../.env.test", import.meta.url).pathname });

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Default to node for API route integration tests.
    // Component tests override per-file with: // @vitest-environment jsdom
    environment: "node",
    passWithNoTests: true,
    // Run test files sequentially — they share a single-tenant DB (operators.limit(1))
    // and parallel files would conflict on which operator the route picks up.
    fileParallelism: false,
    // Point route handlers at the test DB branch
    env: {
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? "",
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-chars-long",
      CRON_SECRET: process.env.CRON_SECRET ?? "test-cron-secret",
      STRIPE_SECRET_KEY: "sk_test_placeholder",
      STRIPE_CONNECTED_ACCOUNT_ID: "acct_test_placeholder",
    },
    setupFiles: ["./src/test/setup.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/**/*.d.ts",
        "src/test/**",
        "src/app/layout.tsx",
        "src/app/globals.css",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
