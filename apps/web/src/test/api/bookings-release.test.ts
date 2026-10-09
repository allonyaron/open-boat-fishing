import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, seedBooking, cleanupBookings, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, trips, rateLimits } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: {
      retrieve: vi.fn(),
      cancel: vi.fn(),
    },
  },
}));

import { stripe } from "@/lib/stripe";
import { POST } from "@/app/api/bookings/[bookingId]/release/route";
import { signHoldToken } from "@/lib/bookings/hold-token";

let ctx: SeedResult;
let ipCounter = 0;

// Carries a valid hold token for ctx's operator unless token is null.
function call(bookingId: string, opts: { operatorId?: string; ip?: string; token?: string | null } = {}) {
  const token = opts.token === undefined ? signHoldToken({ bookingId, operatorId: ctx.operatorId }) : opts.token;
  const req = new NextRequest(`http://localhost/api/bookings/${bookingId}/release`, {
    method: "POST",
    headers: {
      "x-operator-id": opts.operatorId ?? ctx.operatorId,
      "x-forwarded-for": opts.ip ?? `10.41.0.${++ipCounter}`,
      ...(token ? { "x-hold-token": token } : {}),
    },
  });
  return POST(req, { params: Promise.resolve({ bookingId }) });
}

async function seats() {
  const [t] = await testDb.select({ s: trips.seatsRemaining }).from(trips).where(eq(trips.id, ctx.tripId));
  return t.s;
}

async function status(bookingId: string) {
  const [b] = await testDb.select({ s: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
  return b.s;
}

/** A live pending hold on one seat; the trip's count already reflects it. */
async function seedHold(pi: string | null = "pi_hold") {
  const b = await seedBooking(ctx, {
    status: "pending",
    holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    stripePaymentIntentId: pi ?? undefined,
  });
  await testDb.update(trips).set({ seatsRemaining: 19 }).where(eq(trips.id, ctx.tripId));
  return b;
}

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupBookings(ctx.tripId);
  await cleanupOperator(ctx.operatorId);
});

beforeEach(async () => {
  await cleanupBookings(ctx.tripId);
  vi.mocked(stripe.paymentIntents.retrieve).mockReset().mockResolvedValue({
    status: "requires_payment_method",
  } as never);
  vi.mocked(stripe.paymentIntents.cancel).mockReset().mockResolvedValue({ status: "canceled" } as never);
});

describe("POST /api/bookings/:id/release (P2-3)", () => {
  it("returns 500 when no operator header is present", async () => {
    const res = await call("00000000-0000-0000-0000-000000000000", { operatorId: "" });
    expect(res.status).toBe(500);
  });

  it("returns 404 for a malformed id", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("returns 404 for another operator's booking, and leaves it held", async () => {
    const other = await seedOperator();
    try {
      const { bookingId } = await seedBooking(other, { status: "pending", stripePaymentIntentId: "pi_other" });
      const res = await call(bookingId);
      expect(res.status).toBe(404);
      expect(await status(bookingId)).toBe("pending");
      expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    } finally {
      await cleanupBookings(other.tripId);
      await cleanupOperator(other.operatorId);
    }
  });

  it("returns 401 without a hold token, and leaves the hold alone", async () => {
    const { bookingId } = await seedHold();
    const res = await call(bookingId, { token: null });
    expect(res.status).toBe(401);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(await status(bookingId)).toBe("pending");
  });

  it("cancels the PI, then the booking, and restores the seat", async () => {
    const { bookingId } = await seedHold();

    const res = await call(bookingId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ released: true });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold");
    expect(await status(bookingId)).toBe("cancelled");
    expect(await seats()).toBe(20);
  });

  it("is idempotent: a second release changes nothing", async () => {
    const { bookingId } = await seedHold();
    await call(bookingId);
    vi.mocked(stripe.paymentIntents.cancel).mockClear();

    const res = await call(bookingId);

    expect(res.status).toBe(200);
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(await seats()).toBe(20);
  });

  it("releases a booking that never got a PI without calling Stripe", async () => {
    const { bookingId } = await seedHold(null);
    const res = await call(bookingId);
    expect(res.status).toBe(200);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(await seats()).toBe(20);
  });

  it("skips the cancel call when the PI is already canceled", async () => {
    const { bookingId } = await seedHold();
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({ status: "canceled" } as never);
    const res = await call(bookingId);
    expect(res.status).toBe(200);
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(await status(bookingId)).toBe("cancelled");
  });

  it.each(["succeeded", "processing"])("returns 409 and keeps the seats when the PI is %s", async (piStatus) => {
    const { bookingId } = await seedHold();
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({ status: piStatus } as never);

    const res = await call(bookingId);

    expect(res.status).toBe(409);
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(await status(bookingId)).toBe("pending");
    expect(await seats()).toBe(19);
  });

  it("returns 409 for a confirmed booking", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: "pi_paid" });
    const res = await call(bookingId);
    expect(res.status).toBe(409);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("returns 502 and keeps the seats when Stripe fails", async () => {
    const { bookingId } = await seedHold();
    vi.mocked(stripe.paymentIntents.cancel).mockRejectedValue(new Error("Stripe down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const res = await call(bookingId);

    expect(res.status).toBe(502);
    expect(await status(bookingId)).toBe("pending");
    expect(await seats()).toBe(19);
  });

  it("returns 429 on the 11th request from the same IP within 15 minutes", async () => {
    await testDb.delete(rateLimits);
    const ip = "10.41.1.1";
    for (let i = 0; i < 10; i++) await call("not-a-uuid", { ip });
    const res = await call("not-a-uuid", { ip });
    expect(res.status).toBe(429);
  });
});
