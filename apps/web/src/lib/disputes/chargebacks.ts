import { and, eq, inArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { disputes, operators, payments, stripeCommands, tickets } from "@openboat/db";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { holdsSeat } from "@/lib/tickets/queries";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { transitionBookings } from "@/lib/bookings/status";
import { earnFeesIfSailed } from "@/lib/settle-trips";
import { queueFeeRefund, queueTransfer, queueTransferReversal, sendCommand, type SendResult } from "@/lib/payments/commands";
import { recordDisputeFee } from "@/lib/payments/operator-debts";
import { OutOfOrderEventError } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, destinationOf, orphanPaymentOwner } from "@/lib/stripe-events/ownership";

// Chargebacks on destination charges (row 11, P3-3). Stripe takes the
// disputed amount and its fee from the platform the day a chargeback opens,
// and never touches the operator's transfer or the platform fee. So:
//
// - Opened (charge.dispute.created, or funds_withdrawn when an inquiry
//   escalates): the booking's live tickets move to disputed (they can't board,
//   the seat and the fee stay held), and the amount is taken back from the
//   operator's transfer with a transfer_reversal command.
// - Won: the tickets are live again and what was taken back is transferred to
//   the operator again (Stripe returns the amount to the platform, not the fee).
// - Lost: the tickets are refunded, their seats come back, the booking is
//   cancelled once nothing holds a seat, and the platform fee on those tickets
//   is refunded to the operator.
// - Either way, the operator owes Stripe's dispute fees (operator_debts).
//
// An inquiry (status warning_*) takes no money, so it moves nothing; Stripe
// sends funds_withdrawn if it becomes a chargeback.
//
// Every step can run again: the ticket moves are conditional, the commands
// have dedupe keys, and once a dispute has closed, a late "opened" event does
// nothing.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export type DisputedPayment = {
  bookingId: string;
  operatorId: string;
  applicationFeeId: string | null;
  stripeTransferId: string | null;
  stripeChargeId: string | null;
};

export type DisputeOwner =
  | { kind: "paid"; payment: DisputedPayment }
  /** A booking cancelled before its payment landed; the payment was refunded in full. */
  | { kind: "cancelled"; bookingId: string; operatorId: string }
  /** No booking here. `ours` says whether it is still this deployment's payment. */
  | { kind: "orphan"; ours: true; operatorId: string }
  | { kind: "orphan"; ours: false; why: string };

export function isInquiry(dispute: Pick<Stripe.Dispute, "status">): boolean {
  return dispute.status.startsWith("warning_");
}

export function paymentIntentOf(dispute: Stripe.Dispute): string | null {
  const pi = dispute.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id;
}

/**
 * Whose payment a dispute is on. Throws OutOfOrderEventError when the booking
 * is ours but its payment_intent.succeeded hasn't been processed yet (Stripe
 * sends charge.dispute.created before it when a card disputes at once).
 */
export async function findDisputedPayment(piId: string): Promise<DisputeOwner> {
  const [payment] = await db
    .select({
      bookingId: payments.bookingId,
      operatorId: payments.operatorId,
      applicationFeeId: payments.applicationFeeId,
      stripeTransferId: payments.stripeTransferId,
      stripeChargeId: payments.stripeChargeId,
    })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));
  if (payment) return { kind: "paid", payment };

  const booking = await bookingForPaymentIntent(piId);
  if (booking?.status === "pending") {
    throw new OutOfOrderEventError(`dispute for PI ${piId} before its payment was recorded`);
  }
  if (booking) return { kind: "cancelled", bookingId: booking.id, operatorId: booking.operatorId };

  // Not a booking here: whose payment is it? The dispute names only the PI.
  const pi = await stripe.paymentIntents.retrieve(piId);
  const owner = await orphanPaymentOwner(destinationOf(pi), pi.metadata);
  return owner.ours ? { kind: "orphan", ours: true, operatorId: owner.operatorId } : { kind: "orphan", ours: false, why: owner.why };
}

/** Stripe's dispute fees on this dispute, net of any it returned (a won countering fee). */
export function disputeFeeCents(dispute: Stripe.Dispute): number {
  return (dispute.balance_transactions ?? []).reduce(
    (sum, bt) => sum + (typeof bt === "object" && bt ? bt.fee : 0),
    0,
  );
}

/**
 * Saves the dispute's latest state. Once it has closed, a late event can't
 * reopen it: only the close sets closed_at, and status then stays put.
 * Returns whether it had already closed before this call.
 */
export async function recordDispute(
  executor: Executor,
  dispute: Stripe.Dispute,
  owner: { operatorId: string; bookingId: string | null },
  opts: { closed?: boolean } = {},
): Promise<{ wasClosed: boolean }> {
  const piId = paymentIntentOf(dispute)!;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null;
  const dueBy = dispute.evidence_details?.due_by;
  const [before] = await executor
    .select({ closedAt: disputes.closedAt })
    .from(disputes)
    .where(eq(disputes.id, dispute.id));
  await executor
    .insert(disputes)
    .values({
      id: dispute.id,
      operatorId: owner.operatorId,
      bookingId: owner.bookingId,
      paymentIntentId: piId,
      chargeId,
      amountCents: dispute.amount,
      reason: dispute.reason,
      status: dispute.status,
      respondBy: dueBy ? new Date(dueBy * 1000) : null,
      openedAt: new Date(dispute.created * 1000),
      ...(opts.closed && { closedAt: new Date(), stripeFeeCents: disputeFeeCents(dispute) }),
    })
    .onConflictDoUpdate({
      target: disputes.id,
      set: {
        status: sql`case when ${disputes.closedAt} is null then excluded.status else ${disputes.status} end`,
        amountCents: sql`case when ${disputes.closedAt} is null then excluded.amount_cents else ${disputes.amountCents} end`,
        respondBy: sql`coalesce(excluded.respond_by, ${disputes.respondBy})`,
        closedAt: sql`coalesce(${disputes.closedAt}, excluded.closed_at)`,
        stripeFeeCents: sql`coalesce(${disputes.stripeFeeCents}, excluded.stripe_fee_cents)`,
        updatedAt: new Date(),
      },
    });
  return { wasClosed: Boolean(before?.closedAt) };
}

const reversalKey = (disputeId: string) => `dispute-reversal:${disputeId}`;

export type TakeBack =
  | { kind: "queued"; amountCents: number; send: SendResult }
  | { kind: "nothing"; why: string };

/**
 * Takes the disputed amount back from the operator's transfer, capped at what
 * is left of it (an earlier refund with reverse_transfer took some back).
 * Once per dispute.
 */
async function takeBackFromOperator(dispute: Stripe.Dispute, payment: DisputedPayment): Promise<TakeBack> {
  const [existing] = await db
    .select({ id: stripeCommands.id, amountCents: stripeCommands.amountCents })
    .from(stripeCommands)
    .where(eq(stripeCommands.dedupeKey, reversalKey(dispute.id)));
  if (existing) {
    return { kind: "queued", amountCents: existing.amountCents ?? 0, send: await sendCommand(existing.id) };
  }
  if (!payment.stripeTransferId) return { kind: "nothing", why: "the payment has no transfer recorded" };

  const transfer = await stripe.transfers.retrieve(payment.stripeTransferId);
  const amountCents = Math.min(dispute.amount, transfer.amount - transfer.amount_reversed);
  if (amountCents <= 0) return { kind: "nothing", why: "nothing is left of the transfer to take back" };

  const commandId = await queueTransferReversal(db, {
    operatorId: payment.operatorId,
    bookingId: payment.bookingId,
    transferId: payment.stripeTransferId,
    amountCents,
    reason: "chargeback",
    metadata: { disputeId: dispute.id },
    dedupeKey: reversalKey(dispute.id),
  });
  return { kind: "queued", amountCents, send: await sendCommand(commandId) };
}

/**
 * A chargeback opened (or an inquiry became one): the tickets can't board and
 * the money is taken back from the operator. Does nothing once the dispute
 * has closed, so a late event can't undo a won dispute.
 */
export async function openChargeback(
  dispute: Stripe.Dispute,
  payment: DisputedPayment,
): Promise<{ closed: true } | { closed: false; ticketsDisputed: number; takeBack: TakeBack }> {
  const { wasClosed, moved } = await db.transaction(async (tx) => {
    const { wasClosed } = await recordDispute(tx, dispute, payment);
    if (wasClosed) return { wasClosed, moved: [] };
    const moved = await moveTickets(
      tx,
      { operatorId: payment.operatorId, bookingId: payment.bookingId },
      "live",
      "disputed",
    );
    return { wasClosed, moved };
  });
  if (wasClosed) return { closed: true };
  return { closed: false, ticketsDisputed: moved.length, takeBack: await takeBackFromOperator(dispute, payment) };
}

export type WonOutcome = {
  ticketsBack: number;
  returned: { kind: "queued"; amountCents: number; send: SendResult } | { kind: "nothing"; why: string };
};

/**
 * The dispute closed in the operator's favour (won, or an inquiry that went
 * no further): the tickets are live again, and what was taken back from the
 * operator is sent back. Throws while the reversal is still waiting to reach
 * Stripe, so the event is retried once it has.
 */
export async function closeChargebackWon(dispute: Stripe.Dispute, payment: DisputedPayment): Promise<WonOutcome> {
  const moved = await db.transaction(async (tx) => {
    await recordDispute(tx, dispute, payment, { closed: true });
    const moved = await moveTickets(
      tx,
      { operatorId: payment.operatorId, bookingId: payment.bookingId },
      "disputed",
      "live",
    );
    await earnFeesIfSailed(tx, payment.operatorId, moved.map((t) => t.id));
    return moved;
  });
  await recordDisputeFee(db, { operatorId: payment.operatorId, disputeId: dispute.id, amountCents: disputeFeeCents(dispute) });

  const [reversal] = await db
    .select({ id: stripeCommands.id, status: stripeCommands.status, amountCents: stripeCommands.amountCents })
    .from(stripeCommands)
    .where(eq(stripeCommands.dedupeKey, reversalKey(dispute.id)));
  if (!reversal) return { ticketsBack: moved.length, returned: { kind: "nothing", why: "nothing was taken back" } };
  if (reversal.status === "pending") {
    throw new Error(`dispute ${dispute.id} was won, but taking it back from the operator hasn't reached Stripe yet`);
  }
  if (reversal.status === "failed") {
    // Nothing was taken from the operator, so there is nothing to return,
    // and the refused reversal no longer needs anyone's attention.
    await db.update(stripeCommands).set({ resolvedAt: new Date() }).where(eq(stripeCommands.id, reversal.id));
    return { ticketsBack: moved.length, returned: { kind: "nothing", why: "taking it back had failed" } };
  }

  const [operator] = await db
    .select({ stripeAccountId: operators.stripeAccountId })
    .from(operators)
    .where(eq(operators.id, payment.operatorId));
  const chargeId = payment.stripeChargeId ?? (typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id);
  if (!operator?.stripeAccountId) throw new Error(`operator ${payment.operatorId} has no Stripe account to return dispute ${dispute.id} to`);

  const amountCents = reversal.amountCents ?? 0;
  const commandId = await queueTransfer(db, {
    operatorId: payment.operatorId,
    bookingId: payment.bookingId,
    destination: operator.stripeAccountId,
    sourceChargeId: chargeId,
    amountCents,
    reason: "chargeback_won",
    metadata: { disputeId: dispute.id },
    dedupeKey: `dispute-return:${dispute.id}`,
  });
  return { ticketsBack: moved.length, returned: { kind: "queued", amountCents, send: await sendCommand(commandId) } };
}

export type LostOutcome = {
  ticketsRefunded: number;
  bookingCancelled: boolean;
  /** Whether the amount was ever taken back from the operator. */
  takenBack: boolean;
};

/**
 * The dispute was lost: the customer keeps the money. The disputed tickets
 * are refunded and their seats come back, the booking is cancelled once
 * nothing on it holds a seat, and the platform fee on those tickets is
 * refunded to the operator.
 */
export async function closeChargebackLost(dispute: Stripe.Dispute, payment: DisputedPayment): Promise<LostOutcome> {
  const scope = { operatorId: payment.operatorId, bookingId: payment.bookingId };
  const { moved, bookingCancelled, feeCommandId } = await db.transaction(async (tx) => {
    await recordDispute(tx, dispute, payment, { closed: true });
    const moved = await moveTickets(tx, scope, "disputed", "refunded");
    await giveBackSeatsForTickets(tx, payment.operatorId, moved, "refund");

    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(eq(tickets.bookingId, payment.bookingId), eq(tickets.operatorId, payment.operatorId), holdsSeat));
    const bookingCancelled =
      moved.length > 0 && (left?.n ?? 0) === 0
        ? (await transitionBookings(tx, scope, "confirmed", "cancelled")).length > 0
        : false;

    let feeCommandId: string | null = null;
    if (moved.length > 0 && payment.applicationFeeId) {
      const fees = await tx
        .select({ cents: tickets.feeAmountCents })
        .from(tickets)
        .where(and(inArray(tickets.id, moved.map((t) => t.id)), eq(tickets.operatorId, payment.operatorId)));
      const feeCents = fees.reduce((sum, f) => sum + f.cents, 0);
      if (feeCents > 0) {
        feeCommandId = await queueFeeRefund(tx, {
          operatorId: payment.operatorId,
          bookingId: payment.bookingId,
          applicationFeeId: payment.applicationFeeId,
          amountCents: feeCents,
          reason: "chargeback_lost",
          metadata: { disputeId: dispute.id },
          dedupeKey: `dispute-fee:${dispute.id}`,
        });
      }
    }
    return { moved, bookingCancelled, feeCommandId };
  });
  await recordDisputeFee(db, { operatorId: payment.operatorId, disputeId: dispute.id, amountCents: disputeFeeCents(dispute) });
  if (feeCommandId) await sendCommand(feeCommandId);

  const [reversal] = await db
    .select({ status: stripeCommands.status })
    .from(stripeCommands)
    .where(eq(stripeCommands.dedupeKey, reversalKey(dispute.id)));
  return { ticketsRefunded: moved.length, bookingCancelled, takenBack: Boolean(reversal) && reversal.status !== "failed" };
}
