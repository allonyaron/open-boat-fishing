import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, bookings, bookingItems, tickets, operators, payments } from "@openboat/db";
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
    paymentIntents: {
      retrieve: vi.fn(),
      cancel: vi.fn(),
    },
    charges: { retrieve: vi.fn() },
  },
}));

vi.mock("@/lib/push", () => ({
  sendPushToEmails: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { sendPushToEmails } from "@/lib/push";

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
  vi.mocked(stripe.refunds.create).mockClear();
  vi.mocked(stripe.refunds.create).mockResolvedValue({ id: "re_test_mock" } as any);
  vi.mocked(stripe.paymentIntents.retrieve).mockReset();
  vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({ status: "requires_payment_method" } as any);
  vi.mocked(stripe.paymentIntents.cancel).mockReset();
  vi.mocked(stripe.paymentIntents.cancel).mockResolvedValue({ status: "canceled" } as any);
  vi.mocked(sendPushToEmails).mockClear();
});

function pushBodyFor(email: string) {
  const call = vi.mocked(sendPushToEmails).mock.calls.find(([, emails]) => emails.includes(email));
  return call?.[2].body;
}

async function emailOf(bookingId: string) {
  const [b] = await testDb.select({ email: bookings.customerEmail }).from(bookings).where(eq(bookings.id, bookingId));
  return b.email!;
}

async function seedFreshTrip(status: "scheduled" | "cancelled" = "scheduled", seatsRemaining = 20) {
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
      seatsRemaining,
      status,
      ...(status === "cancelled" && { cancelledAt: new Date() }),
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
    status: "live",
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

    expect(body.refunds).toEqual({ sent: 1, queued: 0, failed: 0 });
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: expect.stringContaining("pi_test_"),
        metadata: expect.objectContaining({ reason: "trip_cancelled", tripId }),
      }),
      { idempotencyKey: expect.any(String) },
    );

    const [booking] = await testDb
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");

    // A paid passenger's ticket is refunded (money went back), not voided.
    const [ticket] = await testDb
      .select({ status: tickets.status, voided: tickets.voided, feeStatus: tickets.feeStatus })
      .from(tickets)
      .where(eq(tickets.bookingId, bookingId));
    expect(ticket).toEqual({ status: "refunded", voided: true, feeStatus: "reversed" });
  });

  it("still cancels the trip when a refund can't be sent, and queues it", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
      Object.assign(new Error("Stripe is down"), { type: "StripeAPIError" }),
    );
    const tripId = await seedFreshTrip();
    const { bookingId } = await seedConfirmedBooking(tripId);

    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId), { params: { tripId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.refunds).toEqual({ sent: 0, queued: 1, failed: 0 });

    const [trip] = await testDb.select({ status: trips.status }).from(trips).where(eq(trips.id, tripId));
    expect(trip.status).toBe("cancelled");
    const [booking] = await testDb.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });
});

// A booking with tickets on one or more trips. Ticket status follows the
// booking (pending → held, confirmed → live) unless a ticket says otherwise.
async function seedBookingOn(
  status: "pending" | "confirmed",
  legs: { tripId: string; tickets: { priceCents: number; status?: "held" | "live" | "refunded" }[] }[],
) {
  const piId = `pi_test_${randomUUID().slice(0, 8)}`;
  const total = legs.flatMap((l) => l.tickets).reduce((n, t) => n + t.priceCents, 0);
  const [booking] = await testDb
    .insert(bookings)
    .values({
      operatorId: ctx.operatorId,
      confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
      status,
      totalCents: total,
      platformFeeCents: 150,
      customerEmail: `test-${randomUUID().slice(0, 6)}@test.com`,
      stripePaymentIntentId: piId,
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    })
    .returning({ id: bookings.id });
  for (const leg of legs) {
    const [item] = await testDb
      .insert(bookingItems)
      .values({
        bookingId: booking.id,
        tripId: leg.tripId,
        operatorId: ctx.operatorId,
        subtotalCents: leg.tickets.reduce((n, t) => n + t.priceCents, 0),
      })
      .returning({ id: bookingItems.id });
    for (const t of leg.tickets) {
      const ticketStatus = t.status ?? (status === "pending" ? "held" : "live");
      await testDb.insert(tickets).values({
        bookingItemId: item.id,
        bookingId: booking.id,
        operatorId: ctx.operatorId,
        ticketType: "adult",
        priceCents: t.priceCents,
        feeAmountCents: 150,
        status: ticketStatus,
        voided: ticketStatus === "refunded",
        ...(ticketStatus === "refunded" && { feeStatus: "reversed" as const }),
        qrPayload: randomUUID(),
      });
    }
  }
  return { bookingId: booking.id, piId };
}

async function ticketStatuses(bookingId: string) {
  const rows = await testDb
    .select({ tripId: bookingItems.tripId, status: tickets.status })
    .from(tickets)
    .innerJoin(bookingItems, eq(bookingItems.id, tickets.bookingItemId))
    .where(eq(tickets.bookingId, bookingId));
  return rows;
}

async function bookingStatus(bookingId: string) {
  const [b] = await testDb.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
  return b.status;
}

async function seatsLeft(tripId: string) {
  const [t] = await testDb.select({ seats: trips.seatsRemaining }).from(trips).where(eq(trips.id, tripId));
  return t.seats;
}

describe("trip cancel settles every booking on the trip (row 9)", () => {
  it("cancels an unpaid booking on every trip it covers and cancels its payment", async () => {
    const tripId = await seedFreshTrip("scheduled", 18);
    const otherTripId = await seedFreshTrip("scheduled", 19);
    const { bookingId, piId } = await seedBookingOn("pending", [
      { tripId, tickets: [{ priceCents: 5000 }, { priceCents: 5000 }] },
      { tripId: otherTripId, tickets: [{ priceCents: 4000 }] },
    ]);

    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId), { params: { tripId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ bookingsCancelled: 1, ticketsVoided: 3, refunds: { sent: 0, queued: 0, failed: 0 } });

    expect(await bookingStatus(bookingId)).toBe("cancelled");
    expect((await ticketStatuses(bookingId)).map((t) => t.status)).toEqual(["voided", "voided", "voided"]);
    // The other trip gets its seat back; the cancelled one gives none.
    expect(await seatsLeft(otherTripId)).toBe(20);
    expect(await seatsLeft(tripId)).toBe(18);
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith(piId, { cancellation_reason: "requested_by_customer" });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(pushBodyFor(await emailOf(bookingId))).toMatch(/haven't been charged/);
  });

  it("refunds in full a payment that lands after its trip was cancelled", async () => {
    const acct = "acct_test_cancel_trip";
    await testDb.update(operators).set({ stripeAccountId: acct }).where(eq(operators.id, ctx.operatorId));
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({ status: "succeeded" } as any);
    const tripId = await seedFreshTrip("scheduled", 19);
    const { bookingId, piId } = await seedBookingOn("pending", [{ tripId, tickets: [{ priceCents: 10000 }] }]);

    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    await POST(postReq(tripId), { params: { tripId } });
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    // The payment went through before it could be cancelled: it will be refunded.
    expect(pushBodyFor(await emailOf(bookingId))).toMatch(/refund is on the way/);

    const { handlePaymentIntentSucceeded } = await import("@/lib/webhooks/payment-intent-succeeded");
    const result = await handlePaymentIntentSucceeded({
      id: piId,
      amount: 10000,
      currency: "usd",
      transfer_data: { destination: acct },
      status: "succeeded",
      payment_method_types: ["card"],
      latest_charge: null,
      metadata: {},
    } as any);
    expect(result.outcome).toBe("handled");
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: piId, metadata: expect.objectContaining({ reason: "auto_refund" }) }),
      { idempotencyKey: expect.any(String) },
    );
    expect(await bookingStatus(bookingId)).toBe("cancelled");
    expect(await testDb.select().from(payments).where(eq(payments.bookingId, bookingId))).toHaveLength(0);
  });

  it("refunds only this trip's tickets of a paid booking that has another trip, and keeps it open", async () => {
    const tripId = await seedFreshTrip("scheduled", 18);
    const otherTripId = await seedFreshTrip("scheduled", 19);
    const { bookingId, piId } = await seedBookingOn("confirmed", [
      { tripId, tickets: [{ priceCents: 6800 }, { priceCents: 6120 }] },
      { tripId: otherTripId, tickets: [{ priceCents: 6800 }] },
    ]);

    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId), { params: { tripId } });
    expect((await res.json()).bookingsCancelled).toBe(0);

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: piId, amount: 12920 }),
      expect.anything(),
    );
    expect(await bookingStatus(bookingId)).toBe("confirmed");
    const statuses = await ticketStatuses(bookingId);
    expect(statuses.filter((t) => t.tripId === tripId).map((t) => t.status)).toEqual(["refunded", "refunded"]);
    expect(statuses.filter((t) => t.tripId === otherTripId).map((t) => t.status)).toEqual(["live"]);
  });

  it("doesn't refund again a ticket refunded on its own earlier (P4-2)", async () => {
    const tripId = await seedFreshTrip("scheduled", 19);
    const otherTripId = await seedFreshTrip("scheduled", 19);
    await seedBookingOn("confirmed", [
      { tripId, tickets: [{ priceCents: 6800, status: "refunded" }, { priceCents: 6800 }] },
      { tripId: otherTripId, tickets: [{ priceCents: 6800 }] },
    ]);

    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    await POST(postReq(tripId), { params: { tripId } });
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 6800 }), expect.anything());
  });

  it("refunds everything left and cancels the booking when the trip held its last live tickets (P4-8)", async () => {
    const tripId = await seedFreshTrip("scheduled", 19);
    const otherTripId = await seedFreshTrip("scheduled", 20);
    const { bookingId, piId } = await seedBookingOn("confirmed", [
      { tripId, tickets: [{ priceCents: 6800 }] },
      { tripId: otherTripId, tickets: [{ priceCents: 6800, status: "refunded" }] },
    ]);

    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId), { params: { tripId } });
    expect((await res.json()).bookingsCancelled).toBe(1);

    const [params] = vi.mocked(stripe.refunds.create).mock.calls[0];
    expect(params).toMatchObject({ payment_intent: piId });
    expect(params).not.toHaveProperty("amount");
    expect(await bookingStatus(bookingId)).toBe("cancelled");
  });

  it("finishes a cancellation that stopped before settling its bookings, once", async () => {
    // As if phase 1 committed and the request died before phase 2.
    const tripId = await seedFreshTrip("cancelled", 19);
    const { bookingId } = await seedBookingOn("confirmed", [{ tripId, tickets: [{ priceCents: 10000 }] }]);

    const { finishCancelledTrips } = await import("@/lib/bookings/cancel-trip");
    expect(await finishCancelledTrips()).toBeGreaterThanOrEqual(1);
    expect(await bookingStatus(bookingId)).toBe("cancelled");
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);

    expect(await finishCancelledTrips()).toBe(0);
    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId), { params: { tripId } });
    expect(res.status).toBe(409);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("settles a booking on an already-cancelled trip when cancel is pressed again", async () => {
    const tripId = await seedFreshTrip("cancelled", 19);
    const { bookingId } = await seedBookingOn("confirmed", [{ tripId, tickets: [{ priceCents: 10000 }] }]);

    const { POST } = await import("@/app/api/admin/trips/[tripId]/cancel/route");
    const res = await POST(postReq(tripId), { params: { tripId } });
    expect(res.status).toBe(200);
    expect(await bookingStatus(bookingId)).toBe("cancelled");
  });
});

describe("planBookingRefund", () => {
  it("plans nothing when no ticket was refunded", async () => {
    const { planBookingRefund } = await import("@/lib/bookings/cancel-trip");
    expect(planBookingRefund([], 0)).toBeNull();
  });
  it("refunds everything left when no ticket holds a seat", async () => {
    const { planBookingRefund } = await import("@/lib/bookings/cancel-trip");
    expect(planBookingRefund([6800, 6120], 0)).toEqual({ amountCents: null });
  });
  it("refunds the tickets' price when others remain", async () => {
    const { planBookingRefund } = await import("@/lib/bookings/cancel-trip");
    expect(planBookingRefund([6800, 6120], 1)).toEqual({ amountCents: 12920 });
    expect(planBookingRefund([0], 1)).toBeNull();
  });
});
