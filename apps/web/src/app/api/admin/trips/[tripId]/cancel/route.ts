import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { requireAdmin } from "@/lib/session";
import { sendPushToEmails } from "@/lib/push";
import { trips, bookingItems, bookings, tickets, vessels, products } from "@openboat/db";
import { and, eq, inArray, sql } from "drizzle-orm";

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

  if (tripItems.length === 0) {
    // No bookings — just mark the trip cancelled
    await db
      .update(trips)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(trips.id, tripId));
    return NextResponse.json({ ok: true, tripId, bookingsCancelled: 0, ticketsVoided: 0 });
  }

  const bookingIds = [...new Set(tripItems.map((i) => i.bookingId))];

  // Load the affected bookings and all their items (to detect multi-trip bookings)
  const [affectedBookings, allItemsForBookings] = await Promise.all([
    db.select().from(bookings).where(inArray(bookings.id, bookingIds)),
    db.select().from(bookingItems).where(inArray(bookingItems.bookingId, bookingIds)),
  ]);

  // Determine refund amount per booking:
  // - if ALL items are on this trip → full refund (payment_intent refund, no amount param)
  // - if some items are on other trips → partial refund for the subtotal of this trip's items only
  type RefundPlan = {
    booking: (typeof affectedBookings)[0];
    refundCents: number;
    fullRefund: boolean;
    itemsOnThisTrip: typeof tripItems;
  };

  const refundPlans: RefundPlan[] = [];
  for (const booking of affectedBookings) {
    if (booking.status !== "confirmed" || !booking.stripePaymentIntentId) continue;

    const itemsOnThisTrip = tripItems.filter((i) => i.bookingId === booking.id);
    const allItems = allItemsForBookings.filter((i) => i.bookingId === booking.id);
    const fullRefund = allItems.length === itemsOnThisTrip.length;
    const refundCents = itemsOnThisTrip.reduce((s, i) => s + i.subtotalCents, 0);

    refundPlans.push({ booking, refundCents, fullRefund, itemsOnThisTrip });
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
      // Partial refund: specify the amount. Full refund: omit amount (Stripe refunds all)
      if (!plan.fullRefund) {
        refundParams.amount = plan.refundCents;
      }
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

  await db.transaction(async (tx) => {
    // Mark trip cancelled
    await tx
      .update(trips)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: reason ?? null,
        updatedAt: now,
      })
      .where(eq(trips.id, tripId));

    // Void tickets on this trip + reverse their fees
    if (ticketItemIds.length > 0) {
      await tx
        .update(tickets)
        .set({ voided: true, feeStatus: "reversed" })
        .where(inArray(tickets.bookingItemId, ticketItemIds));
    }

    // Cancel bookings where ALL items were on this trip
    const fullyRefundedBookingIds = refundPlans
      .filter((p) => p.fullRefund)
      .map((p) => p.booking.id);

    if (fullyRefundedBookingIds.length > 0) {
      await tx
        .update(bookings)
        .set({ status: "cancelled", updatedAt: now })
        .where(inArray(bookings.id, fullyRefundedBookingIds));
    }

    // Reset seats to capacity (trip is done; no new bookings possible).
    // Use the DB's current capacity value, not the stale read, in case it changed concurrently.
    await tx
      .update(trips)
      .set({ seatsRemaining: sql`${trips.capacity}` })
      .where(eq(trips.id, tripId));
  });

  // Count voided tickets for the response
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tickets)
    .where(and(inArray(tickets.bookingItemId, ticketItemIds), eq(tickets.voided, true)));

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
