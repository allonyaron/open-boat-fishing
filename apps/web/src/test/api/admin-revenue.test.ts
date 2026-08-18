import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

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

describe("GET /api/admin/revenue", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { GET } = await import("@/app/api/admin/revenue/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/revenue"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with expected data shape", async () => {
    const { GET } = await import("@/app/api/admin/revenue/route");
    const res = await GET(
      new NextRequest("http://localhost/api/admin/revenue?from=2000-01-01&to=2099-12-31"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("fromDate", "2000-01-01");
    expect(body).toHaveProperty("toDate", "2099-12-31");
    expect(body.totals).toMatchObject({
      earnedCents: expect.any(Number),
      heldCents: expect.any(Number),
      reversedCents: expect.any(Number),
      earnedCount: expect.any(Number),
      heldCount: expect.any(Number),
      reversedCount: expect.any(Number),
    });
    expect(Array.isArray(body.trips)).toBe(true);
  });
});
