import { and, eq, isNull, or } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { paymentAccount } from "@/lib/stripe-account";
import { payments } from "@openboat/db";
import { OutOfOrderEventError, type EventResult } from "@/lib/stripe-events/inbox";
import { bookingForPaymentIntent, sameAccount } from "@/lib/stripe-events/ownership";
import { stripeFeeOf } from "./payment-intent-succeeded";

// charge.updated: on a direct charge (row 32), Stripe attaches the charge's
// balance transaction and the platform's application fee a few seconds after
// payment_intent.succeeded (seen in test mode 2026-11-25: both null on the
// succeeded event, both set on the charge.updated that follows). This fills in
// what the payment didn't have yet: the fee's id, which exact fee refunds use,
// and Stripe's processing fee, which the Money page shows. Anything already
// recorded is kept.
export async function handleChargeUpdated(
  charge: Stripe.Charge,
  /** event.account: the connected account the charge is on; null for the platform's own. */
  account: string | null = null,
): Promise<EventResult> {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!piId) return { outcome: "ignored", note: `charge ${charge.id} has no payment intent` };

  const [payment] = await db
    .select({
      id: payments.id,
      operatorId: payments.operatorId,
      stripeAccountId: payments.stripeAccountId,
      applicationFeeId: payments.applicationFeeId,
      stripeFeeCents: payments.stripeFeeCents,
    })
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, piId));
  if (!payment) {
    const booking = await bookingForPaymentIntent(piId);
    if (booking?.status === "pending" && sameAccount(account, booking.stripeAccountId)) {
      throw new OutOfOrderEventError(`charge.updated for PI ${piId} before its payment was recorded`);
    }
    return { outcome: "ignored", note: "no payment here has this charge" };
  }
  if (!sameAccount(account, payment.stripeAccountId)) {
    return { outcome: "ignored", note: `not the account the payment is on (${account ?? "platform"})` };
  }
  if (payment.applicationFeeId && payment.stripeFeeCents !== null) {
    return { outcome: "ignored", operatorId: payment.operatorId, note: "nothing to fill in" };
  }

  const feeId = typeof charge.application_fee === "string" ? charge.application_fee : charge.application_fee?.id ?? null;
  let stripeFeeCents: number | null = null;
  if (payment.stripeFeeCents === null && charge.balance_transaction) {
    const bt =
      typeof charge.balance_transaction === "string"
        ? await stripe.balanceTransactions.retrieve(charge.balance_transaction, {}, paymentAccount(account))
        : charge.balance_transaction;
    stripeFeeCents = stripeFeeOf(bt);
  }
  if (!feeId && stripeFeeCents === null) {
    return { outcome: "ignored", operatorId: payment.operatorId, note: "no fee or balance transaction yet" };
  }

  await db
    .update(payments)
    .set({
      ...(feeId && !payment.applicationFeeId && { applicationFeeId: feeId }),
      ...(stripeFeeCents !== null && { stripeFeeCents }),
    })
    .where(
      and(
        eq(payments.id, payment.id),
        or(isNull(payments.applicationFeeId), isNull(payments.stripeFeeCents)),
      ),
    );
  return { outcome: "handled", operatorId: payment.operatorId };
}
