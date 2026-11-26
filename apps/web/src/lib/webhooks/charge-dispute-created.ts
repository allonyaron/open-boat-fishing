import type Stripe from "stripe";
import type { RequestContext } from "@/lib/request-context";
import { db } from "@/lib/db";
import type { EventResult } from "@/lib/stripe-events/inbox";
import { bookingLabel, usd } from "@/lib/stripe-events/notes";
import {
  findDisputedPayment,
  isInquiry,
  openChargeback,
  paymentIntentOf,
  recordDispute,
} from "@/lib/disputes/chargebacks";

/** What the Money page says about the money a chargeback took (row 32: from the operator's own account). */
export const TAKEN_NOTE =
  "Stripe has taken the amount and its dispute fee from the boat's Stripe balance and returns the amount if the chargeback is won.";

// A customer opened a dispute. A chargeback (Stripe has taken the money from
// the operator's account) moves the booking's live tickets to disputed; an
// inquiry takes no money and moves nothing. Either way the operator has to
// respond in their Stripe Dashboard, so the event is finished as
// needs_review and shows on the Money page.
export async function handleChargeDisputeCreated(
  dispute: Stripe.Dispute,
  _ctx: RequestContext,
  /** event.account: the connected account the charge is on; null for the platform's own. */
  account: string | null = null,
): Promise<EventResult> {
  const piId = paymentIntentOf(dispute);
  if (!piId) return { outcome: "ignored", note: `dispute ${dispute.id} has no payment intent` };

  const owner = await findDisputedPayment(piId, account);
  if (owner.kind === "orphan") {
    if (!owner.ours) return { outcome: "ignored", note: owner.why };
    return {
      outcome: "needs_review",
      operatorId: owner.operatorId,
      note: `A customer disputed ${usd(dispute.amount)} (${dispute.reason}) on a payment no booking has (${piId}). Respond in the Stripe Dashboard.`,
    };
  }
  if (owner.kind === "cancelled") {
    await recordDispute(db, dispute, { operatorId: owner.operatorId, bookingId: owner.bookingId });
    return {
      outcome: "needs_review",
      operatorId: owner.operatorId,
      note: `${await bookingLabel(owner.bookingId)} (cancelled): the customer disputed ${usd(dispute.amount)} (${dispute.reason}). Respond in the Stripe Dashboard.`,
    };
  }

  const { payment } = owner;
  const label = await bookingLabel(payment.bookingId);

  if (isInquiry(dispute)) {
    await recordDispute(db, dispute, payment);
    return {
      outcome: "needs_review",
      operatorId: payment.operatorId,
      note: `${label}: the customer's bank asked about ${usd(dispute.amount)} (${dispute.reason}). No money has been taken yet. Respond in the Stripe Dashboard so it doesn't become a chargeback.`,
    };
  }

  const opened = await openChargeback(dispute, payment);
  if (opened.closed) {
    return { outcome: "handled", operatorId: payment.operatorId, note: `dispute ${dispute.id} had already closed` };
  }
  const n = opened.ticketsDisputed;
  return {
    outcome: "needs_review",
    operatorId: payment.operatorId,
    note: `${label}: the customer disputed ${usd(dispute.amount)} (${dispute.reason}). ${n} ticket${n === 1 ? "" : "s"} can't board until it's resolved. ${TAKEN_NOTE} Respond in the Stripe Dashboard.`,
  };
}
