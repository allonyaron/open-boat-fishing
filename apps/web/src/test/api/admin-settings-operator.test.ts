import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";

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

function getReq(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function patchReq(path: string, body: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/admin/settings/operator", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { GET } = await import("@/app/api/admin/settings/operator/route");
    const res = await GET(getReq("/api/admin/settings/operator"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the operator row", async () => {
    const { GET } = await import("@/app/api/admin/settings/operator/route");
    const res = await GET(getReq("/api/admin/settings/operator"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(ctx.operatorId);
  });
});

describe("PATCH /api/admin/settings/operator", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { PATCH } = await import("@/app/api/admin/settings/operator/route");
    const res = await PATCH(patchReq("/api/admin/settings/operator", { name: "New Name" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-integer arriveMinutesBefore", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/operator/route");
    const res = await PATCH(patchReq("/api/admin/settings/operator", { arriveMinutesBefore: "soon" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a negative cancelWindowHrs", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/operator/route");
    const res = await PATCH(patchReq("/api/admin/settings/operator", { cancelWindowHrs: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a negative settleGraceHrs", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/operator/route");
    const res = await PATCH(patchReq("/api/admin/settings/operator", { settleGraceHrs: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 200 and updates contact fields", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/operator/route");
    const res = await PATCH(
      patchReq("/api/admin/settings/operator", {
        name: "Updated Operator Name",
        phone: "555-0100",
        dockAddress: "1 Harbor Way",
        arriveMinutesBefore: 30,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Updated Operator Name");
    expect(body.phone).toBe("555-0100");
    expect(body.arriveMinutesBefore).toBe(30);

    const [row] = await testDb.select().from(operators).where(eq(operators.id, ctx.operatorId));
    expect(row.name).toBe("Updated Operator Name");
    expect(row.dockAddress).toBe("1 Harbor Way");
  });

  it("returns 200 and clears arriveMinutesBefore when set to null", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/operator/route");
    const res = await PATCH(patchReq("/api/admin/settings/operator", { arriveMinutesBefore: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.arriveMinutesBefore).toBeNull();
  });
});
