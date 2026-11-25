import type Stripe from "stripe";
import type { RequestContext } from "@/lib/request-context";
import { db } from "@/lib/db";
import type { EventResult } from "@/lib/stripe-events/inbox";
import { bookingLabel, usd } from "@/lib/stripe-events/notes";
import {
  closeChargebackLost,
  closeChargebackWon,
  findDisputedPayment,
  isInquiry,
  openChargeback,
  paymentIntentOf,
  recordDispute,
} from "@/lib/disputes/chargebacks";
import { takeBackNote } from "./charge-dispute-created";

// The dispute events after charge.dispute.created. Only the dispute's own
// booking is acted on; a dispute on a payment that isn't a booking here was
// already reported (or ignored) when it was created, so these ignore it.

/**
 * charge.dispute.funds_withdrawn: Stripe has taken the money from the
 * platform. For a chargeback this follows created (which already acted); for
 * an inquiry that became a chargeback, this is where the chargeback opens.
 */
export async function handleChargeDisputeFundsWithdrawn(dispute: Stripe.Dispute, ctx: RequestContext): Promise<EventResult> {
  const piId = paymentIntentOf(dispute);
  if (!piId) return { outcome: "ignored", note: `dispute ${dispute.id} has no payment intent` };
  const owner = await findDisputedPayment(piId);
  if (owner.kind !== "paid") return { outcome: "ignored", note: "not a paid booking here" };

  const { payment } = owner;
  const opened = await openChargeback(dispute, payment, ctx);
  if (opened.closed) return { outcome: "handled", operatorId: payment.operatorId, note: `dispute ${dispute.id} had already closed` };
  if (opened.ticketsDisputed === 0) return { outcome: "handled", operatorId: payment.operatorId };
  // Tickets moved only now: the dispute began as an inquiry.
  return {
    outcome: "needs_review",
    operatorId: payment.operatorId,
    note: `${await bookingLabel(payment.bookingId)}: the bank's inquiry became a chargeback of ${usd(dispute.amount)}. ${opened.ticketsDisputed} ticket${opened.ticketsDisputed === 1 ? "" : "s"} can't board until it's resolved. ${takeBackNote(opened.takeBack)} Respond in the Stripe Dashboard.`,
  };
}

/** charge.dispute.updated: evidence submitted, deadline moved. Keeps the read model current. */
export async function handleChargeDisputeUpdated(dispute: Stripe.Dispute): Promise<EventResult> {
  const piId = paymentIntentOf(dispute);
  if (!piId) return { outcome: "ignored", note: `dispute ${dispute.id} has no payment intent` };
  const owner = await findDisputedPayment(piId);
  if (owner.kind === "paid") {
    await recordDispute(db, dispute, owner.payment);
    return { outcome: "handled", operatorId: owner.payment.operatorId };
  }
  if (owner.kind === "cancelled") {
    await recordDispute(db, dispute, { operatorId: owner.operatorId, bookingId: owner.bookingId });
    return { outcome: "handled", operatorId: owner.operatorId };
  }
  return { outcome: "ignored", note: "not a booking here" };
}

/**
 * charge.dispute.closed: won (or an inquiry closed with no chargeback), or
 * lost. A lost dispute never sends charge.refunded, so this is the only
 * signal that the customer kept the money.
 */
export async function handleChargeDisputeClosed(dispute: Stripe.Dispute, ctx: RequestContext): Promise<EventResult> {
  const piId = paymentIntentOf(dispute);
  if (!piId) return { outcome: "ignored", note: `dispute ${dispute.id} has no payment intent` };
  const owner = await findDisputedPayment(piId);
  if (owner.kind === "cancelled") {
    await recordDispute(db, dispute, { operatorId: owner.operatorId, bookingId: owner.bookingId }, { closed: true });
    return { outcome: "handled", operatorId: owner.operatorId, note: `dispute on a cancelled booking closed ${dispute.status}` };
  }
  if (owner.kind !== "paid") return { outcome: "ignored", note: "not a booking here" };

  const { payment } = owner;
  const label = await bookingLabel(payment.bookingId);

  if (dispute.status === "lost") {
    const lost = await closeChargebackLost(dispute, payment, ctx);
    const n = lost.ticketsRefunded;
    const tickets = `${n} ticket${n === 1 ? " was" : "s were"} refunded${lost.bookingCancelled ? " and the booking cancelled" : ""}`;
    if (!lost.takenBack) {
      return {
        outcome: "needs_review",
        operatorId: payment.operatorId,
        note: `${label}: the chargeback of ${usd(dispute.amount)} was lost; ${tickets}. The money was never taken back from the boat's Stripe balance, so the platform has paid it.`,
      };
    }
    return { outcome: "handled", operatorId: payment.operatorId, note: `Chargeback lost: ${tickets}.` };
  }

  if (dispute.status === "won" || isInquiry(dispute)) {
    const won = await closeChargebackWon(dispute, payment, ctx);
    const returned =
      won.returned.kind === "queued"
        ? `${usd(won.returned.amountCents)} returned to the boat (${won.returned.send})`
        : `nothing to return (${won.returned.why})`;
    return {
      outcome: "handled",
      operatorId: payment.operatorId,
      note: `Dispute closed ${dispute.status}: ${won.ticketsBack} ticket${won.ticketsBack === 1 ? "" : "s"} can board again; ${returned}.`,
    };
  }

  // Any other closed status (Stripe has none today) is left for a person.
  await recordDispute(db, dispute, payment, { closed: true });
  return {
    outcome: "needs_review",
    operatorId: payment.operatorId,
    note: `${label}: a dispute closed with status ${dispute.status}, which the app doesn't know how to settle.`,
  };
}
