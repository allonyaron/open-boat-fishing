import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { sendPushToEmails } from "@/lib/push";
import { bookings, bookingItems, tickets, trips } from "@openboat/db";
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";

// Restore seats when a PaymentIntent is explicitly cancelled (customer abandoned
// checkout and Stripe cancelled the PI, or we cancelled it programmatically).
// Does not fire on payment_intent.payment_failed — the customer can retry there.
export async function handlePaymentIntentCanceled(pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata.bookingId;
  if (!bookingId) return;

  // FOR UPDATE atomically re-checks status so concurrent webhook deliveries
  // and the expire-pending-bookings cron can't both restore seats.
  const result = await db.transaction(async (tx) => {
    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        confirmationCode: bookings.confirmationCode,
        customerEmail: bookings.customerEmail,
        operatorId: bookings.operatorId,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");

    if (!booking || booking.status === "confirmed" || booking.status === "cancelled") {
      return null;
    }

    const itemRows = await tx
      .select({ id: bookingItems.id, tripId: bookingItems.tripId })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, bookingId));

    for (const item of itemRows) {
      const [{ ticketCount }] = await tx
        .select({ ticketCount: sql<number>`cast(count(*) as int)` })
        .from(tickets)
        .where(eq(tickets.bookingItemId, item.id));

      if (ticketCount > 0) {
        await tx
          .update(trips)
          .set({ seatsRemaining: sql`${trips.seatsRemaining} + ${ticketCount}` })
          .where(eq(trips.id, item.tripId));
      }
    }

    await tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    return booking;
  });

  if (!result) return;
  console.log(`Booking cancelled, seats restored: ${result.confirmationCode} (${bookingId})`);

  if (result.customerEmail) {
    waitUntil(
      sendPushToEmails(
        result.operatorId,
        [result.customerEmail],
        {
          title: "Booking Cancelled",
          body: `Your reservation (${result.confirmationCode}) was cancelled because payment wasn't completed.`,
          data: { type: "booking_cancelled", bookingId },
        },
        "cancellations",
      ).catch((err) => console.error("Push error on PI cancellation:", err)),
    );
  }
}
