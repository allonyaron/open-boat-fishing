import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, payments } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/email", () => ({
  sendBookingConfirmation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    charges: { retrieve: vi.fn() },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_test" }) },
  },
}));

import { stripe } from "@/lib/stripe";
import { handlePaymentIntentSucceeded } from "@/lib/webhooks/payment-intent-succeeded";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.charges.retrieve).mockReset();
  vi.mocked(stripe.refunds.create).mockClear();
});

function pi(overrides: Record<string, unknown>) {
  return {
    id: "pi_default",
    amount: 10000,
    status: "succeeded",
    payment_method_types: ["card"],
    latest_charge: null,
    metadata: {},
    ...overrides,
  } as any;
}

describe("handlePaymentIntentSucceeded", () => {
  it("does nothing when bookingId is missing from metadata", async () => {
    await handlePaymentIntentSucceeded(pi({ id: "pi_no_meta", metadata: {} }));
    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
  });

  it("confirms a pending booking and inserts a payment row", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_confirm_1" });

    await handlePaymentIntentSucceeded(
      pi({ id: "pi_confirm_1", amount: 10000, metadata: { bookingId } }),
    );

    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("confirmed");

    const [payment] = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment).toBeDefined();
    expect(payment.stripePaymentIntentId).toBe("pi_confirm_1");
    expect(payment.amountCents).toBe(10000);
    expect(payment.applicationFeeCents).toBe(150);
    expect(payment.status).toBe("succeeded");
  });

  it("is idempotent when the booking is already confirmed", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: "pi_already" });

    await handlePaymentIntentSucceeded(pi({ id: "pi_already", metadata: { bookingId } }));

    const payment = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment).toHaveLength(0);
  });

  it("auto-refunds and does not confirm when the booking was already cancelled", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "cancelled", stripePaymentIntentId: "pi_race" });

    await handlePaymentIntentSucceeded(pi({ id: "pi_race", metadata: { bookingId } }));

    expect(stripe.refunds.create).toHaveBeenCalledWith({
      payment_intent: "pi_race",
      reverse_transfer: true,
      refund_application_fee: true,
    });

    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");

    const payment = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment).toHaveLength(0);
  });

  it("captures applicationFeeId and stripeTransferId from the charge when latest_charge is present", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_charge" });
    vi.mocked(stripe.charges.retrieve).mockResolvedValue({
      application_fee: "fee_1",
      transfer: "tr_1",
    } as any);

    await handlePaymentIntentSucceeded(
      pi({ id: "pi_charge", latest_charge: "ch_1", metadata: { bookingId } }),
    );

    expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_1");
    const [payment] = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment.stripeChargeId).toBe("ch_1");
    expect(payment.applicationFeeId).toBe("fee_1");
    expect(payment.stripeTransferId).toBe("tr_1");
  });
});
