// Chargebacks (row 11, P3-3) on direct charges (row 32). Stripe takes the
// disputed amount and its dispute fee from the operator's own account, so the
// app moves no money while a dispute is open or won: it keeps the tickets in
// step (disputed, then live again or refunded) and refunds the platform fee on
// tickets lost to a chargeback. Behaviour measured in test mode on 2026-11-18:
// created and funds_withdrawn arrive before payment_intent.succeeded; a lost
// dispute sends charge.dispute.closed and no charge.refunded.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb, stripeTestCtx } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { disputes, operators, payments, stripeCommands, tickets, trips, bookings } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: { retrieve: vi.fn() },
    applicationFees: { createRefund: vi.fn(), listRefunds: vi.fn(), list: vi.fn() },
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
  vi.mocked(stripe.paymentIntents.retrieve).mockReset();
  vi.mocked(stripe.applicationFees.createRefund).mockReset();
  vi.mocked(stripe.applicationFees.list).mockReset();
  vi.mocked(stripe.applicationFees.createRefund).mockImplementation(async () => ({ id: `fr_${++seq}` }) as any);
});

/** A paid direct charge on the operator's account. */
async function seedPaid(piId: string, opts: { feeId?: string | null } = {}) {
  const { bookingId, ticketId } = await seedBooking(ctx, {
    status: "confirmed",
    stripePaymentIntentId: piId,
    stripeAccountId: ACCOUNT,
  });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    stripeChargeId: `ch_${piId}`,
    stripeAccountId: ACCOUNT,
    applicationFeeId: opts.feeId === undefined ? `fee_${piId}` : opts.feeId,
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

describe("charge.dispute.created", () => {
  it("ignores a dispute with no payment_intent", async () => {
    expect((await handleChargeDisputeCreated(dispute("du_none", null as any), stripeTestCtx, ACCOUNT)).outcome).toBe(
      "ignored",
    );
  });

  it("ignores a dispute on another deployment's account, asking that account about it", async () => {
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({ id: "pi_unknown_dispute", metadata: {} } as any);
    const result = await handleChargeDisputeCreated(
      dispute("du_other", "pi_unknown_dispute"),
      stripeTestCtx,
      "acct_elsewhere",
    );
    expect(result.outcome).toBe("ignored");
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_unknown_dispute", {}, { stripeAccount: "acct_elsewhere" });
  });

  it("ignores a dispute whose booking reference is from another deployment on the same Stripe account", async () => {
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      id: "pi_preview_dispute",
      metadata: { bookingId: "0b9f2c4e-8a1d-4c3b-9e7f-5a6d2c1b0e9f" },
    } as any);
    expect(
      (await handleChargeDisputeCreated(dispute("du_preview", "pi_preview_dispute"), stripeTestCtx, ACCOUNT)).outcome,
    ).toBe("ignored");
  });

  it("throws to be retried when it arrives before the payment was recorded (P3-8)", async () => {
    await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_dispute_early", stripeAccountId: ACCOUNT });
    await expect(
      handleChargeDisputeCreated(dispute("du_early", "pi_dispute_early"), stripeTestCtx, ACCOUNT),
    ).rejects.toThrow(/before its payment was recorded/);
  });

  it("ignores a dispute event from another account than the payment's (P3-2)", async () => {
    const { ticketId } = await seedPaid("pi_cb_wrong_acct");
    const result = await handleChargeDisputeCreated(dispute("du_wrong_acct", "pi_cb_wrong_acct"), stripeTestCtx, "acct_x");
    expect(result.outcome).toBe("ignored");
    expect((await ticket(ticketId)).status).toBe("live");
  });

  it("disputes the tickets and keeps their fee held, moving no money: Stripe took it from the operator", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_cb_open");
    const result = await handleChargeDisputeCreated(dispute("du_open", "pi_cb_open"), stripeTestCtx, ACCOUNT);

    expect(result).toMatchObject({ outcome: "needs_review", operatorId: ctx.operatorId });
    expect(result.note).toMatch(/^Booking \w+: the customer disputed \$100\.00 \(fraudulent\)\. 1 ticket can't board/);
    expect(result.note).toMatch(/Stripe has taken the amount and its dispute fee from the boat's Stripe balance/);
    expect(await ticket(ticketId)).toMatchObject({ status: "disputed", voided: true, feeStatus: "held" });
    expect(await commandsFor(bookingId)).toHaveLength(0);

    const [row] = await testDb.select().from(disputes).where(eq(disputes.id, "du_open"));
    expect(row).toMatchObject({ bookingId, status: "needs_response", amountCents: 10000, closedAt: null });
    expect(row.respondBy?.getTime()).toBe(1796025467 * 1000);
  });

  it("does nothing more on a redelivery", async () => {
    await seedPaid("pi_cb_again");
    await handleChargeDisputeCreated(dispute("du_again", "pi_cb_again"), stripeTestCtx, ACCOUNT);
    const again = await handleChargeDisputeCreated(dispute("du_again", "pi_cb_again"), stripeTestCtx, ACCOUNT);
    expect(again.note).toMatch(/0 tickets can't board/);
  });

  it("moves nothing for an inquiry", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_inquiry");
    const result = await handleChargeDisputeCreated(
      dispute("du_inquiry", "pi_inquiry", { status: "warning_needs_response" }),
      stripeTestCtx,
      ACCOUNT,
    );
    expect(result.outcome).toBe("needs_review");
    expect(result.note).toMatch(/bank asked about \$100\.00.*No money has been taken yet/);
    expect((await ticket(ticketId)).status).toBe("live");
    expect(await commandsFor(bookingId)).toHaveLength(0);
  });
});

describe("charge.dispute.funds_withdrawn", () => {
  it("opens the chargeback when an inquiry escalates", async () => {
    const { ticketId } = await seedPaid("pi_escalate");
    await handleChargeDisputeCreated(
      dispute("du_escalate", "pi_escalate", { status: "warning_needs_response" }),
      stripeTestCtx,
      ACCOUNT,
    );
    const result = await handleChargeDisputeFundsWithdrawn(dispute("du_escalate", "pi_escalate"), stripeTestCtx, ACCOUNT);
    expect(result.outcome).toBe("needs_review");
    expect(result.note).toMatch(/inquiry became a chargeback/);
    expect((await ticket(ticketId)).status).toBe("disputed");
  });

  it("adds nothing after created already opened the chargeback", async () => {
    await seedPaid("pi_withdrawn");
    await handleChargeDisputeCreated(dispute("du_withdrawn", "pi_withdrawn"), stripeTestCtx, ACCOUNT);
    const result = await handleChargeDisputeFundsWithdrawn(dispute("du_withdrawn", "pi_withdrawn"), stripeTestCtx, ACCOUNT);
    expect(result.outcome).toBe("handled");
  });
});

describe("charge.dispute.updated", () => {
  it("keeps the dispute's status current", async () => {
    await seedPaid("pi_updated");
    await handleChargeDisputeCreated(dispute("du_updated", "pi_updated"), stripeTestCtx, ACCOUNT);
    await handleChargeDisputeUpdated(dispute("du_updated", "pi_updated", { status: "under_review" }), ACCOUNT);
    const [row] = await testDb.select().from(disputes).where(eq(disputes.id, "du_updated"));
    expect(row.status).toBe("under_review");
  });
});

describe("charge.dispute.closed — won", () => {
  it("puts the tickets back and moves no money: Stripe returns it to the operator", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_won");
    await handleChargeDisputeCreated(dispute("du_won", "pi_won"), stripeTestCtx, ACCOUNT);
    const result = await handleChargeDisputeClosed(
      dispute("du_won", "pi_won", { status: "won", balance_transactions: [{ fee: 1500 }, { fee: 0 }] }),
      stripeTestCtx,
      ACCOUNT,
    );

    expect(result.outcome).toBe("handled");
    expect(result.note).toMatch(/1 ticket can board again/);
    expect(await ticket(ticketId)).toMatchObject({ status: "live", voided: false, feeStatus: "held" });
    expect(await commandsFor(bookingId)).toHaveLength(0);
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
    await handleChargeDisputeClosed(dispute("du_won_legacy", "pi_won_legacy", { status: "won" }), stripeTestCtx, ACCOUNT);
    expect(await ticket(ticketId)).toMatchObject({ status: "live", voided: false, feeStatus: "held" });
  });

  it("earns the fee if the trip sailed while the ticket was disputed", async () => {
    const { ticketId } = await seedPaid("pi_won_sailed");
    await handleChargeDisputeCreated(dispute("du_won_sailed", "pi_won_sailed"), stripeTestCtx, ACCOUNT);
    await testDb.update(trips).set({ status: "sailed" }).where(eq(trips.id, ctx.tripId));
    try {
      await handleChargeDisputeClosed(dispute("du_won_sailed", "pi_won_sailed", { status: "won" }), stripeTestCtx, ACCOUNT);
      expect(await ticket(ticketId)).toMatchObject({ status: "live", feeStatus: "earned" });
    } finally {
      await testDb.update(trips).set({ status: "scheduled" }).where(eq(trips.id, ctx.tripId));
    }
  });

  it("can't be undone by a late created event", async () => {
    const { ticketId } = await seedPaid("pi_won_late");
    await handleChargeDisputeClosed(dispute("du_won_late", "pi_won_late", { status: "won" }), stripeTestCtx, ACCOUNT);
    await handleChargeDisputeCreated(dispute("du_won_late", "pi_won_late"), stripeTestCtx, ACCOUNT);
    expect((await ticket(ticketId)).status).toBe("live");
    const [row] = await testDb.select().from(disputes).where(eq(disputes.id, "du_won_late"));
    expect(row.status).toBe("won");
  });
});

describe("charge.dispute.closed — lost", () => {
  it("refunds the tickets, cancels the booking and refunds the platform fee on them", async () => {
    const { bookingId, ticketId } = await seedPaid("pi_lost");
    const [before] = await testDb.select({ seats: trips.seatsRemaining }).from(trips).where(eq(trips.id, ctx.tripId));
    await handleChargeDisputeCreated(dispute("du_lost", "pi_lost"), stripeTestCtx, ACCOUNT);
    const result = await handleChargeDisputeClosed(
      dispute("du_lost", "pi_lost", { status: "lost", balance_transactions: [{ fee: 1500 }, { fee: 1500 }] }),
      stripeTestCtx,
      ACCOUNT,
    );

    expect(result).toMatchObject({ outcome: "handled" });
    expect(result.note).toMatch(/1 ticket was refunded and the booking cancelled/);
    expect(await ticket(ticketId)).toMatchObject({ status: "refunded", feeStatus: "reversed" });
    const [b] = await testDb.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
    expect(b.status).toBe("cancelled");
    const [after] = await testDb.select({ seats: trips.seatsRemaining }).from(trips).where(eq(trips.id, ctx.tripId));
    expect(after.seats).toBe((before.seats ?? 0) + 1);

    const cmds = await commandsFor(bookingId);
    expect(cmds.map((c) => c.kind)).toEqual(["fee_refund"]);
    expect(cmds[0]).toMatchObject({ targetId: "fee_pi_lost", amountCents: 150, status: "confirmed", stripeAccount: null });
    const [row] = await testDb.select().from(disputes).where(eq(disputes.id, "du_lost"));
    expect(row.stripeFeeCents).toBe(3000);

    // A redelivery changes nothing.
    await handleChargeDisputeClosed(dispute("du_lost", "pi_lost", { status: "lost" }), stripeTestCtx, ACCOUNT);
    expect((await commandsFor(bookingId)).filter((c) => c.kind === "fee_refund")).toHaveLength(1);
    expect(stripe.applicationFees.createRefund).toHaveBeenCalledTimes(1);
  });

  it("finds the platform fee by the charge when the payment doesn't have its id", async () => {
    const { bookingId } = await seedPaid("pi_lost_nofee", { feeId: null });
    vi.mocked(stripe.applicationFees.list).mockResolvedValue({ data: [{ id: "fee_found_later" }] } as any);
    vi.mocked(stripe.applicationFees.listRefunds).mockResolvedValue({ data: [] } as any);
    await handleChargeDisputeClosed(dispute("du_lost_nofee", "pi_lost_nofee", { status: "lost" }), stripeTestCtx, ACCOUNT);
    const [cmd] = await commandsFor(bookingId);
    expect(cmd).toMatchObject({ kind: "fee_refund", targetId: "ch_pi_lost_nofee", status: "confirmed" });
    expect(vi.mocked(stripe.applicationFees.createRefund).mock.calls[0][0]).toBe("fee_found_later");
  });
});

describe("listChargebacks (Money page)", () => {
  it("lists each dispute with its state and the fee Stripe charged the operator once it closed", async () => {
    const { listChargebacks } = await import("@/lib/disputes/list");
    const items = await listChargebacks(ctx.operatorId);
    const byId = new Map(items.map((i) => [i.id, i]));

    expect(byId.get("du_open")).toMatchObject({ state: "open", amountCents: 10000, stripeFeeCents: null });
    expect(byId.get("du_inquiry")).toMatchObject({ state: "inquiry" });
    expect(byId.get("du_updated")).toMatchObject({ state: "under_review" });
    expect(byId.get("du_won")).toMatchObject({ state: "won", stripeFeeCents: 1500 });
    expect(byId.get("du_lost")).toMatchObject({ state: "lost", stripeFeeCents: 3000 });
    expect(byId.get("du_open")!.respondBy).toBe(new Date(1796025467 * 1000).toISOString());
  });
});
