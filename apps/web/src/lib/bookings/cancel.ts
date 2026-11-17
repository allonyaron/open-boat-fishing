import { db } from "@/lib/db";
import { bookings } from "@openboat/db";
import { eq } from "drizzle-orm";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { transitionBookings } from "./status";

export type CancelledBooking = {
  id: string;
  confirmationCode: string;
  customerEmail: string | null;
  operatorId: string;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Atomically cancels a pending (unpaid) booking: voids its held tickets
 * (reversing their fees), restores their seats and sets status to "cancelled".
 *
 * Returns the cancelled booking row (for push notification dispatch), or null
 * if the booking was already handled by a concurrent process (idempotent).
 *
 * Guards with FOR UPDATE so concurrent webhook deliveries and cron runs
 * cannot both restore seats for the same booking.
 */
export async function cancelPendingBooking(
  bookingId: string,
  opts: { expectedPaymentIntentId?: string } = {},
): Promise<CancelledBooking | null> {
  return db.transaction((tx) => cancelPendingBookingInTx(tx, bookingId, opts));
}

/**
 * The body of cancelPendingBooking, for a caller that already holds a
 * transaction (the booking route reclaims expired holds under its trip locks).
 *
 * With skipLocked, a booking another process has locked is left alone and
 * null is returned: that process is already cancelling or confirming it, and
 * the caller holds trip locks, so waiting on the booking row could deadlock
 * against cancelPendingBooking, which locks the booking first, then the trips.
 *
 * With expectedPaymentIntentId, the booking is cancelled only if that is the
 * PI it was created for (the payment_intent.canceled webhook passes the
 * event's PI, which names the booking only through writable metadata).
 */
export async function cancelPendingBookingInTx(
  tx: Tx,
  bookingId: string,
  opts: { skipLocked?: boolean; expectedPaymentIntentId?: string } = {},
): Promise<CancelledBooking | null> {
  const [booking] = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      confirmationCode: bookings.confirmationCode,
      customerEmail: bookings.customerEmail,
      operatorId: bookings.operatorId,
      stripePaymentIntentId: bookings.stripePaymentIntentId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update", opts.skipLocked ? { skipLocked: true } : {});

  if (!booking || booking.status === "confirmed" || booking.status === "cancelled") {
    return null;
  }
  if (
    opts.expectedPaymentIntentId !== undefined &&
    booking.stripePaymentIntentId !== opts.expectedPaymentIntentId
  ) {
    console.error(
      `cancelPendingBooking: PI ${opts.expectedPaymentIntentId} does not belong to booking ${bookingId} (has ${booking.stripePaymentIntentId ?? "none"}); not cancelling`,
    );
    return null;
  }

  // Tickets a cancelled trip already voided aren't held any more, so their
  // seats aren't given back a second time.
  const moved = await moveTickets(tx, { operatorId: booking.operatorId, bookingId }, "held", "voided");
  await giveBackSeatsForTickets(tx, booking.operatorId, moved, "release");
  await transitionBookings(tx, { operatorId: booking.operatorId, bookingId }, "pending", "cancelled");

  return {
    id: booking.id,
    confirmationCode: booking.confirmationCode,
    customerEmail: booking.customerEmail,
    operatorId: booking.operatorId,
  };
}

/**
 * Atomically cancels a confirmed (paid) booking after a full refund: marks its
 * live and disputed tickets refunded (reversing their fees), restores their
 * seats and sets status to "cancelled". Skips if the booking is already
 * cancelled (idempotent).
 *
 * Guards with FOR UPDATE so a concurrent refund event cannot double-cancel.
 */
export async function cancelConfirmedBooking(bookingId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select({ id: bookings.id, status: bookings.status, operatorId: bookings.operatorId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");

    if (!fresh || fresh.status !== "confirmed") return;

    // A disputed ticket kept its seat, so it comes back here too.
    const scope = { operatorId: fresh.operatorId, bookingId };
    const moved = [
      ...(await moveTickets(tx, scope, "live", "refunded")),
      ...(await moveTickets(tx, scope, "disputed", "refunded")),
    ];
    await giveBackSeatsForTickets(tx, fresh.operatorId, moved, "refund");
    await transitionBookings(tx, scope, "confirmed", "cancelled");
  });
}
