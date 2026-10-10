import { waitUntil } from "@vercel/functions";
import { sendPushToEmails } from "@/lib/push";
import { cancelPendingBooking } from "@/lib/bookings/cancel";
import { notifyHoldsExpired } from "@/lib/bookings/reclaim-expired-holds";
import type Stripe from "stripe";

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
export async function handlePaymentIntentCanceled(pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata.bookingId;
  if (!bookingId) return;

  const booking = await cancelPendingBooking(bookingId);
  if (!booking) return;

  console.log(`Booking cancelled, seats restored: ${booking.confirmationCode} (${bookingId})`);

  if (pi.cancellation_reason === "requested_by_customer") return;
  if (pi.cancellation_reason === "abandoned") {
    notifyHoldsExpired([booking]);
    return;
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
}
