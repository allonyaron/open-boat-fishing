import { and, eq, inArray, type SQL } from "drizzle-orm";
import { bookings } from "@openboat/db";
import type { db } from "@/lib/db";

// The only code that changes bookings.status (AR-16). Every move is a
// conditional UPDATE from one status to another, so a duplicate webhook, a
// second click or two cancellers racing move a booking once, and callers act
// only on the ids returned.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BookingStatus = "pending" | "confirmed" | "cancelled";

/**
 * pending -> confirmed: payment_intent.succeeded, bound to the booking's PI.
 * pending -> cancelled: the hold expired or was released, or its trip was cancelled.
 * confirmed -> cancelled: fully refunded (office, trip cancel, Dashboard refund).
 */
const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["cancelled"],
  cancelled: [],
};

export type BookingScope = { operatorId: string } & ({ bookingId: string } | { bookingIds: string[] });

function scopeFilter(scope: BookingScope): SQL {
  return "bookingId" in scope ? eq(bookings.id, scope.bookingId) : inArray(bookings.id, scope.bookingIds);
}

/**
 * Moves the scoped bookings that are in `from` to `to` and returns the ids it
 * moved. Run it in the caller's transaction, under whatever lock the caller
 * already holds on the booking row.
 */
export async function transitionBookings(
  tx: Tx,
  scope: BookingScope,
  from: BookingStatus,
  to: BookingStatus,
  now: Date = new Date(),
): Promise<string[]> {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Booking status can't move from ${from} to ${to}`);
  }
  if ("bookingIds" in scope && scope.bookingIds.length === 0) return [];

  const rows = await tx
    .update(bookings)
    .set({ status: to, statusChangedAt: now, updatedAt: now })
    .where(and(eq(bookings.operatorId, scope.operatorId), scopeFilter(scope), eq(bookings.status, from)))
    .returning({ id: bookings.id });
  return rows.map((r) => r.id);
}
