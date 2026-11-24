import { and, eq, inArray, type SQL } from "drizzle-orm";
import { tickets } from "@openboat/db";
import type { db } from "@/lib/db";
import { isOffStatus, type TicketStatus } from "./status";

// The only code that changes tickets.status. Every move is a conditional
// UPDATE from one status to another, so a duplicate webhook or a second click
// moves nothing, and callers act only on the rows returned.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * held -> live: payment_intent.succeeded.
 * held -> voided: never paid (hold expired or released, or the trip was cancelled first).
 * live -> refunded: money returned (office refund, trip cancel, Dashboard refund).
 * live -> disputed: chargeback opened. The seat stays taken and the fee stays
 *   held: Stripe doesn't return the platform fee on a dispute.
 * disputed -> live: the chargeback was won (or was only an inquiry).
 * disputed -> refunded: the chargeback was lost, or the booking was fully
 *   refunded while disputed.
 */
const ALLOWED: Record<TicketStatus, readonly TicketStatus[]> = {
  held: ["live", "voided"],
  live: ["refunded", "disputed"],
  refunded: [],
  voided: [],
  disputed: ["live", "refunded"],
};

/** Moves after which the ticket's platform fee has been (or never was) paid back. */
function reversesFee(to: TicketStatus): boolean {
  return to === "refunded" || to === "voided";
}

/** Which tickets to move. Always operator-scoped. */
export type TicketScope = { operatorId: string } & (
  | { bookingId: string }
  | { bookingItemIds: string[] }
  | { ticketIds: string[] }
);

export type MovedTicket = { id: string; bookingId: string; bookingItemId: string };

function scopeFilter(scope: TicketScope): SQL {
  if ("bookingId" in scope) return eq(tickets.bookingId, scope.bookingId);
  if ("bookingItemIds" in scope) return inArray(tickets.bookingItemId, scope.bookingItemIds);
  return inArray(tickets.id, scope.ticketIds);
}

/**
 * Moves the scoped tickets that are in `from` to `to`, and returns the ones it
 * moved. `voided`, and `fee_status = 'reversed'` for a ticket refunded or
 * voided, are written in the same UPDATE. A disputed ticket's fee stays as it
 * was; one coming back from disputed to live has its fee held again (it may
 * have been marked reversed by code deployed before row 11), and the caller
 * earns it if its trip has already sailed. Run it in the caller's transaction, so seats
 * and booking status change with it.
 *
 * Only tickets whose `voided` matches `from` move: a held or live ticket that
 * code deployed before `status` existed has voided is never re-activated or
 * moved twice.
 */
export async function moveTickets(
  tx: Tx,
  scope: TicketScope,
  from: TicketStatus,
  to: TicketStatus,
): Promise<MovedTicket[]> {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Ticket status can't move from ${from} to ${to}`);
  }
  if (("bookingItemIds" in scope && scope.bookingItemIds.length === 0) ||
      ("ticketIds" in scope && scope.ticketIds.length === 0)) {
    return [];
  }

  const feeStatus = reversesFee(to) ? ("reversed" as const) : from === "disputed" ? ("held" as const) : undefined;
  return tx
    .update(tickets)
    .set({ status: to, voided: isOffStatus(to), ...(feeStatus && { feeStatus }) })
    .where(
      and(
        eq(tickets.operatorId, scope.operatorId),
        scopeFilter(scope),
        eq(tickets.status, from),
        eq(tickets.voided, isOffStatus(from)),
      ),
    )
    .returning({ id: tickets.id, bookingId: tickets.bookingId, bookingItemId: tickets.bookingItemId });
}
