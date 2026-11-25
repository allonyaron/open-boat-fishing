import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { payments, stripeCommands } from "@openboat/db";
import { eq, inArray } from "drizzle-orm";
import { cancelConfirmedBooking } from "@/lib/bookings/cancel";
import type Stripe from "stripe";
import type { RequestContext } from "@/lib/request-context";
import { OutOfOrderEventError, type EventResult } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, destinationOf, orphanPaymentOwner } from "@/lib/stripe-events/ownership";
import { confirmRefundCommands, queueFeeRefund, queueTransferReversal, sendCommands } from "@/lib/payments/commands";
import { collectedOnBooking } from "@/lib/payments/operator-debts";
import { bookingLabel, usd } from "@/lib/stripe-events/notes";

/** The `reason` metadata the app puts on the refunds it issues itself. */
const APP_REFUND_REASONS = new Set(["admin_ticket_refund", "trip_cancelled", "auto_refund"]);

function isAppRefund(refund: Stripe.Refund): boolean {
  const meta = refund.metadata ?? {};
  return Boolean(meta.command_id) || APP_REFUND_REASONS.has(meta.reason ?? "") || Boolean(meta.tripId);
}

/**
 * Takes refunds made outside the app back from the operator, for each one
 * that didn't reverse the transfer itself (P3-3): otherwise the platform pays
 * the customer and the operator keeps the money. Capped at what is left of
 * the transfer. Returns the queued command ids, once per refund.
 */
async function queueReversalsFor(
  foreign: Stripe.Refund[],
  charge: Stripe.Charge,
  payment: { operatorId: string; bookingId: string },
  ctx: RequestContext,
): Promise<string[]> {
  const unreversed = foreign.filter((r) => !r.transfer_reversal && r.status !== "failed" && r.status !== "canceled");
  const transferId = typeof charge.transfer === "string" ? charge.transfer : charge.transfer?.id ?? null;
  if (unreversed.length === 0 || !transferId) return [];

  // Refunds already queued (a redelivery) keep their command; one still
  // pending hasn't reached the transfer yet, so it counts against what's left.
  const keyOf = (r: Stripe.Refund) => `refund-reversal:${r.id}`;
  const queued = await db
    .select({ id: stripeCommands.id, key: stripeCommands.dedupeKey, status: stripeCommands.status, amountCents: stripeCommands.amountCents })
    .from(stripeCommands)
    .where(inArray(stripeCommands.dedupeKey, unreversed.map(keyOf)));
  const queuedKeys = new Set(queued.map((q) => q.key));
  const fresh = unreversed.filter((r) => !queuedKeys.has(keyOf(r)));
  const ids = queued.map((q) => q.id);
  if (fresh.length === 0) return ids;

  const transfer = await stripe.transfers.retrieve(transferId);
  let left =
    transfer.amount -
    transfer.amount_reversed -
    queued.filter((q) => q.status === "pending").reduce((sum, q) => sum + (q.amountCents ?? 0), 0);
  for (const r of fresh) {
    const amountCents = Math.min(r.amount, left);
    if (amountCents <= 0) break;
    ids.push(
      await queueTransferReversal(db, {
        ctx,
        operatorId: payment.operatorId,
        bookingId: payment.bookingId,
        transferId,
        amountCents,
        reason: "dashboard_refund",
        metadata: { refundId: r.id },
        dedupeKey: keyOf(r),
      }),
    );
    left -= amountCents;
  }
  return ids;
}

// A charge was refunded, by the app or from the Stripe Dashboard.
// - A refund from outside the app that didn't reverse the operator's transfer
//   is taken back from the operator (queueReversalsFor), partial or full.
// - Fully refunded: reverse the platform fee and cancel the booking (its live
//   and disputed tickets move to refunded, their seats come back).
// - Partly refunded by the app (office ticket refunds, trip cancellations):
//   those paths already updated the tickets; nothing more to do.
// - Partly refunded from the Dashboard: the app can't tell which tickets were
//   refunded, so the event needs review.
export async function handleChargeRefunded(charge: Stripe.Charge, ctx: RequestContext): Promise<EventResult> {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) return { outcome: "ignored", note: `charge ${charge.id} has no payment intent` };

  const [payment] = await db
    .select({
      bookingId: payments.bookingId,
      operatorId: payments.operatorId,
      applicationFeeId: payments.applicationFeeId,
    })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));

  if (!payment) {
    const booking = await bookingForPaymentIntent(piId);
    if (booking?.status === "pending") {
      // Ours, but payment_intent.succeeded hasn't been processed yet (P3-8).
      throw new OutOfOrderEventError(`charge.refunded for PI ${piId} before its payment was recorded`);
    }
    if (booking) {
      // A booking with no payment row that isn't pending was cancelled before
      // its payment landed; this is the auto-refund of that payment.
      return { outcome: "handled", operatorId: booking.operatorId, note: "refund of a payment on a cancelled booking" };
    }
    // Whose payment is it? The PI carries the booking reference.
    const pi = await stripe.paymentIntents.retrieve(piId);
    const owner = await orphanPaymentOwner(destinationOf(pi) ?? destinationOf(charge), pi.metadata);
    if (!owner.ours) return { outcome: "ignored", note: owner.why };
    return {
      outcome: "needs_review",
      operatorId: owner.operatorId,
      note: `${usd(charge.amount_refunded)} was refunded on a payment no booking has (${piId}).`,
    };
  }

  // Which refunds on this charge did the app issue? Its own are confirmed
  // against their commands; the rest came from outside the app (the
  // Stripe Dashboard).
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  await confirmRefundCommands(refunds.data);
  const foreign = refunds.data.filter((r) => !isAppRefund(r));
  // A redelivery finds the commands by their dedupe keys and sends nothing new.
  const reversalIds = await queueReversalsFor(foreign, charge, payment, ctx);

  if (charge.amount_refunded < charge.amount) {
    await sendCommands(reversalIds);
    if (foreign.length === 0) return { outcome: "handled", operatorId: payment.operatorId };
    return {
      outcome: "needs_review",
      operatorId: payment.operatorId,
      note: `${await bookingLabel(payment.bookingId)}: ${usd(charge.amount_refunded)} of ${usd(charge.amount)} was refunded in the Stripe Dashboard, so the app can't tell which tickets it covers. Their tickets can still board.${reversalIds.length > 0 ? " The refund was taken back from the boat's Stripe balance." : ""}`,
    };
  }

  // Fully refunded. The app's own refunds already returned the platform fee
  // (in proportion, or exactly per ticket); a refund from outside the app
  // may not have, so reverse what is left of it, once per charge. A Dashboard
  // refund can return the fee itself: check first, so a fee with nothing left
  // doesn't become a refused refund on the Money page. A debt the operator
  // owed that this payment's fee carried (a chargeback fee) isn't returned.
  const feeLeft =
    foreign.length > 0 && payment.applicationFeeId
      ? await (async () => {
          const fee = await stripe.applicationFees.retrieve(payment.applicationFeeId!);
          const debt = await collectedOnBooking(payment.operatorId, payment.bookingId);
          return fee.amount - fee.amount_refunded - debt;
        })()
      : 0;
  // Reversals first: the operator's money comes back before the fee goes out.
  const commandIds = [...reversalIds];
  if (feeLeft > 0 && payment.applicationFeeId) {
    commandIds.push(await queueFeeRefund(db, {
      ctx,
      operatorId: payment.operatorId,
      bookingId: payment.bookingId,
      applicationFeeId: payment.applicationFeeId,
      amountCents: feeLeft,
      reason: "dashboard_refund_fee",
      dedupeKey: `fee-refund:${charge.id}`,
    }));
  }
  await sendCommands(commandIds);

  await cancelConfirmedBooking(payment.bookingId);
  return { outcome: "handled", operatorId: payment.operatorId };
}
