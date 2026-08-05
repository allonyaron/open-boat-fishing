import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { sendBookingConfirmation } from "@/lib/email";
import { sendPushToEmails } from "@/lib/push";
import { bookings, bookingItems, tickets, payments, trips, operators, vessels, products } from "@openboat/db";
import { eq, inArray, sql } from "drizzle-orm";
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
  } else if (event.type === "payment_intent.canceled") {
    await handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
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

  // Confirm the booking (seats were already decremented at booking creation)
  await db
    .update(bookings)
    .set({ status: "confirmed" })
    .where(eq(bookings.id, bookingId));

  // Fetch the charge to capture applicationFeeId and stripeTransferId for exact fee reversal
  const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : null;
  let applicationFeeId: string | null = null;
  let stripeTransferId: string | null = null;
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      applicationFeeId = typeof charge.application_fee === "string" ? charge.application_fee : null;
      stripeTransferId = typeof charge.transfer === "string" ? charge.transfer : null;
    } catch (err) {
      console.error("Failed to retrieve charge for fee IDs:", err);
    }
  }

  // Record the payment
  await db.insert(payments).values({
    bookingId,
    operatorId: booking.operatorId,
    stripePaymentIntentId: pi.id,
    stripeChargeId: chargeId,
    applicationFeeId,
    stripeTransferId,
    amountCents: pi.amount,
    applicationFeeCents: booking.platformFeeCents,
    status: pi.status,
    metadata: pi.metadata,
  });

  // Send confirmation email
  try {
    const [operator] = await db.select().from(operators).where(eq(operators.id, booking.operatorId));
    if (operator) {
      const itemRows = await db.select().from(bookingItems).where(eq(bookingItems.bookingId, bookingId));
      const tripIds = itemRows.map((i) => i.tripId);
      const [ticketRows, tripRows] = await Promise.all([
        db.select().from(tickets).where(eq(tickets.bookingId, bookingId)),
        tripIds.length > 0 ? db.select().from(trips).where(inArray(trips.id, tripIds)) : Promise.resolve([] as (typeof trips.$inferSelect)[]),
      ]);
      const vesselIds = [...new Set(tripRows.map((t) => t.vesselId))];
      const productIds = [...new Set(tripRows.map((t) => t.productId))];
      const [vesselRows, productRows] = await Promise.all([
        vesselIds.length > 0 ? db.select().from(vessels).where(inArray(vessels.id, vesselIds)) : Promise.resolve([] as (typeof vessels.$inferSelect)[]),
        productIds.length > 0 ? db.select().from(products).where(inArray(products.id, productIds)) : Promise.resolve([] as (typeof products.$inferSelect)[]),
      ]);

      // Aggregate ticket lines per (trip, ticketType) for display
      const lineMap = new Map<string, { count: number; priceCents: number; tripId: string; ticketType: string }>();
      for (const t of ticketRows) {
        const item = itemRows.find((i) => i.id === t.bookingItemId)!;
        const key = `${item.tripId}:${t.ticketType}`;
        const existing = lineMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          lineMap.set(key, { count: 1, priceCents: t.priceCents, tripId: item.tripId, ticketType: t.ticketType });
        }
      }

      function fmtTime(iso: string | Date) {
        const d = new Date(iso);
        const h = d.getHours(), m = d.getMinutes(), ampm = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 || 12;
        return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
      }

      const ticketLines = [...lineMap.values()].map((l) => {
        const trip = tripRows.find((t) => t.id === l.tripId)!;
        const vessel = vesselRows.find((v) => v.id === trip.vesselId)!;
        const product = productRows.find((p) => p.id === trip.productId)!;
        return {
          ticketType: l.ticketType,
          count: l.count,
          priceCents: l.priceCents,
          tripDate: new Date(trip.departureDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
          vesselName: vessel.name,
          productName: product.displayName,
          departs: fmtTime(trip.startTime),
          returns: fmtTime(trip.endTime),
        };
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      await sendBookingConfirmation({
        to: booking.customerEmail,
        customerName: booking.customerName,
        confirmationCode: booking.confirmationCode,
        bookingId,
        totalCents: booking.totalCents,
        ticketLines,
        fromAddress: operator.emailFrom,
        appUrl,
      });
    }
  } catch (emailErr) {
    // Email failure must not fail the webhook — booking is already confirmed
    console.error("Failed to send confirmation email:", emailErr);
  }

  // Send booking confirmation push (best-effort)
  if (booking.customerEmail) {
    sendPushToEmails(
      booking.operatorId,
      [booking.customerEmail],
      {
        title: "Booking Confirmed!",
        body: `Your trip is booked. Confirmation: ${booking.confirmationCode}`,
        data: { type: "booking_confirmed", bookingId },
      },
      "confirmations"
    ).catch((err) => console.error("Push error on confirmation:", err));
  }

  // TODO: Send SMS via Twilio
  console.log(`Booking confirmed: ${booking.confirmationCode} (${bookingId})`);
}

// Restore seats when a PaymentIntent is explicitly cancelled (customer abandoned
// checkout and Stripe cancelled the PI, or we cancelled it programmatically).
// Does not fire on payment_intent.payment_failed — the customer can retry there.
async function handlePaymentIntentCanceled(pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata.bookingId;
  if (!bookingId) return;

  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking || booking.status === "confirmed") return;

  const itemRows = await db
    .select({ id: bookingItems.id, tripId: bookingItems.tripId })
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId));

  await db.transaction(async (tx) => {
    for (const item of itemRows) {
      const [{ ticketCount }] = await tx
        .select({ ticketCount: sql<number>`cast(count(*) as int)` })
        .from(tickets)
        .where(eq(tickets.bookingItemId, item.id));

      if (ticketCount > 0) {
        await tx
          .update(trips)
          .set({ seatsRemaining: sql`${trips.seatsRemaining} + ${ticketCount}` })
          .where(eq(trips.id, item.tripId));
      }
    }
    await tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
  });

  console.log(`Booking cancelled, seats restored: ${booking.confirmationCode} (${bookingId})`);
}
