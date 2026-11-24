import type Stripe from "stripe";
import { handlePaymentIntentSucceeded } from "@/lib/webhooks/payment-intent-succeeded";
import { handlePaymentIntentCanceled } from "@/lib/webhooks/payment-intent-canceled";
import { handleChargeRefunded } from "@/lib/webhooks/charge-refunded";
import { handleChargeDisputeCreated } from "@/lib/webhooks/charge-dispute-created";
import {
  handleChargeDisputeClosed,
  handleChargeDisputeFundsWithdrawn,
  handleChargeDisputeUpdated,
} from "@/lib/webhooks/charge-dispute-later";
import type { EventResult } from "./inbox";

/**
 * Routes a saved event to its handler.
 *
 * Every PaymentIntent this app creates is a destination charge on the
 * platform account, so the events it acts on never carry event.account. An
 * event that does comes from a connected account's own activity, which must
 * not be acted on: an operator could otherwise pay a $0.50 PI on their own
 * account and have a booking confirmed (P3-2).
 */
export async function dispatchStripeEvent(event: Stripe.Event): Promise<EventResult> {
  if (event.account) {
    return { outcome: "ignored", note: `from connected account ${event.account}` };
  }
  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
    case "payment_intent.canceled":
      return handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
    case "charge.refunded":
      return handleChargeRefunded(event.data.object as Stripe.Charge);
    case "charge.dispute.created":
      return handleChargeDisputeCreated(event.data.object as Stripe.Dispute);
    case "charge.dispute.funds_withdrawn":
      return handleChargeDisputeFundsWithdrawn(event.data.object as Stripe.Dispute);
    case "charge.dispute.updated":
      return handleChargeDisputeUpdated(event.data.object as Stripe.Dispute);
    case "charge.dispute.closed":
      return handleChargeDisputeClosed(event.data.object as Stripe.Dispute);
    case "charge.dispute.funds_reinstated":
      // A won dispute: charge.dispute.closed returns the money to the operator.
      return { outcome: "ignored", note: "handled by charge.dispute.closed" };
    default:
      return { outcome: "ignored", note: `no handler for ${event.type}` };
  }
}
