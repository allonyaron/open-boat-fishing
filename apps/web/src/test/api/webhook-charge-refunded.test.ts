import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb, stripeTestCtx } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, operators, operatorDebts, payments, tickets, trips, stripeCommands } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    applicationFees: {
      createRefund: vi.fn().mockResolvedValue({ id: "fr_test" }),
      retrieve: vi.fn().mockResolvedValue({ amount: 150, amount_refunded: 0 }),
    },
    refunds: { list: vi.fn().mockResolvedValue({ data: [] }) },
    paymentIntents: { retrieve: vi.fn().mockResolvedValue({ metadata: {}, transfer_data: null }) },
    transfers: {
      retrieve: vi.fn().mockResolvedValue({ amount: 10000, amount_reversed: 0 }),
      createReversal: vi.fn().mockResolvedValue({ id: "trr_test" }),
    },
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
  vi.mocked(stripe.transfers.createReversal).mockClear();
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

// Row 11 (P3-3): a refund made outside the app that didn't reverse the
// operator's transfer would leave the platform paying the customer while the
// operator keeps the money.
describe("handleChargeRefunded — taking outside refunds back from the operator", () => {
  it("takes a partial Dashboard refund back from the operator's transfer", async () => {
    const bookingId = await seedPaidBooking("pi_dash_partial_rev");
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [{ id: "re_dash_partial_rev", amount: 5000, status: "succeeded", transfer_reversal: null, metadata: {} }],
    } as any);
    const result = await handleChargeRefunded(
      charge({ id: "ch_dash_partial_rev", amount_refunded: 5000, payment_intent: "pi_dash_partial_rev", transfer: "tr_dash_partial_rev" }),
      stripeTestCtx,
    );

    expect(result.outcome).toBe("needs_review");
    expect(result.note).toMatch(/taken back from the boat's Stripe balance/);
    const [cmd] = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
    expect(cmd).toMatchObject({
      kind: "transfer_reversal",
      targetId: "tr_dash_partial_rev",
      amountCents: 5000,
      status: "confirmed",
      dedupeKey: "refund-reversal:re_dash_partial_rev",
    });
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
  });

  it("takes back a second Dashboard refund without counting the first one twice", async () => {
    const bookingId = await seedPaidBooking("pi_dash_two");
    const first = { id: "re_dash_two_a", amount: 5000, status: "succeeded", transfer_reversal: null, metadata: {} };
    const second = { id: "re_dash_two_b", amount: 3000, status: "succeeded", transfer_reversal: null, metadata: {} };
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [first] } as any);
    await handleChargeRefunded(
      charge({ id: "ch_dash_two", amount_refunded: 5000, payment_intent: "pi_dash_two", transfer: "tr_dash_two" }),
      stripeTestCtx,
    );
    // Stripe lists the newest refund first; the first one has been taken back.
    vi.mocked(stripe.transfers.retrieve).mockResolvedValueOnce({ amount: 10000, amount_reversed: 5000 } as any);
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [second, first] } as any);
    await handleChargeRefunded(
      charge({ id: "ch_dash_two", amount_refunded: 8000, payment_intent: "pi_dash_two", transfer: "tr_dash_two" }),
      stripeTestCtx,
    );

    const cmds = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
    expect(cmds.map((c) => `${c.dedupeKey}:${c.amountCents}`).sort()).toEqual([
      "refund-reversal:re_dash_two_a:5000",
      "refund-reversal:re_dash_two_b:3000",
    ]);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(2);
  });

  it("leaves a Dashboard refund that reversed the transfer itself alone", async () => {
    const bookingId = await seedPaidBooking("pi_dash_reversed");
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [{ id: "re_dash_reversed", amount: 10000, status: "succeeded", transfer_reversal: "trr_by_stripe", metadata: {} }],
    } as any);
    await handleChargeRefunded(
      charge({ id: "ch_dash_reversed", payment_intent: "pi_dash_reversed", transfer: "tr_dash_reversed" }),
      stripeTestCtx,
    );
    const cmds = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
    expect(cmds.map((c) => c.kind)).toEqual(["fee_refund"]);
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("on a full Dashboard refund, takes it back first and doesn't hand back a chargeback fee the payment carried", async () => {
    const bookingId = await seedPaidBooking("pi_dash_debt");
    await testDb.insert(operatorDebts).values({
      operatorId: ctx.operatorId,
      kind: "dispute_fee",
      amountCents: 1500,
      status: "collected",
      bookingId,
    });
    vi.mocked(stripe.applicationFees.retrieve).mockResolvedValueOnce({ amount: 1650, amount_refunded: 0 } as any);
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [{ id: "re_dash_debt", amount: 10000, status: "succeeded", transfer_reversal: null, metadata: {} }],
    } as any);
    await handleChargeRefunded(charge({ id: "ch_dash_debt", payment_intent: "pi_dash_debt", transfer: "tr_dash_debt" }), stripeTestCtx);

    const cmds = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
    const reversal = cmds.find((c) => c.kind === "transfer_reversal")!;
    const fee = cmds.find((c) => c.kind === "fee_refund")!;
    expect(reversal.amountCents).toBe(10000);
    expect(fee.amountCents).toBe(150);
    expect(reversal.sentAt!.getTime()).toBeLessThanOrEqual(fee.sentAt!.getTime());
  });
});
