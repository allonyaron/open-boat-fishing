import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { sendPushToEmails } from "@/lib/push";
import { getPostHogServer } from "@/lib/posthog";
import { sendConfirmationEmail } from "@/lib/notifications/send-confirmation-email";
import { bookings, tickets, payments } from "@openboat/db";
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";

export async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
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

    // Safety net: if the expire-pending-bookings cron somehow cancelled this
    // booking before the webhook arrived (PI status check gap), do not confirm
    // it — seats have already been restored and re-confirming would overbook.
    // Auto-refund the PI so the customer isn't charged for a cancelled booking.
    if (fresh.status === "cancelled") {
      console.error(
        `payment_intent.succeeded: booking ${bookingId} is already cancelled — PI ${pi.id} succeeded but cron cancelled first. Issuing auto-refund.`,
      );
      return "CANCELLED" as const;
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

  if (booking === "CANCELLED") {
    try {
      await stripe.refunds.create({
        payment_intent: pi.id,
        reverse_transfer: true,
        refund_application_fee: true,
      });
      console.log(`Auto-refunded PI ${pi.id} — booking ${bookingId} was already cancelled when payment arrived`);
    } catch (err) {
      console.error(`Failed to auto-refund PI ${pi.id} for cancelled booking ${bookingId}:`, err);
    }
    return;
  }

  // waitUntil keeps the serverless function alive until background tasks
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
