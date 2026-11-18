import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { tickets, bookingItems, bookings, payments } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { isTicketLive } from "@/lib/tickets/status";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { queueFeeRefund, queueRefund, sendCommands } from "@/lib/payments/commands";

export async function POST(req: NextRequest, { params }: { params: { ticketId: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { ticketId } = params;

  // Load ticket + booking item + booking + payment in one shot
  const [row] = await db
    .select({
      ticket: tickets,
      bookingItem: bookingItems,
      booking: bookings,
      payment: payments,
    })
    .from(tickets)
    .innerJoin(bookingItems, eq(tickets.bookingItemId, bookingItems.id))
    .innerJoin(bookings, eq(tickets.bookingId, bookings.id))
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(eq(tickets.id, ticketId), eq(tickets.operatorId, session.operatorId)));

  if (!row) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const { ticket, booking, payment } = row;

  if (!isTicketLive(ticket)) {
    return NextResponse.json(
      { error: ticket.status === "held" ? "Ticket isn't paid for" : "Ticket already refunded" },
      { status: 409 },
    );
  }
  if (booking.status !== "confirmed" || !booking.stripePaymentIntentId) {
    return NextResponse.json({ error: "Booking is not in a refundable state" }, { status: 409 });
  }

  // Refund what this ticket paid (its share of the charge, net of any group
  // discount), not its list price (P2-2). With the fee's id, its exact amount
  // is refunded separately; without it Stripe refunds it in proportion.
  const hasExactFee = !!payment.applicationFeeId;
  const paymentIntentId = booking.stripePaymentIntentId;

  // The ticket, its seat and the refund requests change together (row 10):
  // the refund is recorded before Stripe is asked, so it can't be lost or
  // sent twice. The move is conditional, so a second submit queues nothing.
  const commandIds = await db.transaction(async (tx) => {
    const moved = await moveTickets(
      tx,
      { operatorId: session.operatorId, ticketIds: [ticketId] },
      "live",
      "refunded",
    );
    if (moved.length === 0) return null;
    await giveBackSeatsForTickets(tx, session.operatorId, moved, "refund");

    const ids = [
      await queueRefund(tx, {
        operatorId: session.operatorId,
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
          operatorId: session.operatorId,
          bookingId: booking.id,
          applicationFeeId: payment.applicationFeeId!,
          amountCents: ticket.feeAmountCents,
          reason: "admin_ticket_refund",
          metadata: { ticketId },
        }),
      );
    }
    return ids;
  });

  if (!commandIds) {
    return NextResponse.json({ error: "Ticket already refunded" }, { status: 409 });
  }

  // Send now. A failure doesn't undo the refund: the request stays queued and
  // is retried, or shows on the Money page if Stripe refuses it.
  const sent = await sendCommands(commandIds);
  const refund = sent.failed > 0 ? "failed" : sent.pending > 0 ? "queued" : "sent";

  return NextResponse.json({ ok: true, ticketId, refundedCents: ticket.priceCents, refund });
}
