// Pure ticket-status helpers, safe to import from client components.
// The database side (predicates and transitions) is in ./queries and ./lifecycle.

export type TicketStatus = "held" | "live" | "refunded" | "voided" | "disputed";

/** Statuses whose ticket no longer holds a seat or boards. */
export const OFF_STATUSES: readonly TicketStatus[] = ["refunded", "voided", "disputed"];

export function isOffStatus(status: TicketStatus): boolean {
  return OFF_STATUSES.includes(status);
}

/**
 * Whether a ticket is paid for and valid: the only kind that boards, counts as
 * sold or earns the fee. Also requires `voided` false until that column is
 * dropped: code deployed before `status` existed refunds by setting `voided`
 * alone, which leaves `status` at live.
 */
export function isTicketLive(t: { status: TicketStatus; voided: boolean }): boolean {
  return t.status === "live" && !t.voided;
}
