import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { bookings } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { cancelPendingBooking } from "./cancel";

/**
 * Makes sure a pending booking's PaymentIntent can never succeed, so its seats
 * can be given back without a late payment landing on a cancelled booking
 * (the succeeded webhook would then auto-refund the customer).
 *
 * - "canceled": there is no PI, or it is canceled now. Safe to restore seats.
 * - "paid": the PI succeeded or is processing. Leave the booking to the webhook.
 * - "error": Stripe failed, or the PI changed state under us. Not safe; try later.
 *
 * `reason` travels to the payment_intent.canceled webhook, which may cancel
 * the booking before the caller does and so decides the customer's push:
 * "requested_by_customer" (they left or replaced the checkout) sends none,
 * "abandoned" (the hold expired) sends "Booking Expired".
 */
export async function cancelPaymentIntentForRelease(
  paymentIntentId: string | null,
  reason: "abandoned" | "requested_by_customer",
): Promise<"canceled" | "paid" | "error"> {
  if (!paymentIntentId) return "canceled";
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === "succeeded" || pi.status === "processing") return "paid";
    if (pi.status !== "canceled") {
      await stripe.paymentIntents.cancel(paymentIntentId, { cancellation_reason: reason });
    }
    return "canceled";
  } catch (err) {
    console.error(`Failed to cancel PaymentIntent ${paymentIntentId}:`, err);
    return "error";
  }
}

export type ReleaseResult = "released" | "not_found" | "paid" | "error";

/**
 * Gives back a pending booking's seats on the customer's request: their hold
 * ran out on the checkout page, or they are replacing the booking. Cancels the
 * PI first, then the booking. Idempotent: an already-cancelled booking counts
 * as released.
 */
export async function releasePendingBooking(
  operatorId: string,
  bookingId: string,
): Promise<ReleaseResult> {
  const [booking] = await db
    .select({
      status: bookings.status,
      stripePaymentIntentId: bookings.stripePaymentIntentId,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.operatorId, operatorId)));

  if (!booking) return "not_found";
  if (booking.status === "cancelled") return "released";
  if (booking.status === "confirmed") return "paid";

  const pi = await cancelPaymentIntentForRelease(booking.stripePaymentIntentId, "requested_by_customer");
  if (pi !== "canceled") return pi;

  // Null means a concurrent cancel (webhook, cron) or confirm got there first.
  // A confirm is impossible once the PI is canceled, so either way it is released.
  await cancelPendingBooking(bookingId);
  return "released";
}
