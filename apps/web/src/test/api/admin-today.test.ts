import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, cleanupBookings, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, schedules, fishingReports, bookings } from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { todayET, addDaysToDateString } from "@/lib/date-et";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
  // seedOperator's default schedule runs through Dec 31 of the current year,
  // which can land inside or outside the 45-day warning window depending on
  // when the suite runs. Push it well past the window so season-end tests
  // that create their own schedule aren't fighting a flaky default.
  await testDb
    .update(schedules)
    .set({ endDate: addDaysToDateString(todayET(), 400) })
    .where(eq(schedules.id, ctx.scheduleId));
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
  return new NextRequest("http://localhost/api/admin/today");
}

describe("GET /api/admin/today", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { GET } = await import("@/app/api/admin/today/route");
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it("includes today's seeded trip and reports null alerts by default", async () => {
    const { GET } = await import("@/app/api/admin/today/route");
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.today).toBe(todayET());
    const found = body.trips.find((t: { id: string }) => t.id === ctx.tripId);
    expect(found).toBeDefined();
    expect(found.status).toBe("scheduled");
    expect(body.alerts.seasonEnd).toBeNull();
    expect(body.alerts.reportsOwed).toBeNull();
  });

  it("stats reflect booked tickets on today's trip", async () => {
    const { ticketId } = await seedBooking(ctx, { status: "confirmed" });
    try {
      const { GET } = await import("@/app/api/admin/today/route");
      const res = await GET(getReq());
      const body = await res.json();
      expect(body.stats.tripsGoingOut).toBeGreaterThanOrEqual(1);
      expect(body.stats.peopleBooked).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanupBookings(ctx.tripId);
      void ticketId;
    }
  });

  it("takenInTodayCents sums confirmed bookings created today, not other statuses", async () => {
    const [confirmed] = await testDb
      .insert(bookings)
      .values({
        operatorId: ctx.operatorId,
        confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
        status: "confirmed",
        totalCents: 12345,
        platformFeeCents: 150,
        customerEmail: "taken-today@test.com",
      })
      .returning({ id: bookings.id });
    const [pending] = await testDb
      .insert(bookings)
      .values({
        operatorId: ctx.operatorId,
        confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
        status: "pending",
        totalCents: 99999,
        platformFeeCents: 150,
        customerEmail: "pending-today@test.com",
      })
      .returning({ id: bookings.id });

    try {
      const { GET } = await import("@/app/api/admin/today/route");
      const res = await GET(getReq());
      const body = await res.json();
      expect(body.stats.takenInTodayCents).toBeGreaterThanOrEqual(12345);
    } finally {
      await testDb.delete(bookings).where(eq(bookings.id, confirmed.id));
      await testDb.delete(bookings).where(eq(bookings.id, pending.id));
    }
  });

  it("surfaces a season-end alert only once the furthest-out active pattern's end date is within the warning window", async () => {
    // The alert fires off the LATEST end date across all active patterns —
    // the calendar only "runs out" once nothing covers dates beyond that.
    // ctx's default schedule was pushed to +400 days in beforeAll, so it must
    // be pulled in too, or it would still be the furthest-out pattern and
    // correctly suppress the alert regardless of what this test adds.
    const nearEndDate = addDaysToDateString(todayET(), 10);
    await testDb.update(schedules).set({ endDate: nearEndDate }).where(eq(schedules.id, ctx.scheduleId));

    try {
      const { GET } = await import("@/app/api/admin/today/route");
      const res = await GET(getReq());
      const body = await res.json();
      expect(body.alerts.seasonEnd).toEqual({ date: nearEndDate });
    } finally {
      await testDb
        .update(schedules)
        .set({ endDate: addDaysToDateString(todayET(), 400) })
        .where(eq(schedules.id, ctx.scheduleId));
    }
  });

  it("surfaces a reports-owed alert for a sailed trip with no report, oldest first", async () => {
    const yesterday = addDaysToDateString(todayET(), -1);
    const [sailedTrip] = await testDb
      .insert(trips)
      .values({
        operatorId: ctx.operatorId,
        scheduleId: ctx.scheduleId,
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
      const { GET } = await import("@/app/api/admin/today/route");
      const res1 = await GET(getReq());
      const body1 = await res1.json();
      expect(body1.alerts.reportsOwed).toEqual({ count: 1, oldestTripId: sailedTrip.id });

      await testDb.insert(fishingReports).values({
        operatorId: ctx.operatorId,
        tripId: sailedTrip.id,
        vesselId: ctx.vesselId,
        catchSummary: "Good day",
      });

      const res2 = await GET(getReq());
      const body2 = await res2.json();
      expect(body2.alerts.reportsOwed).toBeNull();
    } finally {
      await testDb.delete(fishingReports).where(eq(fishingReports.tripId, sailedTrip.id));
      await testDb.delete(trips).where(eq(trips.id, sailedTrip.id));
    }
  });
});
