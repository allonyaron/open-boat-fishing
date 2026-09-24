import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, fishingReports } from "@openboat/db";
import { eq } from "drizzle-orm";
import { todayET, addDaysToDateString } from "@/lib/date-et";

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

function getReq() {
  return new NextRequest("http://localhost/api/admin/reports/pending");
}

describe("GET /api/admin/reports/pending", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { GET } = await import("@/app/api/admin/reports/pending/route");
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it("lists a sailed trip with no report, and excludes it once one is posted", async () => {
    const yesterday = addDaysToDateString(todayET(), -1);
    // scheduleId: null — avoids any chance of colliding with ctx.tripId's own
    // (schedule_id, departure_date) row during the UTC/ET day-boundary window.
    const [sailedTrip] = await testDb
      .insert(trips)
      .values({
        operatorId: ctx.operatorId,
        scheduleId: null,
        vesselId: ctx.vesselId,
        productId: ctx.productId,
        departureDate: yesterday,
        startTime: new Date(`${yesterday}T07:00:00Z`),
        endTime: new Date(`${yesterday}T12:00:00Z`),
        capacity: 20,
        seatsRemaining: 20,
        status: "sailed",
      })
      .returning({ id: trips.id });

    try {
      const { GET } = await import("@/app/api/admin/reports/pending/route");
      const res1 = await GET(getReq());
      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      const found = body1.find((t: { id: string }) => t.id === sailedTrip.id);
      expect(found).toBeDefined();
      expect(found.vessel).toBeDefined();
      expect(found.product).toBeDefined();

      await testDb.insert(fishingReports).values({
        operatorId: ctx.operatorId,
        tripId: sailedTrip.id,
        vesselId: ctx.vesselId,
        catchSummary: "Good day",
      });

      const res2 = await GET(getReq());
      const body2 = await res2.json();
      expect(body2.find((t: { id: string }) => t.id === sailedTrip.id)).toBeUndefined();
    } finally {
      await testDb.delete(fishingReports).where(eq(fishingReports.tripId, sailedTrip.id));
      await testDb.delete(trips).where(eq(trips.id, sailedTrip.id));
    }
  });

  it("does not list a scheduled (future) trip even with no report", async () => {
    // ctx's own default trip departs at a fixed 7am ET "today" — once the
    // suite runs past that hour, settleTrips() legitimately (and correctly)
    // flips it to pending_settlement, which IS report-eligible. Seed an
    // explicit far-future trip instead so this test isn't time-of-day
    // dependent. scheduleId: null avoids any (schedule_id, departure_date)
    // collision risk with ctx's own row.
    const future = addDaysToDateString(todayET(), 10);
    const [futureTrip] = await testDb
      .insert(trips)
      .values({
        operatorId: ctx.operatorId,
        scheduleId: null,
        vesselId: ctx.vesselId,
        productId: ctx.productId,
        departureDate: future,
        startTime: new Date(`${future}T07:00:00Z`),
        endTime: new Date(`${future}T12:00:00Z`),
        capacity: 20,
        seatsRemaining: 20,
        status: "scheduled",
      })
      .returning({ id: trips.id });

    try {
      const { GET } = await import("@/app/api/admin/reports/pending/route");
      const res = await GET(getReq());
      const body = await res.json();
      expect(body.find((t: { id: string }) => t.id === futureTrip.id)).toBeUndefined();
    } finally {
      await testDb.delete(trips).where(eq(trips.id, futureTrip.id));
    }
  });
});
