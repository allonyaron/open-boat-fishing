import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { sendPushToEmails } from "@/lib/push";
import { getPostHogServer } from "@/lib/posthog";
import { sendConfirmationEmail } from "@/lib/notifications/send-confirmation-email";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { transitionBookings } from "@/lib/bookings/status";
import { queueRefund, sendCommand } from "@/lib/payments/commands";
import { bookings, tickets, payments, operators } from "@openboat/db";
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import type { EventResult } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, destinationOf, orphanPaymentOwner } from "@/lib/stripe-events/ownership";
import { bookingLabel, usd } from "@/lib/stripe-events/notes";

/**
 * Why `pi` cannot stand for `booking`, or null when it can. Exported for tests.
 */
export function paymentIntentMismatch(
  pi: Pick<Stripe.PaymentIntent, "id" | "amount" | "currency" | "transfer_data">,
  booking: { stripePaymentIntentId: string | null; totalCents: number },
  operatorStripeAccountId: string | null,
): string | null {
  if (booking.stripePaymentIntentId !== pi.id) {
    return `booking has PI ${booking.stripePaymentIntentId ?? "none"}`;
  }
  if (pi.amount !== booking.totalCents) {
    return `amount ${pi.amount} != booking total ${booking.totalCents}`;
  }
  if (pi.currency !== "usd") return `currency ${pi.currency}`;
  const destination =
    typeof pi.transfer_data?.destination === "string"
      ? pi.transfer_data.destination
      : pi.transfer_data?.destination?.id ?? null;
  if (!operatorStripeAccountId || destination !== operatorStripeAccountId) {
    return `destination ${destination ?? "none"} != operator account ${operatorStripeAccountId ?? "none"}`;
  }
  return null;
}

export async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<EventResult> {
  // The booking is found by the PI id it stored when the PI was created, never
  // by metadata, which whoever owns the PI can write (P3-2).
  const found = await bookingForPaymentIntent(pi.id);
  if (!found) {
    const owner = await orphanPaymentOwner(destinationOf(pi), pi.metadata);
    if (!owner.ours) return { outcome: "ignored", note: owner.why };
    return {
      outcome: "needs_review",
      operatorId: owner.operatorId,
      note: `A payment of ${usd(pi.amount)} went through but no booking has it (${pi.id}). Refund it in the Stripe Dashboard if it shouldn't stand.`,
    };
  }
  const bookingId = found.id;

  // Fetch the charge outside the transaction — external API calls should not
  // hold a DB connection open. A failure throws, so the event is retried
  // rather than recording the payment without its fee and transfer ids.
  const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : null;
  let applicationFeeId: string | null = null;
  let stripeTransferId: string | null = null;
  // The fee Stripe actually took, not the one the booking expected.
  let applicationFeeCents: number | null = null;
  if (chargeId) {
    const charge = await stripe.charges.retrieve(chargeId);
    applicationFeeId = typeof charge.application_fee === "string" ? charge.application_fee : null;
    stripeTransferId = typeof charge.transfer === "string" ? charge.transfer : null;
    applicationFeeCents =
      typeof charge.application_fee_amount === "number" ? charge.application_fee_amount : null;
  }

  // FOR UPDATE atomically re-checks status so concurrent webhook deliveries
  // can't both pass the guard and send duplicate emails/pushes.
  type Outcome =
    | { kind: "confirmed"; booking: typeof bookings.$inferSelect }
    | { kind: "already_confirmed" }
    | { kind: "cancelled" }
    | { kind: "mismatch"; reason: string };

  const result: Outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [fresh] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
    if (!fresh) return { kind: "mismatch", reason: "the booking was deleted" };

    // The booking must be the one this PI was created for: same PI id, same
    // amount and currency, paid to this operator's account (P3-2). A mismatch
    // is never retried: Stripe would only send the same event again.
    const [operator] = await tx
      .select({ stripeAccountId: operators.stripeAccountId })
      .from(operators)
      .where(eq(operators.id, fresh.operatorId));
    const mismatch = paymentIntentMismatch(pi, fresh, operator?.stripeAccountId ?? null);
    if (mismatch) return { kind: "mismatch", reason: mismatch };

    // Idempotency: skip if already confirmed
    if (fresh.status === "confirmed") return { kind: "already_confirmed" };

    // Safety net: if the expire-pending-bookings cron somehow cancelled this
    // booking before the webhook arrived (PI status check gap), do not confirm
    // it — seats have already been restored and re-confirming would overbook.
    // Auto-refund the PI so the customer isn't charged for a cancelled booking.
    if (fresh.status === "cancelled") return { kind: "cancelled" };

    // Confirm the booking (seats were already taken at booking creation)
    await transitionBookings(tx, { operatorId: fresh.operatorId, bookingId }, "pending", "confirmed");

    // The tickets can board from now on. Only held ones move: a ticket already
    // voided (its trip was cancelled while the booking was pending) stays void.
    await moveTickets(tx, { operatorId: fresh.operatorId, bookingId }, "held", "live");

    // Record the payment
    await tx.insert(payments).values({
      bookingId,
      operatorId: fresh.operatorId,
      stripePaymentIntentId: pi.id,
      stripeChargeId: chargeId,
      applicationFeeId,
      stripeTransferId,
      amountCents: pi.amount,
      applicationFeeCents: applicationFeeCents ?? fresh.platformFeeCents,
      status: pi.status,
      metadata: pi.metadata,
    });

    return { kind: "confirmed", booking: fresh };
  });

  const operatorId = found.operatorId;
  if (result.kind === "mismatch") {
    return {
      outcome: "needs_review",
      operatorId,
      note: `${await bookingLabel(bookingId)}: a payment of ${usd(pi.amount)} didn't match it (${result.reason}), so the booking wasn't confirmed.`,
    };
  }
  if (result.kind === "already_confirmed") return { outcome: "handled", operatorId };

  if (result.kind === "cancelled") {
    // The payment landed on a booking that had already been cancelled (its
    // hold expired, or its trip was cancelled): refund it in full. The refund
    // is recorded once per payment (dedupe key), so a retried event doesn't
    // queue a second one, and a failed send is retried by the cron.
    const commandId = await queueRefund(db, {
      operatorId,
      bookingId,
      paymentIntentId: pi.id,
      amountCents: null,
      reason: "auto_refund",
      reverseTransfer: true,
      refundApplicationFee: true,
      dedupeKey: `auto-refund:${pi.id}`,
    });
    const sent = await sendCommand(commandId);
    return {
      outcome: "handled",
      operatorId,
      note: `Booking was cancelled; payment refunded in full (refund ${sent})`,
    };
  }

  const booking = result.booking;

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

  return { outcome: "handled", operatorId };
}
