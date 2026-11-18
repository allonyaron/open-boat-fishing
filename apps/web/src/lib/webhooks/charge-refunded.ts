import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { payments } from "@openboat/db";
import { eq } from "drizzle-orm";
import { cancelConfirmedBooking } from "@/lib/bookings/cancel";
import type Stripe from "stripe";
import { OutOfOrderEventError, type EventResult } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, destinationOf, operatorForAccount } from "@/lib/stripe-events/ownership";
import { confirmRefundCommands, queueFeeRefund, sendCommand } from "@/lib/payments/commands";

/** The `reason` metadata the app puts on the refunds it issues itself. */
const APP_REFUND_REASONS = new Set(["admin_ticket_refund", "trip_cancelled", "auto_refund"]);

function isAppRefund(refund: Stripe.Refund): boolean {
  const meta = refund.metadata ?? {};
  return Boolean(meta.command_id) || APP_REFUND_REASONS.has(meta.reason ?? "") || Boolean(meta.tripId);
}

// A charge was refunded, by the app or from the Stripe Dashboard.
// - Fully refunded: reverse the platform fee and cancel the booking (its live
//   and disputed tickets move to refunded, their seats come back).
// - Partly refunded by the app (office ticket refunds, trip cancellations):
//   those paths already updated the tickets; nothing more to do.
// - Partly refunded from the Dashboard: the app can't tell which tickets were
//   refunded, so the event needs review.
export async function handleChargeRefunded(charge: Stripe.Charge): Promise<EventResult> {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) return { outcome: "ignored", note: `charge ${charge.id} has no payment intent` };

  const [payment] = await db
    .select({
      bookingId: payments.bookingId,
      operatorId: payments.operatorId,
      applicationFeeId: payments.applicationFeeId,
    })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));

  if (!payment) {
    const booking = await bookingForPaymentIntent(piId);
    if (booking?.status === "pending") {
      // Ours, but payment_intent.succeeded hasn't been processed yet (P3-8).
      throw new OutOfOrderEventError(`charge.refunded for PI ${piId} before its payment was recorded`);
    }
    if (booking) {
      // A booking with no payment row that isn't pending was cancelled before
      // its payment landed; this is the auto-refund of that payment.
      return { outcome: "handled", operatorId: booking.operatorId, note: "refund of a payment on a cancelled booking" };
    }
    const operatorId = await operatorForAccount(destinationOf(charge));
    if (!operatorId) return { outcome: "ignored", note: "not a payment of this deployment" };
    return { outcome: "needs_review", operatorId, note: `Charge ${charge.id} refunded but no booking has PI ${piId}` };
  }

  // Which refunds on this charge did the app issue? Its own are confirmed
  // against their commands; the rest came from outside the app (the
  // Stripe Dashboard).
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  await confirmRefundCommands(refunds.data);
  const foreign = refunds.data.filter((r) => !isAppRefund(r));

  if (charge.amount_refunded < charge.amount) {
    if (foreign.length === 0) return { outcome: "handled", operatorId: payment.operatorId };
    return {
      outcome: "needs_review",
      operatorId: payment.operatorId,
      note: `Partial refund from outside the app on booking ${payment.bookingId} (charge ${charge.id}, ${charge.amount_refunded} of ${charge.amount} cents refunded): decide which tickets it covers`,
    };
  }

  // Fully refunded. The app's own refunds already returned the platform fee
  // (in proportion, or exactly per ticket); a refund from outside the app
  // didn't, so reverse what is left of it, once per charge.
  if (foreign.length > 0 && payment.applicationFeeId) {
    const commandId = await queueFeeRefund(db, {
      operatorId: payment.operatorId,
      bookingId: payment.bookingId,
      applicationFeeId: payment.applicationFeeId,
      amountCents: null,
      reason: "dashboard_refund_fee",
      dedupeKey: `fee-refund:${charge.id}`,
    });
    await sendCommand(commandId);
  }

  await cancelConfirmedBooking(payment.bookingId);
  return { outcome: "handled", operatorId: payment.operatorId };
}
