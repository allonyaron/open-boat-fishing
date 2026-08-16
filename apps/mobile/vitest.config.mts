import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // React Native / Metro global; set false in test env (no dev server)
    __DEV__: false,
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["lib/**"],
      exclude: ["lib/**/*.d.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
