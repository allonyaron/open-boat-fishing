import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { payments } from "@openboat/db";
import { eq } from "drizzle-orm";
import { moveTickets } from "@/lib/tickets/lifecycle";
import type Stripe from "stripe";
import { OutOfOrderEventError, type EventResult } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, destinationOf, operatorForAccount } from "@/lib/stripe-events/ownership";

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
        note: `Dispute ${dispute.id} on a payment for cancelled booking ${booking.id}`,
      };
    }
    // Not a booking here: whose payment is it? The dispute names only the PI.
    const pi = await stripe.paymentIntents.retrieve(piId);
    const operatorId = await operatorForAccount(destinationOf(pi));
    if (!operatorId) return { outcome: "ignored", note: "not a payment of this deployment" };
    return { outcome: "needs_review", operatorId, note: `Dispute ${dispute.id} on PI ${piId}, which no booking has` };
  }

  // Only live tickets move, so a redelivery changes nothing.
  const disputed = await db.transaction((tx) =>
    moveTickets(tx, { operatorId: payment.operatorId, bookingId: payment.bookingId }, "live", "disputed"),
  );

  return {
    outcome: "needs_review",
    operatorId: payment.operatorId,
    note: `Dispute ${dispute.id} opened on booking ${payment.bookingId} (${dispute.amount} cents, reason ${dispute.reason}); ${disputed.length} ticket(s) can't board until it is resolved. Respond in the Stripe Dashboard.`,
  };
}
