import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, bookings, bookingItems } from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

vi.mock("@/lib/push", () => ({
  sendPushToEmails: vi.fn().mockResolvedValue(undefined),
}));

import { sendPushToEmails } from "@/lib/push";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(sendPushToEmails).mockClear();
});

function cronReq() {
  return new NextRequest("http://localhost/api/cron/trip-reminders", {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}

/** Creates a trip departing `hoursFromNow` hours out, with one booking+item at the given status/email. */
async function seedTripWithBooking(
  hoursFromNow: number,
  opts: { status?: "pending" | "confirmed"; email?: string } = {},
) {
  const startTime = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
  const departureDate = startTime.toISOString().slice(0, 10);

  const [trip] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate,
      startTime,
      endTime,
      capacity: 20,
      seatsRemaining: 19,
      status: "scheduled",
    })
    .returning({ id: trips.id });

  const email = opts.email ?? `reminder-${randomUUID().slice(0, 6)}@test.com`;
  const [booking] = await testDb
    .insert(bookings)
    .values({
      operatorId: ctx.operatorId,
      confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
      status: opts.status ?? "confirmed",
      totalCents: 10000,
      platformFeeCents: 150,
      customerEmail: email,
      holdExpiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: bookings.id });

  await testDb.insert(bookingItems).values({
    bookingId: booking.id,
    tripId: trip.id,
    operatorId: ctx.operatorId,
    subtotalCents: 10000,
  });

  return { tripId: trip.id, email };
}

describe("GET /api/cron/trip-reminders", () => {
  it("returns 401 without a valid CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/trip-reminders/route");
    const res = await GET(
      new NextRequest("http://localhost/api/cron/trip-reminders", {
        headers: { Authorization: "Bearer wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
    expect(sendPushToEmails).not.toHaveBeenCalled();
  });

  it("excludes a trip departing at +24h and beyond (upper bound excluded)", async () => {
    // +24h exactly is flaky here: windowEnd is computed inside the route from
    // its own `new Date()` call, a few ms after this seed's Date.now() — so a
    // trip seeded at precisely +24h can land a hair inside the window. +25h
    // gives enough margin to prove the upper bound excludes rather than
    // testing the exact millisecond edge.
    const { tripId } = await seedTripWithBooking(25);
    const { GET } = await import("@/app/api/cron/trip-reminders/route");
    await GET(cronReq());
    const calledTripIds = vi.mocked(sendPushToEmails).mock.calls.map((c) => (c[2].data as any).tripId);
    expect(calledTripIds).not.toContain(tripId);
  });

  it("excludes a trip departing at +22h59m (before the window)", async () => {
    const { tripId } = await seedTripWithBooking(22 + 59 / 60);
    const { GET } = await import("@/app/api/cron/trip-reminders/route");
    await GET(cronReq());
    const calledTripIds = vi.mocked(sendPushToEmails).mock.calls.map((c) => (c[2].data as any).tripId);
    expect(calledTripIds).not.toContain(tripId);
  });

  it("includes a trip departing at +23h30m and sends a push for its confirmed booking's email", async () => {
    const { tripId, email } = await seedTripWithBooking(23.5);
    const { GET } = await import("@/app/api/cron/trip-reminders/route");
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const call = vi.mocked(sendPushToEmails).mock.calls.find((c) => (c[2].data as any).tripId === tripId);
    expect(call).toBeDefined();
    expect(call![0]).toBe(ctx.operatorId);
    expect(call![1]).toEqual([email]);
    expect(call![3]).toBe("reminders");
  });

  it("does not count a pending (unconfirmed) booking's email", async () => {
    const { tripId } = await seedTripWithBooking(23.5, { status: "pending" });
    const { GET } = await import("@/app/api/cron/trip-reminders/route");
    await GET(cronReq());
    const calledTripIds = vi.mocked(sendPushToEmails).mock.calls.map((c) => (c[2].data as any).tripId);
    expect(calledTripIds).not.toContain(tripId);
  });

  it("excludes a cancelled trip even if its departure is in window", async () => {
    const { tripId } = await seedTripWithBooking(23.5);
    await testDb.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    const { GET } = await import("@/app/api/cron/trip-reminders/route");
    await GET(cronReq());
    const calledTripIds = vi.mocked(sendPushToEmails).mock.calls.map((c) => (c[2].data as any).tripId);
    expect(calledTripIds).not.toContain(tripId);
  });

  it("dedupes emails across multiple confirmed bookings on the same trip", async () => {
    const startTime = new Date(Date.now() + 23.5 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
    const [trip] = await testDb
      .insert(trips)
      .values({
        operatorId: ctx.operatorId,
        vesselId: ctx.vesselId,
        productId: ctx.productId,
        departureDate: startTime.toISOString().slice(0, 10),
        startTime,
        endTime,
        capacity: 20,
        seatsRemaining: 18,
        status: "scheduled",
      })
      .returning({ id: trips.id });

    const sharedEmail = `dup-${randomUUID().slice(0, 6)}@test.com`;
    for (let i = 0; i < 2; i++) {
      const [booking] = await testDb
        .insert(bookings)
        .values({
          operatorId: ctx.operatorId,
          confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
          status: "confirmed",
          totalCents: 10000,
          platformFeeCents: 150,
          customerEmail: sharedEmail,
          holdExpiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: bookings.id });
      await testDb.insert(bookingItems).values({
        bookingId: booking.id,
        tripId: trip.id,
        operatorId: ctx.operatorId,
        subtotalCents: 10000,
      });
    }

    const { GET } = await import("@/app/api/cron/trip-reminders/route");
    await GET(cronReq());
    const call = vi.mocked(sendPushToEmails).mock.calls.find((c) => (c[2].data as any).tripId === trip.id);
    expect(call![1]).toEqual([sharedEmail]);
  });
});
