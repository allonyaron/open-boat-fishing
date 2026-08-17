/**
 * 429 smoke tests — one per rate-limited auth route.
 * Proves the checkRateLimit call is actually wired up in each handler.
 * Not exhaustive: just N+1 requests → last is 429.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import { rateLimits } from "@openboat/db";

// Mock email so OTP request tests don't need a real SMTP connection
vi.mock("@/lib/email", () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendBookingConfirmation: vi.fn().mockResolvedValue(undefined),
}));

let ctx: Awaited<ReturnType<typeof seedOperator>>;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

async function clearRateLimits() {
  await testDb.delete(rateLimits);
}

describe("Rate limit smoke — auth routes return 429 after limit", () => {
  it("POST /api/auth/request — 429 on 6th request to same email (email limit 5/hr)", async () => {
    await clearRateLimits();
    const { POST } = await import("@/app/api/auth/request/route");
    const email = "rl-smoke-otp@test.com";
    const makeReq = () =>
      new NextRequest("http://localhost/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: JSON.stringify({ email }),
      });

    for (let i = 0; i < 5; i++) await POST(makeReq());
    const res = await POST(makeReq());
    expect(res.status).toBe(429);
  });

  it("POST /api/auth/verify — 429 on 11th request to same email (email limit 10/15min)", async () => {
    await clearRateLimits();
    const { POST } = await import("@/app/api/auth/verify/route");
    const email = "rl-smoke-verify@test.com";
    const makeReq = () =>
      new NextRequest("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: "123456" }),
      });

    for (let i = 0; i < 10; i++) await POST(makeReq());
    const res = await POST(makeReq());
    expect(res.status).toBe(429);
  });

  it("POST /api/mate/auth — 429 on 6th request to same email (email limit 5/15min)", async () => {
    await clearRateLimits();
    const { POST } = await import("@/app/api/mate/auth/route");
    const email = "rl-smoke-pin@test.com";
    const makeReq = () =>
      new NextRequest("http://localhost/api/mate/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin: "0000" }),
      });

    for (let i = 0; i < 5; i++) await POST(makeReq());
    const res = await POST(makeReq());
    expect(res.status).toBe(429);
  });

  it("POST /api/admin/auth/login — 429 on 11th request from same IP (IP limit 10/15min)", async () => {
    await clearRateLimits();
    const { POST } = await import("@/app/api/admin/auth/login/route");
    const makeReq = () =>
      new NextRequest("http://localhost/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.2" },
        body: JSON.stringify({ email: "admin@test.com", password: "wrong" }),
      });

    for (let i = 0; i < 10; i++) await POST(makeReq());
    const res = await POST(makeReq());
    expect(res.status).toBe(429);
  });
});
