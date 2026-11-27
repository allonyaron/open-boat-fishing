import { initStripe } from "@stripe/stripe-react-native";

export const STRIPE_PK = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
export const MERCHANT_ID = process.env.EXPO_PUBLIC_APPLE_MERCHANT_ID ?? "";
export const URL_SCHEME = process.env.EXPO_PUBLIC_URL_SCHEME ?? "";

/**
 * Points the Stripe SDK at the account a booking's PaymentIntent is on.
 * Payments are direct charges on the operator's own Stripe account (row 32),
 * so the PaymentSheet must load on that account to find the PI.
 */
export function loadStripeAccount(stripeAccountId: string): Promise<void> {
  return initStripe({
    publishableKey: STRIPE_PK,
    merchantIdentifier: MERCHANT_ID,
    urlScheme: URL_SCHEME,
    stripeAccountId,
  });
}
