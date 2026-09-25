import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, payments, tickets, trips } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    applicationFees: { createRefund: vi.fn().mockResolvedValue({ id: "fr_test" }) },
  },
}));

import { stripe } from "@/lib/stripe";
import { handleChargeRefunded } from "@/lib/webhooks/charge-refunded";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.applicationFees.createRefund).mockClear();
});

async function seedPaidBooking(piId: string, applicationFeeId: string | null = "fee_abc") {
  const { bookingId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: piId });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    applicationFeeId,
    amountCents: 10000,
    applicationFeeCents: 150,
    status: "succeeded",
  });
  return bookingId;
}

function charge(overrides: Record<string, unknown>) {
  return {
    id: "ch_default",
    amount: 10000,
    amount_refunded: 10000,
    payment_intent: null,
    ...overrides,
  } as any;
}

describe("handleChargeRefunded", () => {
  it("logs and leaves the booking alone on a partial refund", async () => {
    const bookingId = await seedPaidBooking("pi_partial");
    await handleChargeRefunded(charge({ id: "ch_partial", amount: 10000, amount_refunded: 5000, payment_intent: "pi_partial" }));

    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("confirmed");
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
  });

  it("does nothing when the charge has no payment_intent", async () => {
    await expect(
      handleChargeRefunded(charge({ id: "ch_no_pi", payment_intent: null })),
    ).resolves.toBeUndefined();
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
  });

  it("does nothing when no payment row matches the payment_intent", async () => {
    await expect(
      handleChargeRefunded(charge({ id: "ch_unknown_pi", payment_intent: "pi_unknown_xyz" })),
    ).resolves.toBeUndefined();
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
  });

  it("on a full refund: reverses the application fee, cancels the booking, voids tickets, and restores seats", async () => {
    const [before] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));

    const bookingId = await seedPaidBooking("pi_full", "fee_full_1");
    await testDb.update(trips).set({ seatsRemaining: before.seatsRemaining - 1 }).where(eq(trips.id, ctx.tripId));

    await handleChargeRefunded(charge({ id: "ch_full", amount: 10000, amount_refunded: 10000, payment_intent: "pi_full" }));

    expect(stripe.applicationFees.createRefund).toHaveBeenCalledWith("fee_full_1");

    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");

    const ticketRows = await testDb.select().from(tickets).where(eq(tickets.bookingId, bookingId));
    expect(ticketRows.every((t) => t.voided === true && t.feeStatus === "reversed")).toBe(true);

    const [after] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    expect(after.seatsRemaining).toBe(before.seatsRemaining);
  });

  it("treats an already-refunded application fee as success and still cancels the booking", async () => {
    vi.mocked(stripe.applicationFees.createRefund).mockRejectedValueOnce(
      Object.assign(new Error("already refunded"), { code: "fee_refund_already_refunded" }),
    );
    const bookingId = await seedPaidBooking("pi_dup_refund", "fee_dup_1");

    await handleChargeRefunded(charge({ id: "ch_dup", amount: 10000, amount_refunded: 10000, payment_intent: "pi_dup_refund" }));

    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });

  it("skips the application fee reversal call when applicationFeeId is null", async () => {
    const bookingId = await seedPaidBooking("pi_no_fee", null);
    await handleChargeRefunded(charge({ id: "ch_no_fee", amount: 10000, amount_refunded: 10000, payment_intent: "pi_no_fee" }));

    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });
});
