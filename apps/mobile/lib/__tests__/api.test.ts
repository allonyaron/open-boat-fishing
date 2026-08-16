import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock expo-constants before importing api.ts
vi.mock("expo-constants", () => ({
  default: {
    expoConfig: { hostUri: "192.168.1.10:8081" },
  },
}));

describe("getApiUrl", () => {
  const ORIG_ENV = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_API_URL;
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = ORIG_ENV;
    vi.resetModules();
  });

  it("returns EXPO_PUBLIC_API_URL when set", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
    const { getApiUrl } = await import("../api");
    expect(getApiUrl()).toBe("https://api.example.com");
  });

  it("throws at module load when env var is missing in production (__DEV__ = false)", async () => {
    // API_URL is evaluated eagerly at module load — the import itself rejects
    await expect(import("../api")).rejects.toThrow(
      "EXPO_PUBLIC_API_URL must be set for production builds",
    );
  });
});
