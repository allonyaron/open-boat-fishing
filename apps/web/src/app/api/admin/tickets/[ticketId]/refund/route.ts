import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { requireAdmin } from "@/lib/session";
import { tickets, bookingItems, bookings, payments, trips } from "@openboat/db";
import { and, eq, sql } from "drizzle-orm";

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

  const { ticket, bookingItem, booking, payment } = row;

  if (ticket.voided) {
    return NextResponse.json({ error: "Ticket already refunded" }, { status: 409 });
  }
  if (booking.status !== "confirmed" || !booking.stripePaymentIntentId) {
    return NextResponse.json({ error: "Booking is not in a refundable state" }, { status: 409 });
  }

  // Issue the partial Stripe refund for the ticket price only.
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

  // Mark ticket voided + restore one seat on the trip
  await db.transaction(async (tx) => {
    await tx
      .update(tickets)
      .set({ voided: true, feeStatus: "reversed" })
      .where(eq(tickets.id, ticketId));

    await tx
      .update(trips)
      .set({ seatsRemaining: sql`${trips.seatsRemaining} + 1` })
      .where(eq(trips.id, bookingItem.tripId));
  });

  return NextResponse.json({ ok: true, ticketId, refundedCents: ticket.priceCents });
}
