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
      exclude: [
        "lib/**/*.d.ts",
        // React context providers and Expo API wrappers — integration surface,
        // tested via Maestro; not unit-testable in a Node/vitest environment.
        "lib/customer-auth-context.tsx",
        "lib/mate-auth-context.tsx",
        "lib/push-notifications.ts",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
      },
    },
  },
});
