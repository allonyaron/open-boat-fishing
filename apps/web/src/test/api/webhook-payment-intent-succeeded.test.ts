import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb, stripeTestCtx, auditRowsFor } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, bookingItems, payments, operators, tickets, trips, stripeCommands } from "@openboat/db";
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

const ACCT = "acct_test_succeeded";

beforeAll(async () => {
  ctx = await seedOperator();
  await testDb.update(operators).set({ stripeAccountId: ACCT }).where(eq(operators.id, ctx.operatorId));
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
    currency: "usd",
    transfer_data: { destination: ACCT },
    status: "succeeded",
    payment_method_types: ["card"],
    latest_charge: null,
    metadata: {},
    ...overrides,
  } as any;
}

describe("handlePaymentIntentSucceeded", () => {
  it("needs review when a payment to this operator succeeds but no booking has it", async () => {
    const result = await handlePaymentIntentSucceeded(pi({ id: "pi_no_booking", metadata: {} }), stripeTestCtx);
    expect(result).toMatchObject({ outcome: "needs_review", operatorId: ctx.operatorId });
    expect(stripe.charges.retrieve).not.toHaveBeenCalled();
  });

  it("ignores a payment whose booking reference is from another deployment on the same Stripe account", async () => {
    const result = await handlePaymentIntentSucceeded(
      pi({ id: "pi_preview", metadata: { bookingId: "0b9f2c4e-8a1d-4c3b-9e7f-5a6d2c1b0e9f" } }),
      stripeTestCtx,
    );
    expect(result.outcome).toBe("ignored");
    expect(result.note).toMatch(/another deployment/);
  });

  it("ignores a payment to another deployment's account", async () => {
    const result = await handlePaymentIntentSucceeded(
      pi({ id: "pi_elsewhere", transfer_data: { destination: "acct_elsewhere" }, metadata: {} }),
      stripeTestCtx,
    );
    expect(result.outcome).toBe("ignored");
  });

  it("finds the booking by its PI id, not by metadata", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_meta_free" });
    const result = await handlePaymentIntentSucceeded(pi({ id: "pi_meta_free", metadata: {} }), stripeTestCtx);
    expect(result.outcome).toBe("handled");
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("confirmed");
  });

  it("throws to be retried when the charge can't be fetched, and confirms nothing", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_charge_down" });
    vi.mocked(stripe.charges.retrieve).mockRejectedValueOnce(new Error("Stripe unavailable"));
    await expect(
      handlePaymentIntentSucceeded(pi({ id: "pi_charge_down", latest_charge: "ch_down", metadata: {} }), stripeTestCtx),
    ).rejects.toThrow(/Stripe unavailable/);
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("pending");
  });

  it("confirms a pending booking and inserts a payment row", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_confirm_1" });

    await handlePaymentIntentSucceeded(
      pi({ id: "pi_confirm_1", amount: 10000, metadata: { bookingId } }),
      stripeTestCtx,
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

    await handlePaymentIntentSucceeded(pi({ id: "pi_already", metadata: { bookingId } }), stripeTestCtx);

    const payment = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment).toHaveLength(0);
  });

  it("auto-refunds and does not confirm when the booking was already cancelled", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "cancelled", stripePaymentIntentId: "pi_race" });

    await handlePaymentIntentSucceeded(pi({ id: "pi_race", metadata: { bookingId } }), stripeTestCtx);

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_race",
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: expect.objectContaining({ reason: "auto_refund" }),
      }),
      { idempotencyKey: expect.any(String) },
    );

    // A retried event finds the same recorded refund and doesn't send another.
    await handlePaymentIntentSucceeded(pi({ id: "pi_race", metadata: { bookingId } }), stripeTestCtx);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);

    // The Stripe event is the refund's actor, recorded once (row 12).
    const [command] = await testDb.select({ id: stripeCommands.id }).from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
    const audits = await auditRowsFor("stripe_commands", command.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "refund.queue", actorKind: "stripe", actorId: "evt_test" });
    expect(vi.mocked(stripe.refunds.create).mock.calls[0][0]!.metadata).toMatchObject({ actor_kind: "stripe", actor_id: "evt_test" });

    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");

    const payment = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment).toHaveLength(0);
  });

  it("cancels and refunds a pending booking whose trip was cancelled before it was paid (row 9)", async () => {
    const { bookingId, bookingItemId, ticketId } = await seedBooking(ctx, {
      status: "pending",
      stripePaymentIntentId: "pi_trip_gone",
    });
    const [cancelledTrip] = await testDb
      .insert(trips)
      .values({
        operatorId: ctx.operatorId,
        scheduleId: ctx.scheduleId,
        vesselId: ctx.vesselId,
        productId: ctx.productId,
        departureDate: "2069-06-01",
        startTime: new Date("2069-06-01T08:00:00Z"),
        endTime: new Date("2069-06-01T16:00:00Z"),
        capacity: 20,
        seatsRemaining: 19,
        status: "cancelled",
        cancelledAt: new Date(),
      })
      .returning({ id: trips.id });
    await testDb.update(bookingItems).set({ tripId: cancelledTrip.id }).where(eq(bookingItems.id, bookingItemId));

    const result = await handlePaymentIntentSucceeded(pi({ id: "pi_trip_gone", metadata: {} }), stripeTestCtx);
    expect(result.outcome).toBe("handled");

    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
    const [ticket] = await testDb.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("voided");
    expect(await testDb.select().from(payments).where(eq(payments.bookingId, bookingId))).toHaveLength(0);
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_trip_gone", metadata: expect.objectContaining({ reason: "auto_refund" }) }),
      { idempotencyKey: expect.any(String) },
    );
  });

  describe("binds the PI to the booking (P3-2)", () => {
    async function expectUntouched(bookingId: string) {
      const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(booking.status).toBe("pending");
      const [ticket] = await testDb.select().from(tickets).where(eq(tickets.bookingId, bookingId));
      expect(ticket.status).toBe("held");
      expect(await testDb.select().from(payments).where(eq(payments.bookingId, bookingId))).toHaveLength(0);
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    }

    it("does not confirm when the PI id is not the booking's", async () => {
      const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_mine" });
      await handlePaymentIntentSucceeded(pi({ id: "pi_someone_elses", metadata: { bookingId } }), stripeTestCtx);
      await expectUntouched(bookingId);
    });

    it("does not confirm when the booking has no PI yet", async () => {
      const { bookingId } = await seedBooking(ctx, { status: "pending" });
      await handlePaymentIntentSucceeded(pi({ id: "pi_early", metadata: { bookingId } }), stripeTestCtx);
      await expectUntouched(bookingId);
    });

    it("does not confirm when the amount differs from the booking total", async () => {
      const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_cheap" });
      await handlePaymentIntentSucceeded(pi({ id: "pi_cheap", amount: 50, metadata: { bookingId } }), stripeTestCtx);
      await expectUntouched(bookingId);
    });

    it("does not confirm when the currency is not usd", async () => {
      const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_eur" });
      await handlePaymentIntentSucceeded(pi({ id: "pi_eur", currency: "eur", metadata: { bookingId } }), stripeTestCtx);
      await expectUntouched(bookingId);
    });

    it("does not confirm when the destination is another account", async () => {
      const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_dest" });
      await handlePaymentIntentSucceeded(
        pi({ id: "pi_dest", transfer_data: { destination: "acct_other" }, metadata: { bookingId } }),
        stripeTestCtx,
      );
      await expectUntouched(bookingId);
    });

    it("does not confirm when the PI has no destination", async () => {
      const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_nodest" });
      await handlePaymentIntentSucceeded(pi({ id: "pi_nodest", transfer_data: undefined, metadata: { bookingId } }), stripeTestCtx);
      await expectUntouched(bookingId);
    });

    it("does not auto-refund a cancelled booking's PI when the PI is not the booking's", async () => {
      const { bookingId } = await seedBooking(ctx, { status: "cancelled", stripePaymentIntentId: "pi_was_mine" });
      await handlePaymentIntentSucceeded(pi({ id: "pi_forged", metadata: { bookingId } }), stripeTestCtx);
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });
  });

  it("stores the fee Stripe actually took, not the expected one", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_fee_actual" });
    vi.mocked(stripe.charges.retrieve).mockResolvedValue({
      application_fee: "fee_2",
      application_fee_amount: 300,
      transfer: "tr_2",
    } as any);

    await handlePaymentIntentSucceeded(
      pi({ id: "pi_fee_actual", latest_charge: "ch_2", metadata: { bookingId } }),
      stripeTestCtx,
    );

    const [payment] = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment.applicationFeeCents).toBe(300);
  });

  it("captures applicationFeeId and stripeTransferId from the charge when latest_charge is present", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_charge" });
    vi.mocked(stripe.charges.retrieve).mockResolvedValue({
      application_fee: "fee_1",
      transfer: "tr_1",
    } as any);

    await handlePaymentIntentSucceeded(
      pi({ id: "pi_charge", latest_charge: "ch_1", metadata: { bookingId } }),
      stripeTestCtx,
    );

    expect(stripe.charges.retrieve).toHaveBeenCalledWith("ch_1");
    const [payment] = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
    expect(payment.stripeChargeId).toBe("ch_1");
    expect(payment.applicationFeeId).toBe("fee_1");
    expect(payment.stripeTransferId).toBe("tr_1");
  });
});
