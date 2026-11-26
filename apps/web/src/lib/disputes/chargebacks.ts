import { and, eq, inArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import type { RequestContext } from "@/lib/request-context";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { paymentAccount } from "@/lib/stripe-account";
import { disputes, payments, tickets } from "@openboat/db";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { holdsSeat } from "@/lib/tickets/queries";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { transitionBookings } from "@/lib/bookings/status";
import { earnFeesIfSailed } from "@/lib/settle-trips";
import { queueFeeRefund, sendCommand } from "@/lib/payments/commands";
import { OutOfOrderEventError } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, destinationOf, orphanPaymentOwner, sameAccount } from "@/lib/stripe-events/ownership";

// Chargebacks (row 11, P3-3). Payments are direct charges on the operator's
// own account (row 32), so Stripe takes the disputed amount and its dispute
// fee from the operator, and the operator responds in their Stripe Dashboard.
// The app keeps the tickets in step:
//
// - Opened (charge.dispute.created, or funds_withdrawn when an inquiry
//   escalates): the booking's live tickets move to disputed (they can't board,
//   the seat and the fee stay held).
// - Won: the tickets are live again.
// - Lost: the tickets are refunded, their seats come back, the booking is
//   cancelled once nothing holds a seat, and the platform fee on those tickets
//   is refunded to the operator (the passenger didn't sail).
//
// An inquiry (status warning_*) takes no money, so it moves nothing; Stripe
// sends funds_withdrawn if it becomes a chargeback.
//
// Every step can run again: the ticket moves are conditional, the fee refund
// has a dedupe key, and once a dispute has closed, a late "opened" event does
// nothing.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export type DisputedPayment = {
  bookingId: string;
  operatorId: string;
  applicationFeeId: string | null;
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
 * Whose payment a dispute is on, for an event from `account` (event.account;
 * null for the platform's own). Throws OutOfOrderEventError when the booking
 * is ours but its payment_intent.succeeded hasn't been processed yet (Stripe
 * sends charge.dispute.created before it when a card disputes at once).
 */
export async function findDisputedPayment(piId: string, account: string | null = null): Promise<DisputeOwner> {
  const notItsAccount = { kind: "orphan", ours: false, why: `not the account the payment is on (${account ?? "platform"})` } as const;
  const [payment] = await db
    .select({
      bookingId: payments.bookingId,
      operatorId: payments.operatorId,
      applicationFeeId: payments.applicationFeeId,
      stripeChargeId: payments.stripeChargeId,
      stripeAccountId: payments.stripeAccountId,
    })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));
  if (payment) {
    if (!sameAccount(account, payment.stripeAccountId)) return notItsAccount;
    const { stripeAccountId: _, ...rest } = payment;
    return { kind: "paid", payment: rest };
  }

  const booking = await bookingForPaymentIntent(piId);
  if (booking && !sameAccount(account, booking.stripeAccountId)) return notItsAccount;
  if (booking?.status === "pending") {
    throw new OutOfOrderEventError(`dispute for PI ${piId} before its payment was recorded`);
  }
  if (booking) return { kind: "cancelled", bookingId: booking.id, operatorId: booking.operatorId };

  // Not a booking here: whose payment is it? The dispute names only the PI.
  const pi = await stripe.paymentIntents.retrieve(piId, {}, paymentAccount(account));
  const owner = await orphanPaymentOwner(account ?? destinationOf(pi), pi.metadata);
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
 * Returns whether it has closed, read from the upsert itself: a concurrent
 * close holds the row until it commits, so the answer is current.
 */
export async function recordDispute(
  executor: Executor,
  dispute: Stripe.Dispute,
  owner: { operatorId: string; bookingId: string | null },
  opts: { closed?: boolean } = {},
): Promise<{ closed: boolean }> {
  const piId = paymentIntentOf(dispute)!;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null;
  const dueBy = dispute.evidence_details?.due_by;
  const [row] = await executor
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
    })
    .returning({ closedAt: disputes.closedAt });
  return { closed: Boolean(row?.closedAt) };
}

/**
 * A chargeback opened (or an inquiry became one): the tickets can't board.
 * Stripe has taken the money from the operator's account. Checked against the
 * dispute's close in the same transaction, so a late "opened" event can't
 * undo a won dispute.
 */
export async function openChargeback(
  dispute: Stripe.Dispute,
  payment: DisputedPayment,
): Promise<{ closed: true } | { closed: false; ticketsDisputed: number }> {
  return db.transaction(async (tx) => {
    const { closed } = await recordDispute(tx, dispute, payment);
    if (closed) return { closed: true as const };
    const moved = await moveTickets(
      tx,
      { operatorId: payment.operatorId, bookingId: payment.bookingId },
      "live",
      "disputed",
    );
    return { closed: false as const, ticketsDisputed: moved.length };
  });
}

/**
 * The dispute closed in the operator's favour (won, or an inquiry that went
 * no further): the tickets are live again. Stripe returns the money to the
 * operator's account itself.
 */
export async function closeChargebackWon(
  dispute: Stripe.Dispute,
  payment: DisputedPayment,
): Promise<{ ticketsBack: number }> {
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
  return { ticketsBack: moved.length };
}

export type LostOutcome = {
  ticketsRefunded: number;
  bookingCancelled: boolean;
};

/**
 * The dispute was lost: the customer keeps the money. The booking's disputed
 * tickets (and any still live, if the opening event never got processed) are
 * refunded and their seats come back, the booking is cancelled once nothing
 * on it holds a seat, and the platform fee on those tickets is refunded to
 * the operator.
 */
export async function closeChargebackLost(
  dispute: Stripe.Dispute,
  payment: DisputedPayment,
  ctx: RequestContext,
): Promise<LostOutcome> {
  const scope = { operatorId: payment.operatorId, bookingId: payment.bookingId };
  const disputedCharge = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null;
  const feeOrChargeId = payment.applicationFeeId ?? payment.stripeChargeId ?? disputedCharge;
  const { moved, bookingCancelled, feeCommandId } = await db.transaction(async (tx) => {
    await recordDispute(tx, dispute, payment, { closed: true });
    const moved = [
      ...(await moveTickets(tx, scope, "disputed", "refunded")),
      ...(await moveTickets(tx, scope, "live", "refunded")),
    ];
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
    if (moved.length > 0 && feeOrChargeId) {
      const fees = await tx
        .select({ cents: tickets.feeAmountCents })
        .from(tickets)
        .where(and(inArray(tickets.id, moved.map((t) => t.id)), eq(tickets.operatorId, payment.operatorId)));
      const feeCents = fees.reduce((sum, f) => sum + f.cents, 0);
      if (feeCents > 0) {
        feeCommandId = await queueFeeRefund(tx, {
          ctx,
          operatorId: payment.operatorId,
          bookingId: payment.bookingId,
          feeOrChargeId,
          amountCents: feeCents,
          reason: "chargeback_lost",
          metadata: { disputeId: dispute.id },
          dedupeKey: `dispute-fee:${dispute.id}`,
        });
      }
    }
    return { moved, bookingCancelled, feeCommandId };
  });
  if (feeCommandId) await sendCommand(feeCommandId);
  return { ticketsRefunded: moved.length, bookingCancelled };
}
