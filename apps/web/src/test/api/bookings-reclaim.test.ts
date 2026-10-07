import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  seedOperator,
  seedBooking,
  setTripDeparture,
  cleanupBookings,
  cleanupOperator,
  testDb,
} from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { operators, trips, bookings, bookingItems, tickets } from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// P2-3 (d): the booking route reclaims expired holds on the cart's trips
// before it counts seats, instead of waiting for the expiry cron.

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn(),
      retrieve: vi.fn(),
      cancel: vi.fn(),
    },
  },
}));

import { stripe } from "@/lib/stripe";
import { POST } from "@/app/api/bookings/route";

let ctx: SeedResult;
let secondTripId: string;
let ipCounter = 0;

function postReq(tripId: string, quantity = 1) {
  return new NextRequest("http://localhost/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      customerEmail: "next@example.com",
      cart: [{ tripId, tickets: [{ ticketType: "adult", quantity }] }],
    }),
    headers: {
      "Content-Type": "application/json",
      "x-operator-id": ctx.operatorId,
      "x-forwarded-for": `10.40.0.${++ipCounter}`,
    },
  });
}

async function seats(tripId: string) {
  const [t] = await testDb.select({ s: trips.seatsRemaining }).from(trips).where(eq(trips.id, tripId));
  return t.s;
}

async function status(bookingId: string) {
  const [b] = await testDb.select({ s: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
  return b.s;
}

beforeAll(async () => {
  ctx = await seedOperator();
  await testDb
    .update(operators)
    .set({ stripeAccountId: "acct_test_fake", stripeOnboardingComplete: true })
    .where(eq(operators.id, ctx.operatorId));
  await setTripDeparture(ctx.tripId, 3 * 3_600_000);

  // A one-off second departure, for holds that span two trips.
  const [first] = await testDb.select().from(trips).where(eq(trips.id, ctx.tripId));
  const [second] = await testDb
    .insert(trips)
    .values({ ...first, id: randomUUID(), scheduleId: null, createdAt: new Date(), updatedAt: new Date() })
    .returning({ id: trips.id });
  secondTripId = second.id;
});

// cleanupBookings works per trip; delete tickets first so a booking that
// spans both trips can go.
async function cleanup() {
  await testDb.delete(tickets).where(eq(tickets.operatorId, ctx.operatorId));
  await cleanupBookings(ctx.tripId);
  await cleanupBookings(secondTripId);
}

afterAll(async () => {
  await cleanup();
  await cleanupOperator(ctx.operatorId);
});

beforeEach(async () => {
  await cleanup();
  vi.mocked(stripe.paymentIntents.create).mockReset().mockResolvedValue({
    id: "pi_new",
    client_secret: "pi_new_secret",
  } as never);
  vi.mocked(stripe.paymentIntents.retrieve).mockReset().mockResolvedValue({
    status: "requires_payment_method",
  } as never);
  vi.mocked(stripe.paymentIntents.cancel).mockReset().mockResolvedValue({ status: "canceled" } as never);
});

/** Seeds a pending booking with one ticket, and takes its seat off the trip. */
async function seedHold(opts: { holdExpiresAt: Date; pi?: string | null }) {
  const b = await seedBooking(ctx, {
    status: "pending",
    holdExpiresAt: opts.holdExpiresAt,
    stripePaymentIntentId: opts.pi === undefined ? `pi_old_${randomUUID().slice(0, 8)}` : opts.pi ?? undefined,
  });
  await testDb
    .update(trips)
    .set({ seatsRemaining: (await seats(ctx.tripId)) - 1 })
    .where(eq(trips.id, ctx.tripId));
  return b;
}

const EXPIRED = () => new Date(Date.now() - 60_000);
const LIVE = () => new Date(Date.now() + 10 * 60_000);

describe("POST /api/bookings — reclaiming expired holds (P2-3)", () => {
  it("frees an expired hold's seat for the next booking, with exact seat math", async () => {
    // The trip is sold out, and the only seat taken is an expired hold.
    await testDb.update(trips).set({ seatsRemaining: 1 }).where(eq(trips.id, ctx.tripId));
    const old = await seedHold({ holdExpiresAt: EXPIRED(), pi: "pi_old_expired" });
    expect(await seats(ctx.tripId)).toBe(0);

    const res = await POST(postReq(ctx.tripId));

    expect(res.status).toBe(200);
    expect(await status(old.bookingId)).toBe("cancelled");
    expect(await seats(ctx.tripId)).toBe(0); // +1 reclaimed, -1 booked
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_old_expired");
  });

  it("reclaims an expired hold that never got a PaymentIntent, without calling Stripe", async () => {
    await testDb.update(trips).set({ seatsRemaining: 1 }).where(eq(trips.id, ctx.tripId));
    const old = await seedHold({ holdExpiresAt: EXPIRED(), pi: null });

    const res = await POST(postReq(ctx.tripId));

    expect(res.status).toBe(200);
    expect(await status(old.bookingId)).toBe("cancelled");
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("leaves a hold that hasn't expired alone", async () => {
    await testDb.update(trips).set({ seatsRemaining: 1 }).where(eq(trips.id, ctx.tripId));
    const live = await seedHold({ holdExpiresAt: LIVE() });

    const res = await POST(postReq(ctx.tripId));

    expect(res.status).toBe(409);
    expect(await status(live.bookingId)).toBe("pending");
    expect(await seats(ctx.tripId)).toBe(0);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "processing"])(
    "does not reclaim an expired hold whose PI is %s",
    async (piStatus) => {
      await testDb.update(trips).set({ seatsRemaining: 1 }).where(eq(trips.id, ctx.tripId));
      const old = await seedHold({ holdExpiresAt: EXPIRED() });
      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({ status: piStatus } as never);

      const res = await POST(postReq(ctx.tripId));

      expect(res.status).toBe(409);
      expect(await status(old.bookingId)).toBe("pending");
      expect(await seats(ctx.tripId)).toBe(0);
      expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    },
  );

  it("does not reclaim when canceling the PI fails", async () => {
    await testDb.update(trips).set({ seatsRemaining: 1 }).where(eq(trips.id, ctx.tripId));
    const old = await seedHold({ holdExpiresAt: EXPIRED() });
    vi.mocked(stripe.paymentIntents.cancel).mockRejectedValue(new Error("Stripe down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const res = await POST(postReq(ctx.tripId));

    expect(res.status).toBe(409);
    expect(await status(old.bookingId)).toBe("pending");
    expect(await seats(ctx.tripId)).toBe(0);
  });

  it("restores seats on every trip of a reclaimed hold, including trips outside the cart", async () => {
    await testDb.update(trips).set({ seatsRemaining: 1 }).where(eq(trips.id, ctx.tripId));
    const old = await seedHold({ holdExpiresAt: EXPIRED() });
    // The same booking also holds 2 seats on the second trip.
    const [item] = await testDb
      .insert(bookingItems)
      .values({ bookingId: old.bookingId, tripId: secondTripId, operatorId: ctx.operatorId, subtotalCents: 20000 })
      .returning({ id: bookingItems.id });
    await testDb.insert(tickets).values(
      [0, 1].map(() => ({
        bookingItemId: item.id,
        bookingId: old.bookingId,
        operatorId: ctx.operatorId,
        ticketType: "adult" as const,
        priceCents: 10000,
        feeAmountCents: 150,
        qrPayload: randomUUID(),
      })),
    );
    await testDb.update(trips).set({ seatsRemaining: 18 }).where(eq(trips.id, secondTripId));

    const res = await POST(postReq(ctx.tripId));

    expect(res.status).toBe(200);
    expect(await status(old.bookingId)).toBe("cancelled");
    expect(await seats(ctx.tripId)).toBe(0);
    expect(await seats(secondTripId)).toBe(20);
  });

  it("skips a hold another process has locked instead of waiting on it", async () => {
    await testDb.update(trips).set({ seatsRemaining: 1 }).where(eq(trips.id, ctx.tripId));
    const old = await seedHold({ holdExpiresAt: EXPIRED() });

    // Hold the booking row the way a concurrent cron or webhook would.
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = testDb.transaction(async (tx) => {
      await tx.select().from(bookings).where(eq(bookings.id, old.bookingId)).for("update");
      locked();
      await released;
    });
    await isLocked;

    try {
      const res = await POST(postReq(ctx.tripId));
      expect(res.status).toBe(409);
    } finally {
      release();
      await holder;
    }
    expect(await status(old.bookingId)).toBe("pending");
  });
});
