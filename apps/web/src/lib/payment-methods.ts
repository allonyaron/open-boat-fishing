/**
 * The only payment-method types a booking can be paid with (P2-5). Used for
 * both the PaymentIntent (`payment_method_types` in POST /api/bookings) and the
 * web Payment Element (`paymentMethodTypes` in CheckoutClient), so the two
 * always agree. If they differed, Elements could offer a method that the PI
 * then rejects at `confirmPayment`.
 *
 * Pinned in code so that Dashboard settings can't turn on a delayed-settlement
 * method (ACH, SEPA, etc.). Those leave the PI in `processing` for days: no
 * tickets are issued until `succeeded`, and the expiry cron skips `processing`
 * PIs, so a customer would have no boarding pass for a near-term trip.
 *
 * "card" also covers Apple Pay and Google Pay. Link is left out on purpose
 * (product decision, 2026-10-02): it's settlement-safe, but it adds an
 * email/OTP step to checkout. Leaving "link" out of this list isn't enough on
 * its own. Link still shows as a card wallet, with Bank and Klarna funding
 * tabs, so it's also turned off in the UI: `wallets.link` in CheckoutForm and
 * `link.display` in the mobile checkout.
 *
 * Client-safe: no server imports.
 */
export const ALLOWED_PAYMENT_METHOD_TYPES = ["card"] as const;
