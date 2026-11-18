import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { sendPushToEmails } from "@/lib/push";
import { trips, bookingItems, bookings, tickets, vessels, products } from "@openboat/db";
import { and, eq, inArray } from "drizzle-orm";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { isLive } from "@/lib/tickets/queries";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { transitionTrips } from "@/lib/trips/status";
import { transitionBookings } from "@/lib/bookings/status";
import { queueRefund, sendCommands } from "@/lib/payments/commands";

export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { tripId } = params;
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };

  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)));

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (trip.status === "cancelled") {
    return NextResponse.json({ error: "Trip is already cancelled" }, { status: 409 });
  }
  if (trip.status === "sailed") {
    console.warn(`Cancelling an already-sailed trip: ${tripId} — requires manual review`);
  }

  // Load all booking_items on this trip
  const tripItems = await db.select().from(bookingItems).where(eq(bookingItems.tripId, tripId));

  const cancelExtra = { cancelledAt: new Date(), cancellationReason: reason ?? null };

  if (tripItems.length === 0) {
    // No bookings — just mark the trip cancelled
    const moved = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: trips.status })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)))
        .for("update");
      if (!current || current.status === "cancelled") return [];
      return transitionTrips(tx, { operatorId: session.operatorId, tripId }, current.status, "cancelled", cancelExtra);
    });
    if (moved.length === 0) {
      return NextResponse.json({ error: "Trip is already cancelled" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, tripId, bookingsCancelled: 0, ticketsVoided: 0 });
  }

  const bookingIds = [...new Set(tripItems.map((i) => i.bookingId))];
  const affectedBookings = await db
    .select()
    .from(bookings)
    .where(and(inArray(bookings.id, bookingIds), eq(bookings.operatorId, session.operatorId)));
  const bookingById = new Map(affectedBookings.map((b) => [b.id, b]));

  const now = new Date();
  const ticketItemIds = tripItems.map((i) => i.id);

  // One transaction: the trip, its tickets, their seats, the bookings and the
  // refund requests change together (row 10). Refunds are recorded here and
  // sent after commit, so a Stripe failure no longer aborts the cancellation
  // or leaves some refunds sent and none recorded (P4-3): an unsent refund
  // stays queued and is retried, or shows on the Money page.
  const outcome = await db.transaction(async (tx) => {
    // Lock the trip and read its status now: settlement may have moved it to
    // pending_settlement since it was read above. A concurrent cancel that
    // already committed is the only reason to stop, before any write.
    const [current] = await tx
      .select({ status: trips.status })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)))
      .for("update");
    if (!current || current.status === "cancelled") return null;

    // Take this trip's tickets out of service and reverse their fees: paid
    // ones are refunded below, unpaid holds never charged anything. Their
    // seats come back before the trip is cancelled (the inventory module
    // gives nothing back on a cancelled trip), so the ledger reconciles.
    const scope = { operatorId: session.operatorId, bookingItemIds: ticketItemIds };
    const refunded = await moveTickets(tx, scope, "live", "refunded");
    const voided = await moveTickets(tx, scope, "held", "voided");
    await giveBackSeatsForTickets(tx, session.operatorId, [...refunded, ...voided], "trip_cancel");

    await transitionTrips(
      tx,
      { operatorId: session.operatorId, tripId },
      current.status,
      "cancelled",
      cancelExtra,
      now,
    );

    // Refund what the tickets just taken out of service paid (their share of
    // the charge, net of any discount), per booking. A ticket refunded on its
    // own earlier wasn't live, so it isn't refunded again (P4-2, P2-2).
    const paid = refunded.length
      ? await tx
          .select({ bookingId: tickets.bookingId, priceCents: tickets.priceCents })
          .from(tickets)
          .where(and(inArray(tickets.id, refunded.map((t) => t.id)), eq(tickets.operatorId, session.operatorId)))
      : [];
    const centsByBooking = new Map<string, number>();
    for (const t of paid) centsByBooking.set(t.bookingId, (centsByBooking.get(t.bookingId) ?? 0) + t.priceCents);

    const commandIds: string[] = [];
    for (const [bookingId, cents] of centsByBooking) {
      const booking = bookingById.get(bookingId);
      if (!booking?.stripePaymentIntentId || cents <= 0) continue;
      commandIds.push(
        await queueRefund(tx, {
          operatorId: session.operatorId,
          bookingId,
          paymentIntentId: booking.stripePaymentIntentId,
          amountCents: cents,
          reason: "trip_cancelled",
          reverseTransfer: true,
          refundApplicationFee: true,
          metadata: { tripId, ...(reason && { cancelReason: reason.slice(0, 200) }) },
        }),
      );
    }

    // Cancel the bookings that have no live tickets left on any trip.
    const stillLive = centsByBooking.size
      ? await tx
          .select({ bookingId: tickets.bookingId })
          .from(tickets)
          .where(
            and(
              inArray(tickets.bookingId, [...centsByBooking.keys()]),
              eq(tickets.operatorId, session.operatorId),
              isLive,
            ),
          )
      : [];
    const keepOpen = new Set(stillLive.map((t) => t.bookingId));
    const bookingsCancelled = await transitionBookings(
      tx,
      {
        operatorId: session.operatorId,
        bookingIds: [...centsByBooking.keys()].filter((id) => !keepOpen.has(id)),
      },
      "confirmed",
      "cancelled",
      now,
    );

    return { ticketsOut: refunded.length + voided.length, bookingsCancelled: bookingsCancelled.length, commandIds };
  });

  if (!outcome) {
    return NextResponse.json({ error: "Trip is already cancelled" }, { status: 409 });
  }
  const count = outcome.ticketsOut;

  // Send the refunds now; what doesn't go through stays queued.
  const refunds = await sendCommands(outcome.commandIds);

  // Fire cancellation push notifications (best-effort, non-blocking)
  const passengerEmails = affectedBookings.map((b) => b.customerEmail).filter(Boolean) as string[];
  if (passengerEmails.length > 0) {
    const [tripDetail] = await db
      .select({ vesselName: vessels.name, productName: products.displayName })
      .from(trips)
      .innerJoin(vessels, eq(trips.vesselId, vessels.id))
      .innerJoin(products, eq(trips.productId, products.id))
      .where(eq(trips.id, tripId));

    sendPushToEmails(
      session.operatorId,
      passengerEmails,
      {
        title: "Trip Cancelled",
        body: tripDetail
          ? `Your ${tripDetail.vesselName} ${tripDetail.productName} has been cancelled. A full refund is on the way.`
          : "Your trip has been cancelled. A full refund is on the way.",
        data: { type: "trip_cancelled", tripId },
      },
      "cancellations",
    ).catch((err) => console.error("Push error on cancellation:", err));
  }

  return NextResponse.json({
    ok: true,
    tripId,
    bookingsCancelled: outcome.bookingsCancelled,
    ticketsVoided: Number(count),
    refundedAt: now.toISOString(),
    refunds: { sent: refunds.sent + refunds.confirmed, queued: refunds.pending, failed: refunds.failed },
  });
}
