import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/global-setup";

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e",
  use: {
    baseURL: BASE_URL,
    video: "off",
    trace: "off",
  },
  timeout: 60_000,
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
