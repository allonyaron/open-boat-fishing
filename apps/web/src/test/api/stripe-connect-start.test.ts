import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

// STRIPE_CLIENT_ID is not set in vitest.config.mts's test env block, so this
// file exercises the "not configured" default path.
vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue({
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  } as any);
});

function req() {
  return new NextRequest("http://localhost/api/stripe/connect/start");
}

describe("GET /api/stripe/connect/start — STRIPE_CLIENT_ID not configured", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { GET } = await import("@/app/api/stripe/connect/start/route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 500 when STRIPE_CLIENT_ID is not configured on this deployment", async () => {
    const { GET } = await import("@/app/api/stripe/connect/start/route");
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
