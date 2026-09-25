import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

// DEMO_MODE is not set in vitest.config.ts's test env block, so env.DEMO_MODE
// is undefined here — this file exercises the "disabled" (default) path.
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

function adminSession() {
  return {
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  };
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue(adminSession() as any);
});

function postReq() {
  return new NextRequest("http://localhost/api/admin/demo/clear-customers", { method: "POST" });
}

describe("POST /api/admin/demo/clear-customers — DEMO_MODE disabled", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { POST } = await import("@/app/api/admin/demo/clear-customers/route");
    const res = await POST(postReq());
    expect(res.status).toBe(401);
  });

  it("returns 403 when DEMO_MODE is not enabled", async () => {
    const { POST } = await import("@/app/api/admin/demo/clear-customers/route");
    const res = await POST(postReq());
    expect(res.status).toBe(403);
  });
});
