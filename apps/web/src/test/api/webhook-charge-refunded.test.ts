import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb, stripeTestCtx } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, operators, payments, tickets, trips, stripeCommands } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    applicationFees: {
      createRefund: vi.fn().mockResolvedValue({ id: "fr_test" }),
      retrieve: vi.fn().mockResolvedValue({ amount: 150, amount_refunded: 0 }),
      list: vi.fn().mockResolvedValue({ data: [] }),
      listRefunds: vi.fn().mockResolvedValue({ data: [] }),
    },
    refunds: { list: vi.fn().mockResolvedValue({ data: [] }) },
    paymentIntents: { retrieve: vi.fn().mockResolvedValue({ metadata: {}, transfer_data: null }) },
  },
}));

import { stripe } from "@/lib/stripe";
import { handleChargeRefunded } from "@/lib/webhooks/charge-refunded";

let ctx: SeedResult;

const ACCT = "acct_test_refunded";

beforeAll(async () => {
  ctx = await seedOperator();
  await testDb.update(operators).set({ stripeAccountId: ACCT }).where(eq(operators.id, ctx.operatorId));
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.applicationFees.createRefund).mockClear();
  vi.mocked(stripe.applicationFees.retrieve).mockReset();
  vi.mocked(stripe.applicationFees.retrieve).mockResolvedValue({ amount: 150, amount_refunded: 0 } as any);
  vi.mocked(stripe.refunds.list).mockReset();
  vi.mocked(stripe.refunds.list).mockResolvedValue({ data: [] } as any);
  vi.mocked(stripe.applicationFees.list).mockReset();
  vi.mocked(stripe.applicationFees.list).mockResolvedValue({ data: [] } as any);
});

async function seedPaidBooking(
  piId: string,
  applicationFeeId: string | null = "fee_abc",
  /** The connected account a direct charge is on (row 32); none for a destination charge. */
  stripeAccountId?: string,
) {
  const { bookingId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: piId, stripeAccountId });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    stripeChargeId: `ch_for_${piId}`,
    stripeAccountId: stripeAccountId ?? null,
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
  it("needs review when a partial refund came from outside the app, and leaves the booking alone", async () => {
    const bookingId = await seedPaidBooking("pi_partial");
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [{ id: "re_dash", amount: 5000, metadata: {} }],
    } as any);
    const result = await handleChargeRefunded(
      charge({ id: "ch_partial", amount: 10000, amount_refunded: 5000, payment_intent: "pi_partial" }),
      stripeTestCtx,
    );

    expect(result).toMatchObject({ outcome: "needs_review", operatorId: ctx.operatorId });
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("confirmed");
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
  });

  it("treats a partial refund the app issued itself as handled", async () => {
    const bookingId = await seedPaidBooking("pi_partial_ours");
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [{ id: "re_office", amount: 5000, metadata: { reason: "admin_ticket_refund" } }],
    } as any);
    const result = await handleChargeRefunded(
      charge({ id: "ch_partial_ours", amount: 10000, amount_refunded: 5000, payment_intent: "pi_partial_ours" }),
      stripeTestCtx,
    );
    expect(result).toMatchObject({ outcome: "handled" });
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("confirmed");
  });

  it("ignores a charge with no payment_intent", async () => {
    const result = await handleChargeRefunded(charge({ id: "ch_no_pi", payment_intent: null }), stripeTestCtx);
    expect(result.outcome).toBe("ignored");
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
  });

  it("ignores a refund of another deployment's payment", async () => {
    const result = await handleChargeRefunded(
      charge({ id: "ch_unknown_pi", payment_intent: "pi_unknown_xyz", transfer_data: { destination: "acct_elsewhere" } }),
      stripeTestCtx,
    );
    expect(result.outcome).toBe("ignored");
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
  });

  it("needs review when the payment is this operator's but no booking has it", async () => {
    const result = await handleChargeRefunded(
      charge({ id: "ch_orphan", payment_intent: "pi_orphan", transfer_data: { destination: ACCT } }),
      stripeTestCtx,
    );
    expect(result).toMatchObject({ outcome: "needs_review", operatorId: ctx.operatorId });
  });

  it("throws to be retried when the refund arrives before the payment was recorded (P3-8)", async () => {
    await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_early_refund" });
    await expect(
      handleChargeRefunded(charge({ id: "ch_early", payment_intent: "pi_early_refund" }), stripeTestCtx),
    ).rejects.toThrow(/before its payment was recorded/);
  });

  it("on a full refund: reverses the application fee, cancels the booking, voids tickets, and restores seats", async () => {
    const [before] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));

    const bookingId = await seedPaidBooking("pi_full", "fee_full_1");
    await testDb.update(trips).set({ seatsRemaining: before.seatsRemaining - 1 }).where(eq(trips.id, ctx.tripId));

    // Refunded from the Stripe Dashboard: no refund carries the app's metadata.
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [{ id: "re_dash_full", metadata: {} }] } as any);
    await handleChargeRefunded(charge({ id: "ch_full", amount: 10000, amount_refunded: 10000, payment_intent: "pi_full" }), stripeTestCtx);

    expect(stripe.applicationFees.createRefund).toHaveBeenCalledWith(
      "fee_full_1",
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "dashboard_refund_fee" }) }),
      { idempotencyKey: expect.any(String) },
    );

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

  it("skips the fee reversal when the Dashboard refund already returned the fee, and records no refused refund", async () => {
    vi.mocked(stripe.applicationFees.retrieve).mockResolvedValueOnce({ amount: 150, amount_refunded: 150 } as any);
    const bookingId = await seedPaidBooking("pi_dup_refund", "fee_dup_1");
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [{ id: "re_dash_dup", metadata: {} }] } as any);

    await handleChargeRefunded(charge({ id: "ch_dup", amount: 10000, amount_refunded: 10000, payment_intent: "pi_dup_refund" }), stripeTestCtx);

    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
    const commands = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
    expect(commands).toHaveLength(0);
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });

  it("doesn't reverse the fee again when the app made the refunds itself, and confirms their commands", async () => {
    const bookingId = await seedPaidBooking("pi_ours_full", "fee_ours_1");
    const commandId = randomUUID();
    await testDb.insert(stripeCommands).values({
      id: commandId,
      operatorId: ctx.operatorId,
      kind: "refund",
      bookingId,
      reason: "trip_cancelled",
      targetId: "pi_ours_full",
      amountCents: 10000,
      params: {},
      status: "sent",
    });
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [{ id: "re_ours", metadata: { command_id: commandId, reason: "trip_cancelled" } }],
    } as any);

    const result = await handleChargeRefunded(
      charge({ id: "ch_ours_full", amount: 10000, amount_refunded: 10000, payment_intent: "pi_ours_full" }),
      stripeTestCtx,
    );
    expect(result.outcome).toBe("handled");
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
    const [cmd] = await testDb.select().from(stripeCommands).where(eq(stripeCommands.id, commandId));
    expect(cmd).toMatchObject({ status: "confirmed", stripeObjectId: "re_ours" });
  });

  it("skips the application fee reversal call when applicationFeeId is null", async () => {
    const bookingId = await seedPaidBooking("pi_no_fee", null);
    await handleChargeRefunded(charge({ id: "ch_no_fee", amount: 10000, amount_refunded: 10000, payment_intent: "pi_no_fee" }), stripeTestCtx);

    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });
});

// Row 32: payments are direct charges on the operator's account. A refund the
// operator makes in their own Dashboard comes out of their balance; the
// platform returns the rest of its fee when the charge is fully refunded.
describe("handleChargeRefunded — direct charges on the operator's account (row 32)", () => {
  it("on a full Dashboard refund, returns the rest of the platform fee and cancels the booking, asking only the booking's account", async () => {
    const bookingId = await seedPaidBooking("pi_direct_full", "fee_direct_full", ACCT);
    vi.mocked(stripe.applicationFees.retrieve).mockResolvedValueOnce({ id: "fee_direct_full", amount: 300, amount_refunded: 150 } as any);
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [
        { id: "re_app", amount: 5000, metadata: { reason: "admin_ticket_refund" } },
        { id: "re_dash", amount: 5000, metadata: {} },
      ],
    } as any);

    const result = await handleChargeRefunded(
      charge({ id: "ch_direct_full", payment_intent: "pi_direct_full" }),
      stripeTestCtx,
      ACCT,
    );

    expect(result.outcome).toBe("handled");
    expect(stripe.refunds.list).toHaveBeenCalledWith({ charge: "ch_direct_full", limit: 100 }, { stripeAccount: ACCT });
    const [cmd] = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
    expect(cmd).toMatchObject({ kind: "fee_refund", targetId: "fee_direct_full", amountCents: 150, stripeAccount: null });
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });

  it("refunds a fee Stripe hasn't created yet in full, by its charge", async () => {
    const bookingId = await seedPaidBooking("pi_direct_nofee", null, ACCT);
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [{ id: "re_dash_nofee", metadata: {} }] } as any);

    await handleChargeRefunded(charge({ id: "ch_direct_nofee", payment_intent: "pi_direct_nofee" }), stripeTestCtx, ACCT);

    expect(stripe.applicationFees.list).toHaveBeenCalledWith({ charge: "ch_direct_nofee", limit: 1 });
    const [cmd] = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
    expect(cmd).toMatchObject({ kind: "fee_refund", targetId: "ch_direct_nofee", amountCents: null, status: "pending" });
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("cancelled");
  });

  it("ignores a refund event from another account than the payment's (P3-2)", async () => {
    const bookingId = await seedPaidBooking("pi_direct_other", "fee_direct_other", ACCT);
    const result = await handleChargeRefunded(
      charge({ id: "ch_direct_other", payment_intent: "pi_direct_other" }),
      stripeTestCtx,
      "acct_other",
    );
    expect(result.outcome).toBe("ignored");
    expect(stripe.refunds.list).not.toHaveBeenCalled();
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("confirmed");
  });

  it("ignores the platform's own event for a payment on the operator's account", async () => {
    await seedPaidBooking("pi_direct_platform_evt", "fee_x", ACCT);
    const result = await handleChargeRefunded(
      charge({ id: "ch_direct_platform_evt", payment_intent: "pi_direct_platform_evt" }),
      stripeTestCtx,
      null,
    );
    expect(result.outcome).toBe("ignored");
  });
});
