import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { sendPushToEmails } from "@/lib/push";
import { bookings, bookingItems, payments, trips } from "@openboat/db";
import { and, eq, inArray, isNull, isNotNull, lt } from "drizzle-orm";
import { cancelPendingBookingInTx, type CancelledBooking } from "./cancel";
import { cancelPaymentIntentForRelease } from "./release";

// Bounds the Stripe calls one booking request can make. The expiry cron is the
// backstop for anything beyond this.
const RECLAIM_BATCH_LIMIT = 20;

type ReclaimableHolds = {
  /** Pending bookings whose PI can no longer succeed. */
  bookingIds: string[];
  /** Every trip those bookings hold seats on, including trips outside the cart. */
  tripIds: string[];
  /** The booking being replaced turned out to be paid (see reclaimExpiredHolds). */
  replacedPaid: boolean;
};

export type ReclaimResult = {
  /** Bookings cancelled; the replaced one, if any, included. */
  reclaimed: CancelledBooking[];
  /**
   * The checkout's previous booking is paid or paying. The caller must not
   * create a second booking: the customer has already bought these seats.
   */
  replacedPaid: boolean;
};

/**
 * Gives back the seats of expired, unpaid holds on these trips (P2-3), so a
 * new booking doesn't wait for the expiry cron. Call it before the booking
 * transaction, which then counts the restored seats. Returns the bookings it
 * cancelled; their customers get the "Booking Expired" push.
 *
 * The reclaim commits on its own, whatever happens to the booking that
 * triggered it: once a hold's PI is canceled, the hold can never be paid, so
 * cancelling it is right even if that booking then fails (P2-3 follow-up).
 * The freed seats are first come, first served under the trip locks.
 *
 * `replacing` is the checkout's own previous booking, live or not, which the
 * new booking supersedes (the caller has checked its hold token). It is
 * released along with the expired holds, without the expiry push, unless it
 * turns out to be paid: then nothing happens to it and replacedPaid is set.
 */
export async function reclaimExpiredHolds(
  operatorId: string,
  tripIds: string[],
  opts: { replacing?: string; now?: Date } = {},
): Promise<ReclaimResult> {
  const holds = await cancelExpiredHoldPayments(operatorId, tripIds, opts.now ?? new Date(), opts.replacing);
  if (holds.bookingIds.length === 0) return { reclaimed: [], replacedPaid: holds.replacedPaid };

  const reclaimed = await db.transaction(async (tx) => {
    // Every trip these bookings restore seats to, locked in id order, so two
    // reclaims (or a reclaim and a booking) can't deadlock on each other.
    await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(inArray(trips.id, holds.tripIds), eq(trips.operatorId, operatorId)))
      .orderBy(trips.id)
      .for("update");

    const cancelled: CancelledBooking[] = [];
    for (const id of holds.bookingIds) {
      // SKIP LOCKED: a booking another process holds is being cancelled or
      // confirmed by it already. Waiting would invert cancelPendingBooking's
      // lock order (booking, then trips) and could deadlock.
      const booking = await cancelPendingBookingInTx(tx, id, { skipLocked: true });
      if (booking) cancelled.push(booking);
    }
    return cancelled;
  });

  notifyHoldsExpired(reclaimed.filter((b) => b.id !== opts.replacing));
  return { reclaimed, replacedPaid: holds.replacedPaid };
}

/**
 * Finds the expired, unpaid pending bookings on the requested trips, plus the
 * booking being replaced, and cancels their PaymentIntents, outside any
 * transaction because it calls Stripe. Only bookings whose PI is now certainly
 * canceled (or never existed) are returned; a PI that succeeded, is
 * processing, or errored is left to the webhook and cron.
 */
async function cancelExpiredHoldPayments(
  operatorId: string,
  tripIds: string[],
  now: Date,
  replacing: string | undefined,
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

  const candidates = [...expired];
  let replacedPaid = false;
  if (replacing) {
    const [replaced] = await db
      .select({
        id: bookings.id,
        status: bookings.status,
        stripePaymentIntentId: bookings.stripePaymentIntentId,
        paymentId: payments.id,
      })
      .from(bookings)
      .leftJoin(payments, eq(payments.bookingId, bookings.id))
      .where(and(eq(bookings.id, replacing), eq(bookings.operatorId, operatorId)));
    if (replaced?.status === "confirmed" || replaced?.paymentId) {
      replacedPaid = true;
    } else if (replaced?.status === "pending" && !candidates.some((b) => b.id === replacing)) {
      candidates.push({ id: replaced.id, stripePaymentIntentId: replaced.stripePaymentIntentId });
    }
  }

  if (candidates.length === 0) return { bookingIds: [], tripIds: [], replacedPaid };

  const results = await Promise.all(
    candidates.map((b) =>
      cancelPaymentIntentForRelease(
        b.stripePaymentIntentId,
        b.id === replacing ? "requested_by_customer" : "abandoned",
      ),
    ),
  );
  if (replacing && results[candidates.findIndex((b) => b.id === replacing)] === "paid") {
    replacedPaid = true;
  }
  const bookingIds = candidates.filter((_, i) => results[i] === "canceled").map((b) => b.id);
  if (bookingIds.length === 0) return { bookingIds: [], tripIds: [], replacedPaid };

  const items = await db
    .selectDistinct({ tripId: bookingItems.tripId })
    .from(bookingItems)
    .where(and(inArray(bookingItems.bookingId, bookingIds), eq(bookingItems.operatorId, operatorId)));

  return { bookingIds, tripIds: items.map((i) => i.tripId), replacedPaid };
}

/**
 * Tells each customer their unpaid hold was released (M10). Used by the expiry
 * cron and by reclaimExpiredHolds. Whoever cancels the booking sends
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
