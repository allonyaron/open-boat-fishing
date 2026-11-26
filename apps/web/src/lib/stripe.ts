import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-06-24.dahlia",
});

/**
 * Request options for a call on an operator's own Stripe account. Payments are
 * direct charges (row 32): the PaymentIntent, its charge and its refunds live
 * on the connected account, so every call on them sends its Stripe-Account
 * header. Application fees live on the platform and take no header.
 */
export function onAccount(stripeAccount: string): Stripe.RequestOptions {
  return { stripeAccount };
}

/**
 * Request options for a call on a payment made on `stripeAccount`. A booking
 * from before row 32 has none: its PaymentIntent is a destination charge on
 * the platform, called without a header.
 */
export function paymentAccount(stripeAccount: string | null | undefined): Stripe.RequestOptions | undefined {
  return stripeAccount ? onAccount(stripeAccount) : undefined;
}
