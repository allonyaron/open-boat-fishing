import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, trips } from "@openboat/db";
import { eq } from "drizzle-orm";
import { handlePaymentIntentCanceled } from "@/lib/webhooks/payment-intent-canceled";

vi.mock("@/lib/push", () => ({
  sendPushToEmails: vi.fn().mockResolvedValue(undefined),
}));

import { sendPushToEmails } from "@/lib/push";

beforeEach(() => {
  vi.mocked(sendPushToEmails).mockClear();
});

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function pi(overrides: Record<string, unknown>) {
  return { id: "pi_default", metadata: {}, ...overrides } as any;
}

describe("handlePaymentIntentCanceled", () => {
  it("does nothing when bookingId is missing from metadata", async () => {
    await expect(handlePaymentIntentCanceled(pi({ id: "pi_no_meta", metadata: {} }))).resolves.toBeUndefined();
  });

  it("cancels a pending booking and restores seats", async () => {
    const [before] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));

    const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_cancel_1" });
    // seedBooking inserts one ticket but does not itself decrement seats —
    // simulate the decrement that would have happened at booking creation.
    await testDb.update(trips).set({ seatsRemaining: before.seatsRemaining - 1 }).where(eq(trips.id, ctx.tripId));

    await handlePaymentIntentCanceled(pi({ id: "pi_cancel_1", metadata: { bookingId } }));

    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");

    const [after] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    expect(after.seatsRemaining).toBe(before.seatsRemaining);
  });

  it("is idempotent when the booking is already cancelled", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "cancelled", stripePaymentIntentId: "pi_cancel_2" });
    await expect(
      handlePaymentIntentCanceled(pi({ id: "pi_cancel_2", metadata: { bookingId } })),
    ).resolves.toBeUndefined();
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });

  it("does not touch a confirmed booking", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: "pi_cancel_3" });
    await handlePaymentIntentCanceled(pi({ id: "pi_cancel_3", metadata: { bookingId } }));
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("confirmed");
  });

  describe("the push follows the PI's cancellation_reason", () => {
    async function cancelWith(reason: string | null) {
      const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: `pi_reason_${reason}` });
      await handlePaymentIntentCanceled(
        pi({ id: `pi_reason_${reason}`, metadata: { bookingId }, cancellation_reason: reason }),
      );
      const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(booking.status).toBe("cancelled");
      return bookingId;
    }

    it("sends none when the customer released or replaced the checkout", async () => {
      await cancelWith("requested_by_customer");
      expect(sendPushToEmails).not.toHaveBeenCalled();
    });

    it("sends the expiry push when the hold expired", async () => {
      const bookingId = await cancelWith("abandoned");
      expect(sendPushToEmails).toHaveBeenCalledWith(
        ctx.operatorId,
        expect.any(Array),
        expect.objectContaining({ title: "Booking Expired", data: { type: "booking_expired", bookingId } }),
        "cancellations",
      );
    });

    it("sends the cancellation push for any other cancel", async () => {
      const bookingId = await cancelWith(null);
      expect(sendPushToEmails).toHaveBeenCalledWith(
        ctx.operatorId,
        expect.any(Array),
        expect.objectContaining({ title: "Booking Cancelled", data: { type: "booking_cancelled", bookingId } }),
        "cancellations",
      );
    });
  });
});
