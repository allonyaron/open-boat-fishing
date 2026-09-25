import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { testDb } from "../db-helpers";
import { rateLimits } from "@openboat/db";

vi.mock("@/lib/env", () => ({
  env: { PLATFORM_SECRET: "test-platform-secret" },
}));
vi.mock("@/lib/platform-session", () => ({
  getPlatformSession: vi.fn(),
}));

import { getPlatformSession } from "@/lib/platform-session";

function req(body: unknown, ip: string) {
  return new NextRequest("http://localhost/api/platform/auth", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
}

describe("POST /api/platform/auth — PLATFORM_SECRET configured", () => {
  beforeEach(async () => {
    await testDb.delete(rateLimits);
  });

  it("returns 401 for the wrong secret", async () => {
    const { POST } = await import("@/app/api/platform/auth/route");
    const res = await POST(req({ secret: "not-it" }, "10.2.1.1"));
    expect(res.status).toBe(401);
  });

  it("returns 200 and saves the session for the correct secret", async () => {
    const session: any = { authenticated: false, save: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(getPlatformSession).mockResolvedValue(session);

    const { POST } = await import("@/app/api/platform/auth/route");
    const res = await POST(req({ secret: "test-platform-secret" }, "10.2.1.2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(session.authenticated).toBe(true);
    expect(session.save).toHaveBeenCalled();
  });
});
