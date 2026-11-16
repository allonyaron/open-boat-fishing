import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
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

/**
 * Correlated count of the tickets matching `filter` on the outer query's
 * `trips` row, for select lists. The join and the correlation spell out their
 * tables: Drizzle drops the table name from a bare column in a single-table
 * select, and "id" alone is ambiguous inside the subquery.
 */
export function countTicketsOnTrip(filter: SQL) {
  return sql<number>`(
    select cast(count(*) as int) from ${tickets}
    join ${bookingItems} on "booking_items"."id" = "tickets"."booking_item_id"
    where "booking_items"."trip_id" = "trips"."id" and ${filter}
  )`;
}

/** Correlated count of the outer trip's live tickets ("sold"). */
export function liveTicketCount() {
  return countTicketsOnTrip(isLive);
}

/** Correlated count of the seats the outer trip's tickets take, for capacity floors. */
export function seatHoldingTicketCount() {
  return countTicketsOnTrip(holdsSeat);
}
