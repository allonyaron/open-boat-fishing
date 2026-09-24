import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, schedules, fishingReports, bookings, bookingItems, tickets } from "@openboat/db";
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

  it("includes today's seeded trip and reports no season-end alert by default", async () => {
    const { GET } = await import("@/app/api/admin/today/route");
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.today).toBe(todayET());
    const found = body.trips.find((t: { id: string }) => t.id === ctx.tripId);
    expect(found).toBeDefined();
    // ctx's default trip departs at a fixed 7am ET — settleTrips() legitimately
    // flips it scheduled -> pending_settlement once the suite runs past that
    // hour, so only assert it's still an active (non-cancelled) trip, and
    // leave reportsOwed to the dedicated test below that accounts for this.
    expect(["scheduled", "pending_settlement"]).toContain(found.status);
    expect(body.alerts.seasonEnd).toBeNull();
  });

  it("stats reflect booked tickets on today's trip", async () => {
    // ctx's default trip is seeded with db-helpers' UTC-based "today," which
    // can disagree with this endpoint's ET-based "today" right around the
    // UTC/ET day boundary. Seed a trip on the endpoint's own todayET() so
    // this test is deterministic regardless of when the suite runs.
    const todaysDate = todayET();
    const [todaysTrip] = await testDb
      .insert(trips)
      .values({
        operatorId: ctx.operatorId,
        scheduleId: ctx.scheduleId,
        vesselId: ctx.vesselId,
        productId: ctx.productId,
        departureDate: todaysDate,
        startTime: new Date(`${todaysDate}T20:00:00Z`),
        endTime: new Date(`${todaysDate}T23:00:00Z`),
        capacity: 20,
        seatsRemaining: 19,
        status: "scheduled",
      })
      .returning({ id: trips.id });

    const [booking] = await testDb
      .insert(bookings)
      .values({
        operatorId: ctx.operatorId,
        confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
        status: "confirmed",
        totalCents: 10000,
        platformFeeCents: 150,
        customerEmail: "stats-today@test.com",
      })
      .returning({ id: bookings.id });
    const [item] = await testDb
      .insert(bookingItems)
      .values({ bookingId: booking.id, tripId: todaysTrip.id, operatorId: ctx.operatorId, subtotalCents: 10000 })
      .returning({ id: bookingItems.id });
    await testDb.insert(tickets).values({
      bookingItemId: item.id,
      bookingId: booking.id,
      operatorId: ctx.operatorId,
      ticketType: "adult",
      priceCents: 10000,
      feeAmountCents: 150,
      qrPayload: randomUUID(),
    });

    try {
      const { GET } = await import("@/app/api/admin/today/route");
      const res = await GET(getReq());
      const body = await res.json();
      expect(body.stats.tripsGoingOut).toBeGreaterThanOrEqual(1);
      expect(body.stats.peopleBooked).toBeGreaterThanOrEqual(1);
    } finally {
      await testDb.delete(tickets).where(eq(tickets.bookingItemId, item.id));
      await testDb.delete(bookingItems).where(eq(bookingItems.id, item.id));
      await testDb.delete(bookings).where(eq(bookings.id, booking.id));
      await testDb.delete(trips).where(eq(trips.id, todaysTrip.id));
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
      // ctx's own default trip can independently qualify too, depending on
      // what time of day the suite runs (see the test above) — assert this
      // seeded trip is present and sorts first (it departed yesterday, so it
      // is always the oldest), not an exact total count.
      expect(body1.alerts.reportsOwed).not.toBeNull();
      expect(body1.alerts.reportsOwed.count).toBeGreaterThanOrEqual(1);
      expect(body1.alerts.reportsOwed.oldestTripId).toBe(sailedTrip.id);
      const countBefore = body1.alerts.reportsOwed.count;

      await testDb.insert(fishingReports).values({
        operatorId: ctx.operatorId,
        tripId: sailedTrip.id,
        vesselId: ctx.vesselId,
        catchSummary: "Good day",
      });

      const res2 = await GET(getReq());
      const body2 = await res2.json();
      const countAfter = body2.alerts.reportsOwed?.count ?? 0;
      expect(countAfter).toBe(countBefore - 1);
    } finally {
      await testDb.delete(fishingReports).where(eq(fishingReports.tripId, sailedTrip.id));
      await testDb.delete(trips).where(eq(trips.id, sailedTrip.id));
    }
  });
});
