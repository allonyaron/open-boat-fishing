import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

vi.mock("@/lib/env", () => ({
  env: {
    STRIPE_CLIENT_ID: "ca_test_client_id",
    SESSION_SECRET: process.env.SESSION_SECRET,
  },
}));
vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
  vi.mocked(requireAdmin).mockResolvedValue({
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  } as any);
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req() {
  return new NextRequest("http://localhost/api/stripe/connect/start");
}

describe("GET /api/stripe/connect/start — STRIPE_CLIENT_ID configured", () => {
  it("redirects to Stripe's OAuth authorize URL with the expected params and sets a signed nonce cookie", async () => {
    const { GET } = await import("@/app/api/stripe/connect/start/route");
    const res = await GET(req());

    expect(res.status).toBe(307);
    const location = res.headers.get("location")!;
    const url = new URL(location);
    expect(url.origin + url.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("ca_test_client_id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read_write");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost/api/stripe/connect/callback");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();

    const cookie = res.cookies.get("stripe_connect_nonce");
    expect(cookie).toBeDefined();
    expect(cookie!.value).toHaveLength(32); // randomBytes(16).toString("hex")
  });
});
