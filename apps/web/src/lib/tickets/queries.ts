import { and, eq, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { bookingItems, tickets } from "@openboat/db";

// Status filters and counts for every reader of tickets, so "paid for" and
// "takes a seat" mean the same thing on every screen and route.

/**
 * Paid for and valid: boards, counts as sold, earns the fee. The `voided`
 * check covers refunds made by code deployed before `status` existed (see
 * isTicketLive in ./status).
 */
export const isLive: SQL = and(eq(tickets.status, "live"), eq(tickets.voided, false))!;

/**
 * Takes a seat out of trip inventory. Capacity floors count these.
 * - live, or held by an unpaid booking. A held ticket keeps its seat after the
 *   hold expires, until the hold is cancelled (cron, reclaim or release),
 *   because only that gives the seat back to `trips.seats_remaining`.
 * - disputed: a chargeback doesn't give the seat back.
 */
export const holdsSeat: SQL = or(
  and(inArray(tickets.status, ["held", "live"]), eq(tickets.voided, false)),
  eq(tickets.status, "disputed"),
)!;

/** Correlated count of a trip's tickets matching `filter`, for select lists. */
export function countTicketsOnTrip(tripId: SQL | AnyColumn, filter: SQL) {
  return sql<number>`(
    select cast(count(*) as int) from ${tickets}
    join ${bookingItems} on ${bookingItems.id} = ${tickets.bookingItemId}
    where ${bookingItems.tripId} = ${tripId} and ${filter}
  )`;
}

/** Correlated count of a trip's live tickets ("sold"), for select lists. */
export function liveTicketCount(tripId: SQL | AnyColumn) {
  return countTicketsOnTrip(tripId, isLive);
}

/** Correlated count of the seats a trip's tickets take, for capacity floors. */
export function seatHoldingTicketCount(tripId: SQL | AnyColumn) {
  return countTicketsOnTrip(tripId, holdsSeat);
}
