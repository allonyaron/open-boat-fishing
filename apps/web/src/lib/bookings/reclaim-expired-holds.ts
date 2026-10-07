import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { sendPushToEmails } from "@/lib/push";
import { bookings, bookingItems, payments } from "@openboat/db";
import { and, eq, inArray, isNull, isNotNull, lt } from "drizzle-orm";
import { cancelPendingBookingInTx, type CancelledBooking } from "./cancel";
import { cancelPaymentIntentForRelease } from "./release";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Bounds the Stripe calls one booking request can make. The expiry cron is the
// backstop for anything beyond this.
const RECLAIM_BATCH_LIMIT = 20;

export type ReclaimableHolds = {
  /** Pending bookings whose PI can no longer succeed. */
  bookingIds: string[];
  /** Every trip those bookings hold seats on, including trips outside the cart. */
  tripIds: string[];
};

/**
 * Phase 1 of reclaiming expired holds (P2-3), run before the booking
 * transaction because it calls Stripe. Finds the expired, unpaid pending
 * bookings on the requested trips and cancels their PaymentIntents. Only
 * bookings whose PI is now certainly canceled (or never existed) are returned;
 * a PI that succeeded, is processing, or errored is left to the webhook and cron.
 */
export async function prepareExpiredHolds(
  operatorId: string,
  tripIds: string[],
  now: Date = new Date(),
): Promise<ReclaimableHolds> {
  const expired = await db
    .selectDistinct({
      id: bookings.id,
      stripePaymentIntentId: bookings.stripePaymentIntentId,
    })
    .from(bookings)
    .innerJoin(bookingItems, eq(bookingItems.bookingId, bookings.id))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.operatorId, operatorId),
        eq(bookings.status, "pending"),
        inArray(bookingItems.tripId, tripIds),
        isNotNull(bookings.holdExpiresAt),
        lt(bookings.holdExpiresAt, now),
        isNull(payments.bookingId),
      ),
    )
    .limit(RECLAIM_BATCH_LIMIT);

  if (expired.length === 0) return { bookingIds: [], tripIds: [] };

  const results = await Promise.all(
    expired.map((b) => cancelPaymentIntentForRelease(b.stripePaymentIntentId)),
  );
  const bookingIds = expired.filter((_, i) => results[i] === "canceled").map((b) => b.id);
  if (bookingIds.length === 0) return { bookingIds: [], tripIds: [] };

  const items = await db
    .selectDistinct({ tripId: bookingItems.tripId })
    .from(bookingItems)
    .where(and(inArray(bookingItems.bookingId, bookingIds), eq(bookingItems.operatorId, operatorId)));

  return { bookingIds, tripIds: items.map((i) => i.tripId) };
}

/**
 * Phase 2: cancel the prepared bookings and restore their seats. The caller
 * must already hold FOR UPDATE locks on every trip in `ReclaimableHolds.tripIds`.
 * Bookings locked by another process are skipped (see cancelPendingBookingInTx).
 * Returns the bookings it cancelled; once the transaction commits, pass them to
 * notifyHoldsExpired.
 */
export async function reclaimExpiredHoldsInTx(tx: Tx, bookingIds: string[]): Promise<CancelledBooking[]> {
  const reclaimed: CancelledBooking[] = [];
  for (const id of bookingIds) {
    const cancelled = await cancelPendingBookingInTx(tx, id, { skipLocked: true });
    if (cancelled) reclaimed.push(cancelled);
  }
  return reclaimed;
}

/**
 * Tells each customer their unpaid hold was released (M10). Used by the expiry
 * cron and by the booking route's reclaim. Whoever cancels the booking sends
 * this: the payment_intent.canceled webhook that follows finds the booking
 * already cancelled and stays silent.
 */
export function notifyHoldsExpired(cancelled: CancelledBooking[]) {
  for (const booking of cancelled) {
    if (!booking.customerEmail) continue;
    waitUntil(
      sendPushToEmails(
        booking.operatorId,
        [booking.customerEmail],
        {
          title: "Booking Expired",
          body: `Your reservation (${booking.confirmationCode}) was released because payment wasn't completed.`,
          data: { type: "booking_expired", bookingId: booking.id },
        },
        "cancellations",
      ).catch((err) => console.error("Push error on booking expiry:", err)),
    );
  }
}
