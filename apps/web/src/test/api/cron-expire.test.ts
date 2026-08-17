import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import { bookings, trips } from "@openboat/db";
import { eq } from "drizzle-orm";

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
  });
});
