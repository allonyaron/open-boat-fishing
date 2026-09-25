import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { schedules, trips } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;
let otherCtx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
  otherCtx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(otherCtx.operatorId);
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

const validBody = {
  productId: "",
  startDate: "2097-03-01",
  endDate: "2097-03-07",
  daysOfWeek: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  departureTime: "07:00",
  returnTime: "12:00",
  capacity: 20,
};

beforeAll(() => {
  validBody.productId = ctx.productId;
});

function postReq(body: object) {
  return new NextRequest("http://localhost/api/admin/settings/schedules", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/admin/settings/schedules", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(401);
  });

  it("returns 400 when productId is missing", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq({ ...validBody, productId: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed startDate", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq({ ...validBody, startDate: "03/01/2097" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when endDate is before startDate", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq({ ...validBody, startDate: "2097-03-10", endDate: "2097-03-01" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty daysOfWeek array", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq({ ...validBody, daysOfWeek: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid day abbreviation", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq({ ...validBody, daysOfWeek: ["mon", "someday"] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a malformed departureTime", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq({ ...validBody, departureTime: "7am" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-positive capacity", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq({ ...validBody, capacity: 0 }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a product belonging to another operator", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq({ ...validBody, productId: otherCtx.productId }));
    expect(res.status).toBe(404);
  });

  it("returns 201 and materializes a trip per matching day in range", async () => {
    const { POST } = await import("@/app/api/admin/settings/schedules/route");
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tripsCreated).toBe(7);

    const [row] = await testDb.select().from(schedules).where(eq(schedules.id, body.id));
    expect(row.operatorId).toBe(ctx.operatorId);

    const materialized = await testDb.select().from(trips).where(eq(trips.scheduleId, body.id));
    expect(materialized).toHaveLength(7);
    expect(materialized.every((t) => t.capacity === 20 && t.seatsRemaining === 20)).toBe(true);
  });
});
