import { waitUntil } from "@vercel/functions";
import { sendPushToEmails } from "@/lib/push";
import { cancelPendingBooking } from "@/lib/bookings/cancel";
import { notifyHoldsExpired } from "@/lib/bookings/reclaim-expired-holds";
import type Stripe from "stripe";
import type { EventResult } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, sameAccount } from "@/lib/stripe-events/ownership";

// Restore seats when a PaymentIntent is explicitly cancelled (customer abandoned
// checkout and Stripe cancelled the PI, or we cancelled it programmatically).
// Does not fire on payment_intent.payment_failed — the customer can retry there.
//
// We usually cancel the booking ourselves right after cancelling its PI, and
// then this finds it already cancelled. When this wins the race, the PI's
// cancellation_reason says which push the customer should get:
// - requested_by_customer: they left or replaced the checkout (release,
//   replaces). No push: they know.
// - abandoned: the hold expired (cron, reclaim). The same "Booking Expired"
//   push those send.
// - anything else (a cancel from the Stripe Dashboard, say): "Booking Cancelled".
export async function handlePaymentIntentCanceled(
  pi: Stripe.PaymentIntent,
  /** event.account: the connected account the PI is on; null for the platform's own. */
  account: string | null = null,
): Promise<EventResult> {
  // Found by the PI id the booking stored, never by metadata (P3-2). No
  // booking means no seats are held for it: nothing to do.
  const found = await bookingForPaymentIntent(pi.id);
  if (!found) return { outcome: "ignored", note: "no booking has this payment" };
  if (!sameAccount(account, found.stripeAccountId)) {
    return { outcome: "ignored", note: `not the account the booking's payment is on (${account ?? "platform"})` };
  }
  const bookingId = found.id;

  // The PI id is checked again under the booking lock.
  const booking = await cancelPendingBooking(bookingId, { expectedPaymentIntentId: pi.id });
  if (!booking) return { outcome: "handled", operatorId: found.operatorId, note: "booking was not pending" };

  console.log(`Booking cancelled, seats restored: ${booking.confirmationCode} (${bookingId})`);

  const handled: EventResult = { outcome: "handled", operatorId: booking.operatorId };
  if (pi.cancellation_reason === "requested_by_customer") return handled;
  if (pi.cancellation_reason === "abandoned") {
    notifyHoldsExpired([booking]);
    return handled;
  }

  if (booking.customerEmail) {
    waitUntil(
      sendPushToEmails(
        booking.operatorId,
        [booking.customerEmail],
        {
          title: "Booking Cancelled",
          body: `Your reservation (${booking.confirmationCode}) was cancelled because payment wasn't completed.`,
          data: { type: "booking_cancelled", bookingId },
        },
        "cancellations",
      ).catch((err) => console.error("Push error on PI cancellation:", err)),
    );
  }
  return handled;
}
