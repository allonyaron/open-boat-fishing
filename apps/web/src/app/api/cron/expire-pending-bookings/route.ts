import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { paymentAccount, stripe } from "@/lib/stripe";
import { cancelPendingBooking } from "@/lib/bookings/cancel";
import { notifyHoldsExpired } from "@/lib/bookings/reclaim-expired-holds";
import { verifyCronAuth } from "@/lib/cron-auth";
import { bookings, operators, payments, rateLimits } from "@openboat/db";
import { recountUpcomingTrips } from "@/lib/inventory/seats";
import { drainEvents } from "@/lib/stripe-events/inbox";
import { dispatchStripeEvent } from "@/lib/stripe-events/dispatch";
import { sendPendingCommands } from "@/lib/payments/commands";
import { finishCancelledTrips } from "@/lib/bookings/cancel-trip";
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
      stripeAccountId: bookings.stripeAccountId,
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

  let cancelled = 0;
  const errors: string[] = [];

  for (const booking of staleBookings) {
    try {
      // Cancel the Stripe Payment Intent if one was created, to prevent a late
      // payment from going through after we've already restored the seats.
      // Kept outside the transaction — external API calls should not hold a DB connection open.
      if (booking.stripePaymentIntentId) {
        try {
          // On the operator's account (row 32).
          const account = paymentAccount(booking.stripeAccountId);
          const pi = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId, {}, account);
          if (pi.status === "succeeded" || pi.status === "processing") {
            // Payment went through — the payment_intent.succeeded webhook will confirm
            // this booking. Do not restore seats here or we create an overbook window.
            console.log(
              `Skipping booking ${booking.id} — PI ${booking.stripePaymentIntentId} is ${pi.status}`,
            );
            continue;
          }
          if (pi.status !== "canceled") {
            // "abandoned": if the canceled webhook wins the race, it sends
            // the same "Booking Expired" push this cron would.
            await stripe.paymentIntents.cancel(
              booking.stripePaymentIntentId,
              { cancellation_reason: "abandoned" },
              account,
            );
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
      notifyHoldsExpired([result]);
    } catch (err) {
      console.error(`Failed to expire booking ${booking.id}:`, err);
      errors.push(booking.id);
    }
  }

  // Recount the next two weeks of trips against their tickets and report any
  // drift (AR-7). seats_remaining is corrected either way; the log line is
  // the signal that some writer bypassed the inventory module.
  const operatorRows = await db.select({ id: operators.id }).from(operators);
  const recountFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recountTo = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  let drifted = 0;
  for (const op of operatorRows) {
    const fixed = await db.transaction((tx) =>
      recountUpcomingTrips(tx, { operatorId: op.id, from: recountFrom, to: recountTo }),
    );
    for (const r of fixed) {
      console.error(
        `Seat drift on trip ${r.tripId} (operator ${op.id}): seats_remaining was ${r.before}, recounted to ${r.after}`,
      );
    }
    drifted += fixed.length;
  }

  // Retry Stripe events still unfinished (row 10): the backstop for Stripe's
  // own redeliveries, which a 500 from the webhook triggers.
  const stripeEventsDrained = await drainEvents(dispatchStripeEvent, { now });
  // Finish trip cancellations whose request died before every booking was
  // settled (row 9); their refunds go out with the queued ones below.
  const cancelledTripsFinished = await finishCancelledTrips(now);
  // Send refunds still queued (Stripe was down, or the request timed out).
  const stripeCommandsSent = await sendPendingCommands({ now });

  // Purge rate-limit rows older than 1 day to keep the table bounded.
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, sql`NOW() - INTERVAL '1 day'`));

  return NextResponse.json({
    ok: errors.length === 0,
    cancelled,
    seatsRecounted: drifted,
    stripeEvents: stripeEventsDrained,
    stripeCommands: stripeCommandsSent,
    cancelledTripsFinished,
    ...(errors.length > 0 && { errors }),
  });
}
