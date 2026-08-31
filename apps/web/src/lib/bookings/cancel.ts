import { db } from "@/lib/db";
import { bookings, bookingItems, tickets, trips } from "@openboat/db";
import { eq, inArray, sql } from "drizzle-orm";

export type CancelledBooking = {
  id: string;
  confirmationCode: string;
  customerEmail: string | null;
  operatorId: string;
};

/**
 * Atomically cancels a pending (unpaid) booking: restores trip seats from
 * ticket counts and sets status to "cancelled".
 *
 * Returns the cancelled booking row (for push notification dispatch), or null
 * if the booking was already handled by a concurrent process (idempotent).
 *
 * Guards with FOR UPDATE so concurrent webhook deliveries and cron runs
 * cannot both restore seats for the same booking.
 */
export async function cancelPendingBooking(bookingId: string): Promise<CancelledBooking | null> {
  return db.transaction(async (tx) => {
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

    await tx
      .update(bookings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(bookings.id, bookingId));

    return booking;
  });
}

/**
 * Atomically cancels a confirmed (paid) booking after a full refund: restores
 * trip seats, voids tickets, reverses platform fees, and sets status to
 * "cancelled". Skips if the booking is already cancelled (idempotent).
 *
 * Guards with FOR UPDATE so a concurrent refund event cannot double-cancel.
 */
export async function cancelConfirmedBooking(bookingId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");

    if (!fresh || fresh.status !== "confirmed") return;

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
      .where(eq(bookings.id, bookingId));
  });
}
