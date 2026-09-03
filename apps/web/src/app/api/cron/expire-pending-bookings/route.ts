import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { sendPushToEmails } from "@/lib/push";
import { cancelPendingBooking } from "@/lib/bookings/cancel";
import { verifyCronAuth } from "@/lib/cron-auth";
import { bookings, payments, rateLimits } from "@openboat/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_LIMIT = 50;

// Fallback for legacy pending bookings created before holdExpiresAt was added.
// Widened to 90 min because the cron runs hourly on Vercel Hobby plan.
const LEGACY_STALE_MINUTES = 90;

// Vercel cron: runs hourly via vercel.json (Hobby plan limit).
// Cancels pending bookings whose holdExpiresAt has passed (or, for legacy rows
// without holdExpiresAt, that are older than 30 minutes) with no completed payment.
// Targets two failure modes:
//   1. No PI ever created (server crash between DB commit and stripe.paymentIntents.create)
//   2. PI created but customer abandoned; webhook hasn't fired yet
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const legacyCutoff = new Date(Date.now() - LEGACY_STALE_MINUTES * 60 * 1000);
  const now = new Date();

  // LEFT JOIN payments + isNull filter = "no payment row exists for this booking"
  const staleBookings = await db
    .select({
      id: bookings.id,
      confirmationCode: bookings.confirmationCode,
      stripePaymentIntentId: bookings.stripePaymentIntentId,
      customerEmail: bookings.customerEmail,
      operatorId: bookings.operatorId,
    })
    .from(bookings)
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, "pending"),
        isNull(payments.bookingId),
        or(
          // New path: booking has an explicit expiry and it has passed
          and(sql`${bookings.holdExpiresAt} is not null`, lt(bookings.holdExpiresAt, now)),
          // Legacy path: no expiry set, fall back to 30-min window
          and(sql`${bookings.holdExpiresAt} is null`, lt(bookings.createdAt, legacyCutoff)),
        ),
      ),
    )
    .limit(BATCH_LIMIT);

  if (staleBookings.length === 0) {
    return NextResponse.json({ ok: true, cancelled: 0 });
  }

  let cancelled = 0;
  const errors: string[] = [];

  for (const booking of staleBookings) {
    try {
      // Cancel the Stripe Payment Intent if one was created, to prevent a late
      // payment from going through after we've already restored the seats.
      // Kept outside the transaction — external API calls should not hold a DB connection open.
      if (booking.stripePaymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
          if (pi.status === "succeeded" || pi.status === "processing") {
            // Payment went through — the payment_intent.succeeded webhook will confirm
            // this booking. Do not restore seats here or we create an overbook window.
            console.log(
              `Skipping booking ${booking.id} — PI ${booking.stripePaymentIntentId} is ${pi.status}`,
            );
            continue;
          }
          if (pi.status !== "canceled") {
            await stripe.paymentIntents.cancel(booking.stripePaymentIntentId);
          }
        } catch (stripeErr) {
          console.error(
            `Failed to cancel Payment Intent ${booking.stripePaymentIntentId} for booking ${booking.id}:`,
            stripeErr,
          );
          // Non-fatal: proceed with seat restoration regardless
        }
      }

      // cancelPendingBooking re-fetches with FOR UPDATE inside its transaction,
      // closing the race window between the stale-booking SELECT above and now.
      // Returns null if a concurrent process already handled this booking.
      const result = await cancelPendingBooking(booking.id);

      if (!result) {
        console.log(`Skipped booking ${booking.id} — already handled by another process`);
        continue;
      }

      console.log(`Expired stale pending booking ${booking.confirmationCode} (${booking.id})`);
      cancelled++;

      if (booking.customerEmail) {
        waitUntil(
          sendPushToEmails(
            booking.operatorId,
            [booking.customerEmail],
            {
              title: "Booking Expired",
              body: `Your reservation (${booking.confirmationCode}) was released because payment wasn't completed.`,
              data: { type: "booking_expired", bookingId: booking.id },
            },
            "cancellations",
          ).catch((err) => console.error("Push error on booking expiry:", err)),
        );
      }
    } catch (err) {
      console.error(`Failed to expire booking ${booking.id}:`, err);
      errors.push(booking.id);
    }
  }

  // Purge rate-limit rows older than 1 day to keep the table bounded.
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, sql`NOW() - INTERVAL '1 day'`));

  return NextResponse.json({
    ok: errors.length === 0,
    cancelled,
    ...(errors.length > 0 && { errors }),
  });
}
