import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { payments } from "@openboat/db";
import { eq } from "drizzle-orm";
import { cancelConfirmedBooking } from "@/lib/bookings/cancel";
import type Stripe from "stripe";

// Void tickets and cancel booking when a charge is fully refunded externally
// (e.g., refund issued directly from the Stripe dashboard).
// Partial refunds are logged but require manual review to determine which
// tickets to void — the booking stays confirmed.
export async function handleChargeRefunded(charge: Stripe.Charge) {
  if (charge.amount_refunded < charge.amount) {
    console.error(
      `Partial refund on charge ${charge.id} (${charge.amount_refunded}/${charge.amount} cents) — manual review required to determine which tickets to void`,
    );
    return;
  }

  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) {
    console.error(`charge.refunded: no payment_intent on charge ${charge.id}`);
    return;
  }

  const [payment] = await db
    .select({ bookingId: payments.bookingId, applicationFeeId: payments.applicationFeeId })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));

  if (!payment) {
    console.error(`charge.refunded: no payment row for PI ${piId} — charge ${charge.id}`);
    return;
  }

  // Reverse the platform fee before cancelling. Treat "already refunded" as success
  // so duplicate webhook deliveries don't abort the cancellation path.
  if (payment.applicationFeeId) {
    try {
      await stripe.applicationFees.createRefund(payment.applicationFeeId);
    } catch (err: any) {
      if (err?.code !== "fee_refund_already_refunded") {
        console.error(`Failed to reverse application fee ${payment.applicationFeeId}:`, err);
      }
    }
  }

  await cancelConfirmedBooking(payment.bookingId);

  console.log(`Booking cancelled on full refund: charge ${charge.id}`);
}
