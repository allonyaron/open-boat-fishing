import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { requireAdmin } from "@/lib/session";
import { tickets, bookingItems, bookings, payments } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { isTicketLive } from "@/lib/tickets/status";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";

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

  // Issue the partial Stripe refund for what this ticket paid (its share of
  // the charge, net of any group discount), not its list price (P2-2).
  // If we have the applicationFeeId, reverse the exact fee separately so it's precise.
  // Otherwise fall back to refund_application_fee: true (proportional).
  const hasExactFee = !!payment.applicationFeeId;

  try {
    await stripe.refunds.create(
      {
        payment_intent: booking.stripePaymentIntentId,
        amount: ticket.priceCents,
        reverse_transfer: true,
        refund_application_fee: !hasExactFee,
        metadata: { reason: "admin_ticket_refund", ticketId, bookingId: booking.id },
      },
      { idempotencyKey: `ticket-refund:${ticketId}` },
    );

    if (hasExactFee) {
      await stripe.applicationFees.createRefund(
        payment.applicationFeeId!,
        { amount: ticket.feeAmountCents },
        { idempotencyKey: `ticket-fee-refund:${ticketId}` },
      );
    }
  } catch (err) {
    console.error("Stripe refund failed for ticket", ticketId, err);
    return NextResponse.json(
      { error: "Stripe refund failed", detail: String(err) },
      { status: 502 },
    );
  }

  // Mark the ticket refunded and give its seat back. The move is conditional,
  // so a second submit that got this far restores nothing.
  await db.transaction(async (tx) => {
    const moved = await moveTickets(
      tx,
      { operatorId: session.operatorId, ticketIds: [ticketId] },
      "live",
      "refunded",
    );
    await giveBackSeatsForTickets(tx, session.operatorId, moved, "refund");
  });

  return NextResponse.json({ ok: true, ticketId, refundedCents: ticket.priceCents });
}
