import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { bookings, bookingItems, tickets, payments, trips } from "@openboat/db";
import { and, eq, gte, sql } from "drizzle-orm";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

// Stripe requires the raw body for signature verification — do NOT use req.json()
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
  }

  return NextResponse.json({ ok: true });
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata.bookingId;
  if (!bookingId) {
    console.error("payment_intent.succeeded: no bookingId in metadata", pi.id);
    return;
  }

  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) {
    console.error("payment_intent.succeeded: booking not found", bookingId);
    return;
  }

  // Idempotency: Stripe may retry webhooks — skip if already confirmed
  if (booking.status === "confirmed") {
    return;
  }

  // Confirm the booking
  await db
    .update(bookings)
    .set({ status: "confirmed" })
    .where(eq(bookings.id, bookingId));

  // Decrement seatsRemaining for each trip, by the number of tickets issued
  const itemRows = await db
    .select({ id: bookingItems.id, tripId: bookingItems.tripId })
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId));

  for (const item of itemRows) {
    const [{ ticketCount }] = await db
      .select({ ticketCount: sql<number>`cast(count(*) as int)` })
      .from(tickets)
      .where(eq(tickets.bookingItemId, item.id));

    if (ticketCount > 0) {
      const updated = await db
        .update(trips)
        .set({ seatsRemaining: sql`${trips.seatsRemaining} - ${ticketCount}` })
        .where(and(eq(trips.id, item.tripId), gte(trips.seatsRemaining, ticketCount)))
        .returning({ id: trips.id });

      if (updated.length === 0) {
        console.error(
          `Seat decrement failed for trip ${item.tripId} (booking ${booking.confirmationCode}) — seats exhausted`
        );
      }
    }
  }

  // Record the payment
  await db.insert(payments).values({
    bookingId,
    operatorId: booking.operatorId,
    stripePaymentIntentId: pi.id,
    stripeChargeId: typeof pi.latest_charge === "string" ? pi.latest_charge : null,
    amountCents: pi.amount,
    applicationFeeCents: booking.platformFeeCents,
    status: pi.status,
    metadata: pi.metadata,
  });

  // TODO: Send confirmation email via Resend
  // TODO: Send SMS via Twilio
  console.log(`Booking confirmed: ${booking.confirmationCode} (${bookingId})`);
}
