// Row 11 (P3-3): chargebacks on destination charges. Stripe takes the money
// from the platform; the app takes it back from the operator's transfer,
// returns it if the dispute is won, refunds the tickets if it is lost, and
// records Stripe's dispute fee as owed by the operator. Behaviour measured in
// test mode on 2026-11-18: created and funds_withdrawn arrive before
// payment_intent.succeeded; a lost dispute sends charge.dispute.closed and no
// charge.refunded; a won one returns the amount but not the fee.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { disputes, operatorDebts, operators, payments, stripeCommands, tickets, trips, bookings } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: { retrieve: vi.fn() },
    transfers: {
      retrieve: vi.fn(),
      createReversal: vi.fn(),
      listReversals: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
    },
    applicationFees: { createRefund: vi.fn(), listRefunds: vi.fn() },
  },
}));

import { stripe } from "@/lib/stripe";
import { handleChargeDisputeCreated } from "@/lib/webhooks/charge-dispute-created";
import {
  handleChargeDisputeClosed,
  handleChargeDisputeFundsWithdrawn,
  handleChargeDisputeUpdated,
} from "@/lib/webhooks/charge-dispute-later";

let ctx: SeedResult;
const ACCOUNT = "acct_dispute_boat";

beforeAll(async () => {
  ctx = await seedOperator();
  await testDb.update(operators).set({ stripeAccountId: ACCOUNT }).where(eq(operators.id, ctx.operatorId));
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

let seq = 0;
beforeEach(() => {
  vi.mocked(stripe.transfers.retrieve).mockReset();
  vi.mocked(stripe.transfers.createReversal).mockReset();
  vi.mocked(stripe.transfers.create).mockReset();
  vi.mocked(stripe.applicationFees.createRefund).mockReset();
  vi.mocked(stripe.transfers.retrieve).mockResolvedValue({ amount: 10000, amount_reversed: 0 } as any);
  vi.mocked(stripe.transfers.createReversal).mockImplementation(async () => ({ id: `trr_${++seq}` }) as any);
  vi.mocked(stripe.transfers.create).mockImplementation(async () => ({ id: `tr_back_${++seq}` }) as any);
  vi.mocked(stripe.applicationFees.createRefund).mockImplementation(async () => ({ id: `fr_${++seq}` }) as any);
});

async function seedPaid(piId: string) {
  const { bookingId, ticketId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: piId });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    stripeChargeId: `ch_${piId}`,
    stripeTransferId: `tr_${piId}`,
    applicationFeeId: `fee_${piId}`,
    amountCents: 10000,
    applicationFeeCents: 150,
    status: "succeeded",
  });
  return { bookingId, ticketId };
}

function dispute(id: string, piId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    payment_intent: piId,
    charge: `ch_${piId}`,
    amount: 10000,
    reason: "fraudulent",
    status: "needs_response",
    created: 1795025467,
    evidence_details: { due_by: 1796025467 },
    balance_transactions: [{ fee: 1500 }],
    ...overrides,
  } as any;
}

async function ticket(id: string) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, id));
  return row;
}

async function commandsFor(bookingId: string) {
  return testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
}

async function debtFor(disputeId: string) {
  const [row] = await testDb.select().from(operatorDebts).where(eq(operatorDebts.disputeId, disputeId));
  return row;
}

describe("charge.dispute.created", () => {
  it("ignores a dispute with no payment_intent", async () => {
    expect((await handleChargeDisputeCreated(dispute("du_none", null as any))).outcome).toBe("ignored");
  });

  it("ignores a dispute on another deployment's payment", async () => {
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      id: "pi_unknown_dispute",
      transfer_data: { destination: "acct_elsewhere" },
    } as any);
    expect((await handleChargeDisputeCreated(dispute("du_other", "pi_unknown_dispute"))).outcome).toBe("ignored");
  });

  it("ignores a dispute whose booking reference is from another deployment on the same Stripe account", async () => {
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      id: "pi_preview_dispute",
      transfer_data: { destination: ACCOUNT },
      metadata: { bookingId: "0b9f2c4e-8a1d-4c3b-9e7f-5a6d2c1b0e9f" },
    } as any);
    expect((await handleChargeDisputeCreated(dispute("du_preview", "pi_preview_dispute"))).outcome).toBe("ignored");
  });

  it("throws to be retried when it arrives before the payment was recorded (P3-8)", async () => {
    await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_dispute_early" });
    await expect(handleChargeDisputeCreated(dispute("du_early", "pi_dispute_early"))).rejects.toThrow(
      /before its payment was recorded/,
    );
  });

  it("disputes the tickets, keeps their fee held, and takes the amount back from the operator", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_cb_open");
    const result = await handleChargeDisputeCreated(dispute("du_open", "pi_cb_open"));

    expect(result).toMatchObject({ outcome: "needs_review", operatorId: ctx.operatorId });
    expect(result.note).toMatch(/^Booking \w+: the customer disputed \$100\.00 \(fraudulent\)\. 1 ticket can't board/);
    expect(result.note).toMatch(/\$100\.00 taken back from the boat's Stripe balance/);
    expect(await ticket(ticketId)).toMatchObject({ status: "disputed", voided: true, feeStatus: "held" });

    const [cmd] = await commandsFor(bookingId);
    expect(cmd).toMatchObject({
      kind: "transfer_reversal",
      targetId: "tr_pi_cb_open",
      amountCents: 10000,
      status: "confirmed",
      dedupeKey: "dispute-reversal:du_open",
    });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_pi_cb_open",
      expect.objectContaining({ amount: 10000, metadata: expect.objectContaining({ command_id: cmd.id, disputeId: "du_open" }) }),
      { idempotencyKey: cmd.id },
    );

    const [row] = await testDb.select().from(disputes).where(eq(disputes.id, "du_open"));
    expect(row).toMatchObject({ bookingId, status: "needs_response", amountCents: 10000, closedAt: null });
    expect(row.respondBy?.getTime()).toBe(1796025467 * 1000);
  });

  it("takes back no more than is left of the transfer", async () => {
    const { bookingId } = await seedPaid("pi_cb_capped");
    vi.mocked(stripe.transfers.retrieve).mockResolvedValueOnce({ amount: 10000, amount_reversed: 4000 } as any);
    await handleChargeDisputeCreated(dispute("du_capped", "pi_cb_capped"));
    const [cmd] = await commandsFor(bookingId);
    expect(cmd.amountCents).toBe(6000);
  });

  it("does nothing more on a redelivery", async () => {
    const { bookingId } = await seedPaid("pi_cb_again");
    await handleChargeDisputeCreated(dispute("du_again", "pi_cb_again"));
    const again = await handleChargeDisputeCreated(dispute("du_again", "pi_cb_again"));
    expect(again.note).toMatch(/0 tickets can't board/);
    expect(await commandsFor(bookingId)).toHaveLength(1);
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
  });

  it("moves nothing and takes nothing for an inquiry", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_inquiry");
    const result = await handleChargeDisputeCreated(
      dispute("du_inquiry", "pi_inquiry", { status: "warning_needs_response" }),
    );
    expect(result.outcome).toBe("needs_review");
    expect(result.note).toMatch(/bank asked about \$100\.00.*No money has been taken yet/);
    expect((await ticket(ticketId)).status).toBe("live");
    expect(await commandsFor(bookingId)).toHaveLength(0);
  });
});

describe("charge.dispute.funds_withdrawn", () => {
  it("opens the chargeback when an inquiry escalates", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_escalate");
    await handleChargeDisputeCreated(dispute("du_escalate", "pi_escalate", { status: "warning_needs_response" }));
    const result = await handleChargeDisputeFundsWithdrawn(dispute("du_escalate", "pi_escalate"));
    expect(result.outcome).toBe("needs_review");
    expect(result.note).toMatch(/inquiry became a chargeback/);
    expect((await ticket(ticketId)).status).toBe("disputed");
    expect(await commandsFor(bookingId)).toHaveLength(1);
  });

  it("adds nothing after created already opened the chargeback", async () => {
    const { bookingId } = await seedPaid("pi_withdrawn");
    await handleChargeDisputeCreated(dispute("du_withdrawn", "pi_withdrawn"));
    const result = await handleChargeDisputeFundsWithdrawn(dispute("du_withdrawn", "pi_withdrawn"));
    expect(result.outcome).toBe("handled");
    expect(await commandsFor(bookingId)).toHaveLength(1);
  });
});

describe("charge.dispute.updated", () => {
  it("keeps the dispute's status current", async () => {
    await seedPaid("pi_updated");
    await handleChargeDisputeCreated(dispute("du_updated", "pi_updated"));
    await handleChargeDisputeUpdated(dispute("du_updated", "pi_updated", { status: "under_review" }));
    const [row] = await testDb.select().from(disputes).where(eq(disputes.id, "du_updated"));
    expect(row.status).toBe("under_review");
  });
});

describe("charge.dispute.closed — won", () => {
  it("puts the tickets back and returns what was taken to the operator", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_won");
    await handleChargeDisputeCreated(dispute("du_won", "pi_won"));
    const result = await handleChargeDisputeClosed(
      dispute("du_won", "pi_won", { status: "won", balance_transactions: [{ fee: 1500 }, { fee: 0 }] }),
    );

    expect(result.outcome).toBe("handled");
    expect(await ticket(ticketId)).toMatchObject({ status: "live", voided: false, feeStatus: "held" });
    const back = (await commandsFor(bookingId)).find((c) => c.kind === "transfer")!;
    expect(back).toMatchObject({ targetId: ACCOUNT, amountCents: 10000, status: "confirmed" });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10000, destination: ACCOUNT, source_transaction: "ch_pi_won" }),
      { idempotencyKey: back.id },
    );
    expect(await debtFor("du_won")).toMatchObject({ amountCents: 1500, status: "owed" });
    const [row] = await testDb.select().from(disputes).where(eq(disputes.id, "du_won"));
    expect(row).toMatchObject({ status: "won", stripeFeeCents: 1500 });
    expect(row.closedAt).not.toBeNull();
  });

  it("holds the fee again on a ticket disputed before row 11 marked it reversed", async () => {
    const { ticketId } = await seedPaid("pi_won_legacy");
    await testDb
      .update(tickets)
      .set({ status: "disputed", voided: true, feeStatus: "reversed" })
      .where(eq(tickets.id, ticketId));
    await handleChargeDisputeClosed(dispute("du_won_legacy", "pi_won_legacy", { status: "won" }));
    expect(await ticket(ticketId)).toMatchObject({ status: "live", voided: false, feeStatus: "held" });
  });

  it("earns the fee if the trip sailed while the ticket was disputed", async () => {
    const { ticketId } = await seedPaid("pi_won_sailed");
    await handleChargeDisputeCreated(dispute("du_won_sailed", "pi_won_sailed"));
    await testDb.update(trips).set({ status: "sailed" }).where(eq(trips.id, ctx.tripId));
    try {
      await handleChargeDisputeClosed(dispute("du_won_sailed", "pi_won_sailed", { status: "won" }));
      expect(await ticket(ticketId)).toMatchObject({ status: "live", feeStatus: "earned" });
    } finally {
      await testDb.update(trips).set({ status: "scheduled" }).where(eq(trips.id, ctx.tripId));
    }
  });

  it("waits for a reversal that hasn't reached Stripe, then returns it", async () => {
    const { bookingId } = await seedPaid("pi_won_wait");
    vi.mocked(stripe.transfers.createReversal).mockRejectedValueOnce(
      Object.assign(new Error("timeout"), { type: "StripeConnectionError" }),
    );
    await handleChargeDisputeCreated(dispute("du_won_wait", "pi_won_wait"));
    await expect(
      handleChargeDisputeClosed(dispute("du_won_wait", "pi_won_wait", { status: "won" })),
    ).rejects.toThrow(/hasn't reached Stripe/);
    expect(stripe.transfers.create).not.toHaveBeenCalled();

    // The cron sends the reversal; the event's retry then returns the money.
    const [rev] = await commandsFor(bookingId);
    vi.mocked(stripe.transfers.listReversals).mockResolvedValueOnce({ data: [] } as any);
    const { sendCommand } = await import("@/lib/payments/commands");
    expect(await sendCommand(rev.id)).toBe("confirmed");
    await handleChargeDisputeClosed(dispute("du_won_wait", "pi_won_wait", { status: "won" }));
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when taking it back had failed, and clears that from Needs attention", async () => {
    const { bookingId } = await seedPaid("pi_won_failed");
    vi.mocked(stripe.transfers.createReversal).mockRejectedValueOnce(
      Object.assign(new Error("insufficient funds"), { type: "StripeInvalidRequestError" }),
    );
    await handleChargeDisputeCreated(dispute("du_won_failed", "pi_won_failed"));
    const result = await handleChargeDisputeClosed(dispute("du_won_failed", "pi_won_failed", { status: "won" }));
    expect(result.note).toMatch(/nothing to return/);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    const [rev] = await commandsFor(bookingId);
    expect(rev).toMatchObject({ status: "failed" });
    expect(rev.resolvedAt).not.toBeNull();
  });

  it("can't be undone by a late created event", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_won_late");
    await handleChargeDisputeClosed(dispute("du_won_late", "pi_won_late", { status: "won" }));
    await handleChargeDisputeCreated(dispute("du_won_late", "pi_won_late"));
    expect((await ticket(ticketId)).status).toBe("live");
    expect(await commandsFor(bookingId)).toHaveLength(0);
    const [row] = await testDb.select().from(disputes).where(eq(disputes.id, "du_won_late"));
    expect(row.status).toBe("won");
  });
});

describe("charge.dispute.closed — lost", () => {
  it("refunds the tickets, cancels the booking, refunds the platform fee, and records the operator's debt", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_lost");
    const [before] = await testDb.select({ seats: trips.seatsRemaining }).from(trips).where(eq(trips.id, ctx.tripId));
    await handleChargeDisputeCreated(dispute("du_lost", "pi_lost"));
    const result = await handleChargeDisputeClosed(
      dispute("du_lost", "pi_lost", { status: "lost", balance_transactions: [{ fee: 1500 }, { fee: 1500 }] }),
    );

    expect(result).toMatchObject({ outcome: "handled" });
    expect(result.note).toMatch(/1 ticket was refunded and the booking cancelled/);
    expect(await ticket(ticketId)).toMatchObject({ status: "refunded", feeStatus: "reversed" });
    const [b] = await testDb.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
    expect(b.status).toBe("cancelled");
    const [after] = await testDb.select({ seats: trips.seatsRemaining }).from(trips).where(eq(trips.id, ctx.tripId));
    expect(after.seats).toBe((before.seats ?? 0) + 1);

    const fee = (await commandsFor(bookingId)).find((c) => c.kind === "fee_refund")!;
    expect(fee).toMatchObject({ targetId: "fee_pi_lost", amountCents: 150, status: "confirmed" });
    expect(await debtFor("du_lost")).toMatchObject({ amountCents: 3000, status: "owed" });

    // A redelivery changes nothing.
    await handleChargeDisputeClosed(dispute("du_lost", "pi_lost", { status: "lost" }));
    expect((await commandsFor(bookingId)).filter((c) => c.kind === "fee_refund")).toHaveLength(1);
    expect(stripe.applicationFees.createRefund).toHaveBeenCalledTimes(1);
  });

  it("needs review when the money was never taken back from the operator", async () => {
    await seedPaid("pi_lost_kept");
    vi.mocked(stripe.transfers.retrieve).mockResolvedValueOnce({ amount: 10000, amount_reversed: 10000 } as any);
    await handleChargeDisputeCreated(dispute("du_lost_kept", "pi_lost_kept"));
    const result = await handleChargeDisputeClosed(dispute("du_lost_kept", "pi_lost_kept", { status: "lost" }));
    expect(result.outcome).toBe("needs_review");
    expect(result.note).toMatch(/never taken back/);
  });
});
