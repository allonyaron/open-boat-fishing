import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, bookings, bookingItems, tickets } from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_test_mock" }),
    },
  },
}));

vi.mock("@/lib/push", () => ({
  sendPushToEmails: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin } from "@/lib/session";
import { stripe } from "@/lib/stripe";

let ctx: SeedResult;
// Each seedFreshTrip call gets a unique far-future date to avoid the
// (schedule_id, departure_date) unique constraint while still using the
// same scheduleId as ctx.
let freshTripIdx = 0;

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
  vi.mocked(stripe.refunds.create).mockResolvedValue({ id: "re_test_mock" } as any);
});

async function seedFreshTrip(status: "scheduled" | "cancelled" = "scheduled") {
  const month = String((freshTripIdx % 12) + 1).padStart(2, "0");
  const year = 2070 + Math.floor(freshTripIdx / 12);
  const date = `${year}-${month}-01`;
  freshTripIdx++;

  const [row] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      scheduleId: ctx.scheduleId,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate: date,
      startTime: new Date(`${date}T08:00:00Z`),
      endTime: new Date(`${date}T16:00:00Z`),
      capacity: 20,
      seatsRemaining: 20,
      status,
    })
    .returning({ id: trips.id });
  return row.id;
}

async function seedConfirmedBooking(tripId: string) {
  const piId = `pi_test_${randomUUID().slice(0, 8)}`;
  const [booking] = await testDb
    .insert(bookings)
    .values({
      operatorId: ctx.operatorId,
      confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
      status: "confirmed",
      totalCents: 10000,
      platformFeeCents: 150,
      customerEmail: `test-${randomUUID().slice(0, 6)}@test.com`,
      stripePaymentIntentId: piId,
      holdExpiresAt: new Date(Date.now() - 60_000),
    })
    .returning({ id: bookings.id });

  const [item] = await testDb
    .insert(bookingItems)
    .values({
      bookingId: booking.id,
      tripId,
      operatorId: ctx.operatorId,
      subtotalCents: 10000,
    })
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

  return { bookingId: booking.id };
}

function postReq(tripId: string, body: object = {}) {
  return new NextRequest(`http://localhost/api/admin/trips/${tripId}/cancel`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/admin/trips/[tripId]/cancel", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(ctx.tripId), { params: { tripId: ctx.tripId } });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown tripId", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(fakeId), { params: { tripId: fakeId } });
    expect(res.status).toBe(404);
  });

  it("returns 409 for an already-cancelled trip", async () => {
    const tripId = await seedFreshTrip("cancelled");
    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId), { params: { tripId } });
    expect(res.status).toBe(409);
  });

  it("returns 200 with bookingsCancelled:0 when trip has no bookings", async () => {
    const tripId = await seedFreshTrip();
    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId, { reason: "weather" }), { params: { tripId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.bookingsCancelled).toBe(0);
    expect(body.ticketsVoided).toBe(0);

    const [updated] = await testDb
      .select({ status: trips.status, cancellationReason: trips.cancellationReason })
      .from(trips)
      .where(eq(trips.id, tripId));
    expect(updated.status).toBe("cancelled");
    expect(updated.cancellationReason).toBe("weather");
  });

  it("returns 200, voids tickets, and issues Stripe refund for confirmed booking", async () => {
    const tripId = await seedFreshTrip();
    const { bookingId } = await seedConfirmedBooking(tripId);

    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId), { params: { tripId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.bookingsCancelled).toBe(1);
    expect(body.ticketsVoided).toBe(1);

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: expect.stringContaining("pi_test_") }),
    );

    const [booking] = await testDb
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });
});
