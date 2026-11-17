import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb, cleanupBookings } from "../db-helpers";
import { bookings, trips, capacityChanges } from "@openboat/db";
import { eq, and } from "drizzle-orm";
import { stripe } from "@/lib/stripe";

// Mock Stripe so the cron doesn't make real API calls
vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: {
      retrieve: vi.fn().mockResolvedValue({ status: "requires_payment_method" }),
      cancel: vi.fn().mockResolvedValue({ status: "canceled" }),
    },
  },
}));

let ctx: Awaited<ReturnType<typeof seedOperator>>;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function cronReq() {
  return new NextRequest("http://localhost/api/cron/expire-pending-bookings", {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}


/** Ledger rows the cron's recount wrote for a trip: none means the seats were already right. */
async function recountRows(tripId: string) {
  return testDb
    .select({ id: capacityChanges.id })
    .from(capacityChanges)
    .where(and(eq(capacityChanges.tripId, tripId), eq(capacityChanges.reason, "recount")));
}

describe("GET /api/cron/expire-pending-bookings", () => {
  it("returns 401 without CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/expire-pending-bookings/route");
    const res = await GET(
      new NextRequest("http://localhost/api/cron/expire-pending-bookings", {
        headers: { Authorization: "Bearer wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns ok:true with cancelled:0 when no stale bookings", async () => {
    const { GET } = await import("@/app/api/cron/expire-pending-bookings/route");
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.cancelled).toBe(0);
  });

  it("cancels a stale pending booking and restores seats", async () => {
    // Reduce seats on the trip to simulate a booking that took a seat
    await testDb
      .update(trips)
      .set({ seatsRemaining: 19 })
      .where(eq(trips.id, ctx.tripId));

    const { bookingId } = await seedBooking(ctx, {
      status: "pending",
      holdExpiresAt: new Date(Date.now() - 60_000), // 1 min ago
    });

    const { GET } = await import("@/app/api/cron/expire-pending-bookings/route");
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelled).toBeGreaterThanOrEqual(1);

    // Booking should now be cancelled
    const [updated] = await testDb
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(updated.status).toBe("cancelled");

    // Seats restored: ticket count = 1, so seatsRemaining should be back to 20
    const [trip] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    expect(trip.seatsRemaining).toBe(20);
    // Restored by the release itself: the cron's recount found nothing to fix.
    expect(await recountRows(ctx.tripId)).toHaveLength(0);
  });

  it("skips a stale pending booking whose PI has already succeeded (H1 race guard)", async () => {
    // Simulate the race: payment went through but webhook not yet delivered.
    // The cron must not restore seats or cancel the booking.
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      status: "succeeded",
    } as any);

    await testDb
      .update(trips)
      .set({ seatsRemaining: 19 })
      .where(eq(trips.id, ctx.tripId));

    const { bookingId } = await seedBooking(ctx, {
      status: "pending",
      holdExpiresAt: new Date(Date.now() - 60_000),
      stripePaymentIntentId: "pi_test_h1_race",
    });

    const { GET } = await import("@/app/api/cron/expire-pending-bookings/route");
    const res = await GET(cronReq());
    expect(res.status).toBe(200);

    // Booking must remain pending — the webhook will confirm it
    const [updated] = await testDb
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(updated.status).toBe("pending");

    // Seats must NOT be restored
    const [trip] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    expect(trip.seatsRemaining).toBe(19);
  });
  it("recounts drifted seats even on a night with no expired holds", async () => {
    // No bookings on the trip, yet it shows 5 seats gone: drift a writer
    // outside the inventory module would leave behind.
    await cleanupBookings(ctx.tripId);
    await testDb.update(trips).set({ seatsRemaining: 15 }).where(eq(trips.id, ctx.tripId));
    const before = (await recountRows(ctx.tripId)).length;

    const { GET } = await import("@/app/api/cron/expire-pending-bookings/route");
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelled).toBe(0);
    expect(body.seatsRecounted).toBeGreaterThanOrEqual(1);

    const [trip] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    expect(trip.seatsRemaining).toBe(20);
    expect(await recountRows(ctx.tripId)).toHaveLength(before + 1);
  });
});
