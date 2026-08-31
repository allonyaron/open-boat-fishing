import { db } from "@/lib/db";
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
    console.log(
      `Partial refund on charge ${charge.id} (${charge.amount_refunded}/${charge.amount} cents) — no automatic action taken`,
    );
    return;
  }

  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) {
    console.error(`charge.refunded: no payment_intent on charge ${charge.id}`);
    return;
  }

  const [payment] = await db
    .select({ bookingId: payments.bookingId })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));

  if (!payment) {
    console.error(`charge.refunded: no payment row for PI ${piId} — charge ${charge.id}`);
    return;
  }

  await cancelConfirmedBooking(payment.bookingId);

  console.log(`Booking cancelled on full refund: charge ${charge.id}`);
}
