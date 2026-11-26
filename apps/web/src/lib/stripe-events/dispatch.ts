import type Stripe from "stripe";
import { handlePaymentIntentSucceeded } from "@/lib/webhooks/payment-intent-succeeded";
import { handlePaymentIntentCanceled } from "@/lib/webhooks/payment-intent-canceled";
import { handleChargeRefunded } from "@/lib/webhooks/charge-refunded";
import { handleChargeUpdated } from "@/lib/webhooks/charge-updated";
import { handleChargeDisputeCreated } from "@/lib/webhooks/charge-dispute-created";
import {
  handleChargeDisputeClosed,
  handleChargeDisputeFundsWithdrawn,
  handleChargeDisputeUpdated,
} from "@/lib/webhooks/charge-dispute-later";
import type { EventResult } from "./inbox";
import { stripeContext } from "@/lib/request-context";

/**
 * Routes a saved event to its handler.
 *
 * Every PaymentIntent is a direct charge on the operator's own account (row
 * 32), so its events arrive through the Connect endpoint carrying
 * event.account; one made before row 32 is a destination charge on the
 * platform, whose events carry none. Each handler acts on a booking only if
 * the event comes from the account that booking's payment is on
 * (sameAccount), so an operator's own payment on their account can't confirm
 * or cancel anything (P3-2).
 */
export async function dispatchStripeEvent(event: Stripe.Event): Promise<EventResult> {
  const account = event.account ?? null;
  // The event is the actor of whatever money it moves (row 12).
  const ctx = stripeContext(event.id);
  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, ctx, account);
    case "payment_intent.canceled":
      return handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent, account);
    case "charge.refunded":
      return handleChargeRefunded(event.data.object as Stripe.Charge, ctx, account);
    case "charge.updated":
      // Fills in the fee id and Stripe's fee a direct charge gets after it succeeds (row 32).
      return handleChargeUpdated(event.data.object as Stripe.Charge, account);
    case "charge.dispute.created":
      return handleChargeDisputeCreated(event.data.object as Stripe.Dispute, ctx, account);
    case "charge.dispute.funds_withdrawn":
      return handleChargeDisputeFundsWithdrawn(event.data.object as Stripe.Dispute, ctx, account);
    case "charge.dispute.updated":
      return handleChargeDisputeUpdated(event.data.object as Stripe.Dispute, account);
    case "charge.dispute.closed":
      return handleChargeDisputeClosed(event.data.object as Stripe.Dispute, ctx, account);
    case "charge.dispute.funds_reinstated":
      // A won dispute: charge.dispute.closed puts the tickets back.
      return { outcome: "ignored", note: "handled by charge.dispute.closed" };
    default:
      return { outcome: "ignored", note: `no handler for ${event.type}` };
  }
}
