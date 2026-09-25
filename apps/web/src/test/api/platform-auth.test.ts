import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "../db-helpers";
import { rateLimits } from "@openboat/db";

// PLATFORM_SECRET is not set in vitest.config.mts's test env block, so this
// file exercises the "not configured" default path plus rate limiting and
// logout, which don't depend on the secret being set.
vi.mock("@/lib/platform-session", () => ({
  getPlatformSession: vi.fn(),
}));

import { getPlatformSession } from "@/lib/platform-session";

function req(body: unknown, ip = "10.2.0.1") {
  return new NextRequest("http://localhost/api/platform/auth", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
}

async function clearRateLimits() {
  await testDb.delete(rateLimits);
}

describe("POST /api/platform/auth — PLATFORM_SECRET not configured", () => {
  beforeEach(async () => {
    await clearRateLimits();
  });

  it("returns 500 regardless of the secret provided", async () => {
    const { POST } = await import("@/app/api/platform/auth/route");
    const res = await POST(req({ secret: "anything" }, "10.2.0.2"));
    expect(res.status).toBe(500);
  });

  it("returns 429 on the 6th attempt from the same IP (5/15min)", async () => {
    const { POST } = await import("@/app/api/platform/auth/route");
    const ip = "10.2.0.3";
    for (let i = 0; i < 5; i++) await POST(req({ secret: "wrong" }, ip));
    const res = await POST(req({ secret: "wrong" }, ip));
    expect(res.status).toBe(429);
  });
});

describe("DELETE /api/platform/auth", () => {
  it("destroys the session and returns ok:true", async () => {
    const destroy = vi.fn();
    vi.mocked(getPlatformSession).mockResolvedValue({ destroy } as any);
    const { DELETE } = await import("@/app/api/platform/auth/route");
    const res = await DELETE(new NextRequest("http://localhost/api/platform/auth", { method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(destroy).toHaveBeenCalled();
  });
});
