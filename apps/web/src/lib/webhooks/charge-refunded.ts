import { db } from "@/lib/db";
import { bookings, bookingItems, tickets, payments, trips } from "@openboat/db";
import { eq, inArray, sql } from "drizzle-orm";
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

  await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .for("update");

    if (!fresh || fresh.status !== "confirmed") return;

    const itemRows = await tx
      .select({ id: bookingItems.id, tripId: bookingItems.tripId })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, payment.bookingId));

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

    const itemIds = itemRows.map((i) => i.id);
    if (itemIds.length > 0) {
      await tx
        .update(tickets)
        .set({ voided: true, feeStatus: "reversed" })
        .where(inArray(tickets.bookingItemId, itemIds));
    }

    await tx
      .update(bookings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(bookings.id, payment.bookingId));
  });

  console.log(`Booking cancelled on full refund: charge ${charge.id}`);
}
