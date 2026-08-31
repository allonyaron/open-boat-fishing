import { waitUntil } from "@vercel/functions";
import { sendPushToEmails } from "@/lib/push";
import { cancelPendingBooking } from "@/lib/bookings/cancel";
import type Stripe from "stripe";

// Restore seats when a PaymentIntent is explicitly cancelled (customer abandoned
// checkout and Stripe cancelled the PI, or we cancelled it programmatically).
// Does not fire on payment_intent.payment_failed — the customer can retry there.
export async function handlePaymentIntentCanceled(pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata.bookingId;
  if (!bookingId) return;

  const booking = await cancelPendingBooking(bookingId);
  if (!booking) return;

  console.log(`Booking cancelled, seats restored: ${booking.confirmationCode} (${bookingId})`);

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
