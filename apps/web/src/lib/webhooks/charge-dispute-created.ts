import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { payments } from "@openboat/db";
import { eq } from "drizzle-orm";
import { moveTickets } from "@/lib/tickets/lifecycle";
import type Stripe from "stripe";
import { OutOfOrderEventError, type EventResult } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, destinationOf, operatorForAccount } from "@/lib/stripe-events/ownership";
import { bookingLabel, usd } from "@/lib/stripe-events/notes";

// A customer opened a dispute (chargeback). The booking's live tickets move to
// disputed so they can't board; the booking stays confirmed and the seats stay
// taken. A new dispute always needs someone to respond to it in Stripe, so the
// event is finished as needs_review and shows on the Money page.
export async function handleChargeDisputeCreated(dispute: Stripe.Dispute): Promise<EventResult> {
  const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : null;
  if (!piId) return { outcome: "ignored", note: `dispute ${dispute.id} has no payment intent` };

  const [payment] = await db
    .select({ bookingId: payments.bookingId, operatorId: payments.operatorId })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));

  if (!payment) {
    const booking = await bookingForPaymentIntent(piId);
    if (booking?.status === "pending") {
      throw new OutOfOrderEventError(`dispute ${dispute.id} for PI ${piId} before its payment was recorded`);
    }
    if (booking) {
      return {
        outcome: "needs_review",
        operatorId: booking.operatorId,
        note: `${await bookingLabel(booking.id)} (cancelled): the customer disputed ${usd(dispute.amount)} (${dispute.reason}). Respond in the Stripe Dashboard.`,
      };
    }
    // Not a booking here: whose payment is it? The dispute names only the PI.
    const pi = await stripe.paymentIntents.retrieve(piId);
    const operatorId = await operatorForAccount(destinationOf(pi));
    if (!operatorId) return { outcome: "ignored", note: "not a payment of this deployment" };
    return {
      outcome: "needs_review",
      operatorId,
      note: `A customer disputed ${usd(dispute.amount)} (${dispute.reason}) on a payment no booking has (${piId}). Respond in the Stripe Dashboard.`,
    };
  }

  // Only live tickets move, so a redelivery changes nothing.
  const disputed = await db.transaction((tx) =>
    moveTickets(tx, { operatorId: payment.operatorId, bookingId: payment.bookingId }, "live", "disputed"),
  );

  return {
    outcome: "needs_review",
    operatorId: payment.operatorId,
    note: `${await bookingLabel(payment.bookingId)}: the customer disputed ${usd(dispute.amount)} (${dispute.reason}). ${disputed.length} ticket${disputed.length === 1 ? "" : "s"} can't board until it's resolved. Respond in the Stripe Dashboard.`,
  };
}
