import type Stripe from "stripe";
import { db } from "@/lib/db";
import type { EventResult } from "@/lib/stripe-events/inbox";
import { bookingLabel, usd } from "@/lib/stripe-events/notes";
import {
  findDisputedPayment,
  isInquiry,
  openChargeback,
  paymentIntentOf,
  recordDispute,
  type TakeBack,
} from "@/lib/disputes/chargebacks";

/** What the Money page says about the money taken back from the operator. */
export function takeBackNote(takeBack: TakeBack): string {
  if (takeBack.kind === "nothing") return `Nothing was taken back from the boat's Stripe balance (${takeBack.why}).`;
  const what = `${usd(takeBack.amountCents)} taken back from the boat's Stripe balance`;
  if (takeBack.send === "failed") return `Taking ${usd(takeBack.amountCents)} back from the boat's Stripe balance failed; see below.`;
  if (takeBack.send === "pending") return `${what} (queued; Stripe will be asked again).`;
  return `${what}; it is returned if the chargeback is won.`;
}

// A customer opened a dispute. A chargeback (Stripe has taken the money from
// the platform) moves the booking's live tickets to disputed and takes the
// amount back from the operator; an inquiry takes no money and moves nothing.
// Either way someone has to respond in Stripe, so the event is finished as
// needs_review and shows on the Money page.
export async function handleChargeDisputeCreated(dispute: Stripe.Dispute): Promise<EventResult> {
  const piId = paymentIntentOf(dispute);
  if (!piId) return { outcome: "ignored", note: `dispute ${dispute.id} has no payment intent` };

  const owner = await findDisputedPayment(piId);
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
    note: `${label}: the customer disputed ${usd(dispute.amount)} (${dispute.reason}). ${n} ticket${n === 1 ? "" : "s"} can't board until it's resolved. ${takeBackNote(opened.takeBack)} Respond in the Stripe Dashboard.`,
  };
}
