import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { fmtTimeET } from "@/lib/format";
import { stripe } from "@/lib/stripe";
import { sendBookingConfirmation } from "@/lib/email";
import { sendPushToEmails } from "@/lib/push";
import { getPostHogServer } from "@/lib/posthog";
import {
  bookings,
  bookingItems,
  tickets,
  payments,
  trips,
  operators,
  vessels,
  products,
} from "@openboat/db";
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
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
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

  // Fetch the charge outside the transaction — external API calls should not
  // hold a DB connection open.
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

  // FOR UPDATE atomically re-checks status so concurrent webhook deliveries
  // can't both pass the guard and send duplicate emails/pushes.
  const booking = await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");

    if (!fresh) {
      console.error("payment_intent.succeeded: booking not found", bookingId);
      return null;
    }

    // Idempotency: skip if already confirmed
    if (fresh.status === "confirmed") {
      return null;
    }

    // Confirm the booking (seats were already decremented at booking creation)
    await tx.update(bookings).set({ status: "confirmed" }).where(eq(bookings.id, bookingId));

    // Record the payment
    await tx.insert(payments).values({
      bookingId,
      operatorId: fresh.operatorId,
      stripePaymentIntentId: pi.id,
      stripeChargeId: chargeId,
      applicationFeeId,
      stripeTransferId,
      amountCents: pi.amount,
      applicationFeeCents: fresh.platformFeeCents,
      status: pi.status,
      metadata: pi.metadata,
    });

    return fresh;
  });

  if (!booking) return;

  // waitUntil keeps the serverless function alive until both background tasks
  // complete, even after the response has been returned to Stripe.
  waitUntil(
    sendConfirmationEmail(booking, bookingId).catch((err) =>
      console.error("Failed to send confirmation email:", err),
    ),
  );

  if (booking.customerEmail) {
    waitUntil(
      sendPushToEmails(
        booking.operatorId,
        [booking.customerEmail],
        {
          title: "Booking Confirmed!",
          body: `Your trip is booked. Confirmation: ${booking.confirmationCode}`,
          data: { type: "booking_confirmed", bookingId },
        },
        "confirmations",
      ).catch((err) => console.error("Push error on confirmation:", err)),
    );
  }

  // TODO: Send SMS via Twilio
  console.log(`Booking confirmed: ${booking.confirmationCode} (${bookingId})`);

  waitUntil(
    (async () => {
      try {
        const ph = getPostHogServer();
        const ticketRows = await db
          .select({ count: sql<number>`count(*)` })
          .from(tickets)
          .where(eq(tickets.bookingId, bookingId));
        const ticketCount = Number(ticketRows[0]?.count ?? 0);
        ph.capture({
          distinctId: booking.customerEmail ?? bookingId,
          event: "payment_success",
          properties: {
            booking_id: bookingId,
            confirmation_code: booking.confirmationCode,
            total_cents: pi.amount,
            ticket_count: ticketCount,
            payment_method_types: pi.payment_method_types,
            operator_id: booking.operatorId,
          },
        });
        await ph.shutdown();
      } catch (err) {
        console.error("PostHog capture error:", err);
      }
    })(),
  );
}

async function sendConfirmationEmail(booking: typeof bookings.$inferSelect, bookingId: string) {
  const [operator] = await db.select().from(operators).where(eq(operators.id, booking.operatorId));
  if (!operator) return;

  const itemRows = await db
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId));
  const tripIds = itemRows.map((i) => i.tripId);
  const [ticketRows, tripRows] = await Promise.all([
    db.select().from(tickets).where(eq(tickets.bookingId, bookingId)),
    tripIds.length > 0
      ? db.select().from(trips).where(inArray(trips.id, tripIds))
      : Promise.resolve([] as (typeof trips.$inferSelect)[]),
  ]);
  const vesselIds = [...new Set(tripRows.map((t) => t.vesselId))];
  const productIds = [...new Set(tripRows.map((t) => t.productId))];
  const [vesselRows, productRows] = await Promise.all([
    vesselIds.length > 0
      ? db.select().from(vessels).where(inArray(vessels.id, vesselIds))
      : Promise.resolve([] as (typeof vessels.$inferSelect)[]),
    productIds.length > 0
      ? db.select().from(products).where(inArray(products.id, productIds))
      : Promise.resolve([] as (typeof products.$inferSelect)[]),
  ]);

  const lineMap = new Map<
    string,
    { count: number; priceCents: number; tripId: string; ticketType: string }
  >();
  for (const t of ticketRows) {
    const item = itemRows.find((i) => i.id === t.bookingItemId)!;
    const key = `${item.tripId}:${t.ticketType}`;
    const existing = lineMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      lineMap.set(key, {
        count: 1,
        priceCents: t.priceCents,
        tripId: item.tripId,
        ticketType: t.ticketType,
      });
    }
  }

  const ticketLines = [...lineMap.values()].map((l) => {
    const trip = tripRows.find((t) => t.id === l.tripId)!;
    const vessel = vesselRows.find((v) => v.id === trip.vesselId)!;
    const product = productRows.find((p) => p.id === trip.productId)!;
    return {
      ticketType: l.ticketType,
      count: l.count,
      priceCents: l.priceCents,
      tripDate: new Date(trip.departureDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      vesselName: vessel.name,
      productName: product.displayName,
      departs: fmtTimeET(trip.startTime),
      returns: fmtTimeET(trip.endTime),
    };
  });

  await sendBookingConfirmation({
    to: booking.customerEmail,
    customerName: booking.customerName,
    confirmationCode: booking.confirmationCode,
    bookingId,
    totalCents: booking.totalCents,
    ticketLines,
    fromAddress: operator.emailFrom,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  });
}

// Restore seats when a PaymentIntent is explicitly cancelled (customer abandoned
// checkout and Stripe cancelled the PI, or we cancelled it programmatically).
// Does not fire on payment_intent.payment_failed — the customer can retry there.
async function handlePaymentIntentCanceled(pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata.bookingId;
  if (!bookingId) return;

  // FOR UPDATE atomically re-checks status so concurrent webhook deliveries
  // and the expire-pending-bookings cron can't both restore seats.
  const result = await db.transaction(async (tx) => {
    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        confirmationCode: bookings.confirmationCode,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");

    if (!booking || booking.status === "confirmed" || booking.status === "cancelled") {
      return null;
    }

    const itemRows = await tx
      .select({ id: bookingItems.id, tripId: bookingItems.tripId })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, bookingId));

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
    return booking;
  });

  if (!result) return;
  console.log(`Booking cancelled, seats restored: ${result.confirmationCode} (${bookingId})`);
}
