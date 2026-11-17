import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { requireAdmin } from "@/lib/session";
import { sendPushToEmails } from "@/lib/push";
import { trips, bookingItems, bookings, tickets, vessels, products } from "@openboat/db";
import { and, eq, inArray } from "drizzle-orm";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { isLive } from "@/lib/tickets/queries";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { transitionTrips } from "@/lib/trips/status";
import { transitionBookings } from "@/lib/bookings/status";

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

  // Load the affected bookings and every live ticket they hold, on this trip
  // and on others. Refunds pay back what the live tickets on this trip paid
  // (their share of the charge, net of any discount); a ticket already
  // refunded on its own is not refunded again (P4-2, P2-2).
  const [affectedBookings, liveTickets] = await Promise.all([
    db.select().from(bookings).where(inArray(bookings.id, bookingIds)),
    db
      .select({
        id: tickets.id,
        bookingId: tickets.bookingId,
        priceCents: tickets.priceCents,
        tripId: bookingItems.tripId,
      })
      .from(tickets)
      .innerJoin(bookingItems, eq(bookingItems.id, tickets.bookingItemId))
      .where(and(inArray(tickets.bookingId, bookingIds), eq(tickets.operatorId, session.operatorId), isLive)),
  ]);

  // Per booking: refund the live tickets on this trip; cancel the booking if
  // it has no live tickets left anywhere else.
  type RefundPlan = {
    booking: (typeof affectedBookings)[0];
    refundCents: number;
    fullRefund: boolean;
  };

  const refundPlans: RefundPlan[] = [];
  for (const booking of affectedBookings) {
    if (booking.status !== "confirmed" || !booking.stripePaymentIntentId) continue;

    const live = liveTickets.filter((t) => t.bookingId === booking.id);
    const onThisTrip = live.filter((t) => t.tripId === tripId);
    if (onThisTrip.length === 0) continue;
    const fullRefund = onThisTrip.length === live.length;
    const refundCents = onThisTrip.reduce((s, t) => s + t.priceCents, 0);

    refundPlans.push({ booking, refundCents, fullRefund });
  }

  // Issue all Stripe refunds before touching the DB
  const refundErrors: { bookingId: string; error: string }[] = [];
  for (const plan of refundPlans) {
    try {
      const refundParams: Parameters<typeof stripe.refunds.create>[0] = {
        payment_intent: plan.booking.stripePaymentIntentId!,
        refund_application_fee: true,
        reverse_transfer: true,
        metadata: { reason: reason ?? "trip_cancelled", tripId, bookingId: plan.booking.id },
      };
      // Always the amount the live tickets paid: with an earlier per-ticket
      // refund on the same charge, "refund everything" would be too much.
      refundParams.amount = plan.refundCents;
      await stripe.refunds.create(refundParams, {
        idempotencyKey: `refund:${plan.booking.id}:${tripId}`,
      });
    } catch (err) {
      console.error(`Stripe refund failed for booking ${plan.booking.id}:`, err);
      refundErrors.push({ bookingId: plan.booking.id, error: String(err) });
    }
  }

  if (refundErrors.length > 0) {
    return NextResponse.json(
      {
        error: "Some refunds failed — cancellation aborted. Check Stripe dashboard.",
        failed: refundErrors,
      },
      { status: 502 },
    );
  }

  // All refunds OK — commit state changes atomically
  const now = new Date();
  const ticketItemIds = tripItems.map((i) => i.id);

  const { ticketsOut, cancelled } = await db.transaction(async (tx) => {
    // Lock the trip and read its status now, not the one read before the
    // refunds: settlement may have moved it to pending_settlement meanwhile.
    // A concurrent cancel that already committed is the only reason to stop,
    // and stopping here, before any write, leaves nothing half-done.
    const [current] = await tx
      .select({ status: trips.status })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)))
      .for("update");
    if (!current || current.status === "cancelled") return { ticketsOut: 0, cancelled: false };

    // Take this trip's tickets out of service and reverse their fees: paid
    // ones were refunded above, unpaid holds never charged anything. Their
    // seats come back before the trip is cancelled (the inventory module
    // gives nothing back on a cancelled trip), so the ledger reconciles.
    const scope = { operatorId: session.operatorId, bookingItemIds: ticketItemIds };
    const moved = [
      ...(await moveTickets(tx, scope, "live", "refunded")),
      ...(await moveTickets(tx, scope, "held", "voided")),
    ];
    await giveBackSeatsForTickets(tx, session.operatorId, moved, "trip_cancel");

    // Mark trip cancelled, from the status it has under the lock.
    await transitionTrips(
      tx,
      { operatorId: session.operatorId, tripId },
      current.status,
      "cancelled",
      cancelExtra,
      now,
    );

    // Cancel bookings with no live tickets left anywhere else
    const fullyRefundedBookingIds = refundPlans.filter((p) => p.fullRefund).map((p) => p.booking.id);
    await transitionBookings(
      tx,
      { operatorId: session.operatorId, bookingIds: fullyRefundedBookingIds },
      "confirmed",
      "cancelled",
      now,
    );
    return { ticketsOut: moved.length, cancelled: true };
  });

  if (!cancelled) {
    return NextResponse.json({ error: "Trip is already cancelled" }, { status: 409 });
  }
  const count = ticketsOut;

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
    bookingsCancelled: refundPlans.filter((p) => p.fullRefund).length,
    ticketsVoided: Number(count),
    refundedAt: now.toISOString(),
  });
}
