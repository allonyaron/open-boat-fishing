import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { bookings, bookingItems, tickets, payments, trips } from "@openboat/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STALE_MINUTES = 30;

// Vercel cron: runs every 10 minutes via vercel.json.
// Finds pending bookings older than 30 minutes with no completed payment and
// cancels them, restoring held seats. Targets two failure modes:
//   1. No PI ever created (server crash between DB commit and stripe.paymentIntents.create)
//   2. PI created but customer abandoned; webhook hasn't fired yet
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

  // LEFT JOIN payments + isNull filter = "no payment row exists for this booking"
  const staleBookings = await db
    .select({
      id: bookings.id,
      confirmationCode: bookings.confirmationCode,
      stripePaymentIntentId: bookings.stripePaymentIntentId,
    })
    .from(bookings)
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, "pending"),
        lt(bookings.createdAt, cutoff),
        isNull(payments.bookingId)
      )
    );

  if (staleBookings.length === 0) {
    return NextResponse.json({ ok: true, cancelled: 0 });
  }

  let cancelled = 0;
  const errors: string[] = [];

  for (const booking of staleBookings) {
    try {
      // Cancel the Stripe Payment Intent if one was created, to prevent a late
      // payment from going through after we've already restored the seats.
      if (booking.stripePaymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
          if (pi.status !== "canceled" && pi.status !== "succeeded") {
            await stripe.paymentIntents.cancel(booking.stripePaymentIntentId);
          }
        } catch (stripeErr) {
          console.error(
            `Failed to cancel Payment Intent ${booking.stripePaymentIntentId} for booking ${booking.id}:`,
            stripeErr
          );
          // Non-fatal: proceed with seat restoration regardless
        }
      }

      const itemRows = await db
        .select({ id: bookingItems.id, tripId: bookingItems.tripId })
        .from(bookingItems)
        .where(eq(bookingItems.bookingId, booking.id));

      await db.transaction(async (tx) => {
        // Restore seats using the same relative-increment pattern as the
        // Payment Intent failure rollback in POST /api/bookings
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

        await tx
          .update(bookings)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(bookings.id, booking.id));
      });

      console.log(`Expired stale pending booking ${booking.confirmationCode} (${booking.id})`);
      cancelled++;
    } catch (err) {
      console.error(`Failed to expire booking ${booking.id}:`, err);
      errors.push(booking.id);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    cancelled,
    ...(errors.length > 0 && { errors }),
  });
}
