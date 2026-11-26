import { db } from "@/lib/db";
import { paymentAccount, stripe } from "@/lib/stripe";
import { payments } from "@openboat/db";
import { eq } from "drizzle-orm";
import { cancelConfirmedBooking } from "@/lib/bookings/cancel";
import type Stripe from "stripe";
import type { RequestContext } from "@/lib/request-context";
import { OutOfOrderEventError, type EventResult } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, destinationOf, orphanPaymentOwner, sameAccount } from "@/lib/stripe-events/ownership";
import { confirmRefundCommands, queueFeeRefund, sendCommands } from "@/lib/payments/commands";
import { bookingLabel, usd } from "@/lib/stripe-events/notes";

/** The `reason` metadata the app puts on the refunds it issues itself. */
const APP_REFUND_REASONS = new Set(["admin_ticket_refund", "trip_cancelled", "auto_refund"]);

function isAppRefund(refund: Stripe.Refund): boolean {
  const meta = refund.metadata ?? {};
  return Boolean(meta.command_id) || APP_REFUND_REASONS.has(meta.reason ?? "") || Boolean(meta.tripId);
}

/**
 * What is left of the payment's platform fee, by the fee's id or, until the
 * payment has it, by its charge (a direct charge's fee is created
 * asynchronously). Null when the fee can't be found yet.
 */
async function feeLeftOn(
  payment: { applicationFeeId: string | null },
  chargeId: string,
): Promise<{ feeId: string; leftCents: number } | null> {
  const fee = payment.applicationFeeId
    ? await stripe.applicationFees.retrieve(payment.applicationFeeId)
    : (await stripe.applicationFees.list({ charge: chargeId, limit: 1 })).data[0];
  return fee ? { feeId: fee.id, leftCents: fee.amount - fee.amount_refunded } : null;
}

// A charge was refunded, by the app or by the operator in their own Stripe
// Dashboard. Payments are direct charges on the operator's account (row 32),
// so a refund there comes out of the operator's balance and takes nothing
// from the platform; the platform's fee isn't refunded with it.
// - Fully refunded: the rest of the platform fee goes back to the operator
//   (decided 2026-11-25: the fee always reverses when the passenger doesn't
//   sail) and the booking is cancelled (its live and disputed tickets move to
//   refunded, their seats come back).
// - Partly refunded by the app (office ticket refunds, trip cancellations):
//   those paths already updated the tickets and their fees; nothing more to do.
// - Partly refunded from the Dashboard: the app can't tell which tickets were
//   refunded, so the event needs review.
export async function handleChargeRefunded(
  charge: Stripe.Charge,
  ctx: RequestContext,
  /** event.account: the connected account the charge is on; null for the platform's own. */
  account: string | null = null,
): Promise<EventResult> {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) return { outcome: "ignored", note: `charge ${charge.id} has no payment intent` };

  const [payment] = await db
    .select({
      bookingId: payments.bookingId,
      operatorId: payments.operatorId,
      applicationFeeId: payments.applicationFeeId,
      stripeAccountId: payments.stripeAccountId,
    })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));

  if (!payment) {
    const booking = await bookingForPaymentIntent(piId);
    if (booking && !sameAccount(account, booking.stripeAccountId)) {
      return { outcome: "ignored", note: `not the account the booking's payment is on (${account ?? "platform"})` };
    }
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
    const pi = await stripe.paymentIntents.retrieve(piId, {}, paymentAccount(account));
    const owner = await orphanPaymentOwner(account ?? destinationOf(pi) ?? destinationOf(charge), pi.metadata);
    if (!owner.ours) return { outcome: "ignored", note: owner.why };
    return {
      outcome: "needs_review",
      operatorId: owner.operatorId,
      note: `${usd(charge.amount_refunded)} was refunded on a payment no booking has (${piId}).`,
    };
  }
  if (!sameAccount(account, payment.stripeAccountId)) {
    return { outcome: "ignored", note: `not the account the payment is on (${account ?? "platform"})` };
  }

  // Which refunds on this charge did the app issue? Its own are confirmed
  // against their commands; the rest came from outside the app (the
  // operator's Stripe Dashboard).
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 }, paymentAccount(account));
  await confirmRefundCommands(refunds.data);
  const foreign = refunds.data.filter((r) => !isAppRefund(r));

  if (charge.amount_refunded < charge.amount) {
    if (foreign.length === 0) return { outcome: "handled", operatorId: payment.operatorId };
    return {
      outcome: "needs_review",
      operatorId: payment.operatorId,
      note: `${await bookingLabel(payment.bookingId)}: ${usd(charge.amount_refunded)} of ${usd(charge.amount)} was refunded in the Stripe Dashboard, so the app can't tell which tickets it covers. Their tickets can still board. Refund single tickets from the passenger list instead.`,
    };
  }

  // Fully refunded. The app's own refunds already returned their tickets'
  // fees exactly; a refund from outside the app didn't return any, so the
  // rest of the fee goes back, once per charge. Checked first, so a fee with
  // nothing left doesn't become a refused refund on the Money page. A fee
  // Stripe hasn't created yet is refunded in full once it exists.
  const commandIds: string[] = [];
  if (foreign.length > 0) {
    const fee = await feeLeftOn(payment, charge.id);
    if (!fee || fee.leftCents > 0) {
      commandIds.push(
        await queueFeeRefund(db, {
          ctx,
          operatorId: payment.operatorId,
          bookingId: payment.bookingId,
          feeOrChargeId: fee?.feeId ?? charge.id,
          amountCents: fee ? fee.leftCents : null,
          reason: "dashboard_refund_fee",
          dedupeKey: `fee-refund:${charge.id}`,
        }),
      );
    }
  }
  await sendCommands(commandIds);

  await cancelConfirmedBooking(payment.bookingId);
  return { outcome: "handled", operatorId: payment.operatorId };
}
