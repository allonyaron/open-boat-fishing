import { and, eq } from "drizzle-orm";
import { bookingItems, bookings, payments, tickets } from "@openboat/db";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { queueFeeRefund, queueRefund } from "@/lib/payments/commands";
import type { RequestContext } from "@/lib/request-context";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { isTicketLive } from "@/lib/tickets/status";

export type RefundTicketResult =
  | { kind: "not_found" }
  | { kind: "unpaid" }
  | { kind: "already_refunded" }
  | { kind: "not_refundable" }
  | { kind: "refunded"; refundedCents: number; commandIds: string[] };

/**
 * The office's per-ticket refund: the ticket is refunded, its seat comes
 * back and the refund is queued in one transaction, with who did it (row 12).
 * Refunds what the ticket paid (its share of the charge, net of any group
 * discount; P2-2), not its list price. With the platform fee's id its exact
 * amount is refunded separately; without it Stripe refunds it in proportion.
 * The caller sends the queued commands after this returns.
 */
export async function refundTicket(
  ctx: RequestContext,
  input: { operatorId: string; ticketId: string },
): Promise<RefundTicketResult> {
  const { operatorId, ticketId } = input;
  const [row] = await db
    .select({ ticket: tickets, booking: bookings, payment: payments })
    .from(tickets)
    .innerJoin(bookingItems, eq(tickets.bookingItemId, bookingItems.id))
    .innerJoin(bookings, eq(tickets.bookingId, bookings.id))
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(eq(tickets.id, ticketId), eq(tickets.operatorId, operatorId)));
  if (!row) return { kind: "not_found" };

  const { ticket, booking, payment } = row;
  if (!isTicketLive(ticket)) return { kind: ticket.status === "held" ? "unpaid" : "already_refunded" };
  if (booking.status !== "confirmed" || !booking.stripePaymentIntentId) return { kind: "not_refundable" };

  const hasExactFee = !!payment.applicationFeeId;
  const paymentIntentId = booking.stripePaymentIntentId;

  // The refund is recorded before Stripe is asked, so it can't be lost or
  // sent twice (row 10). The move is conditional, so a second submit queues
  // nothing.
  const commandIds = await db.transaction(async (tx) => {
    const moved = await moveTickets(tx, { operatorId, ticketIds: [ticketId] }, "live", "refunded");
    if (moved.length === 0) return null;
    await giveBackSeatsForTickets(tx, operatorId, moved, "refund");

    const ids = [
      await queueRefund(tx, {
        ctx,
        operatorId,
        bookingId: booking.id,
        paymentIntentId,
        amountCents: ticket.priceCents,
        reason: "admin_ticket_refund",
        reverseTransfer: true,
        refundApplicationFee: !hasExactFee,
        metadata: { ticketId },
      }),
    ];
    if (hasExactFee) {
      ids.push(
        await queueFeeRefund(tx, {
          ctx,
          operatorId,
          bookingId: booking.id,
          applicationFeeId: payment.applicationFeeId!,
          amountCents: ticket.feeAmountCents,
          reason: "admin_ticket_refund",
          metadata: { ticketId },
        }),
      );
    }
    await recordAudit(tx, ctx, {
      operatorId,
      action: "ticket.refund",
      targetTable: "tickets",
      targetId: ticketId,
      before: { status: "live" },
      after: { status: "refunded", refundCents: ticket.priceCents, bookingId: booking.id, commandIds: ids },
    });
    return ids;
  });
  if (!commandIds) return { kind: "already_refunded" };
  return { kind: "refunded", refundedCents: ticket.priceCents, commandIds };
}
