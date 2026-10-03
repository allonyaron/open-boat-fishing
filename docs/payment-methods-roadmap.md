# Payment methods roadmap

What customers can pay with today, what we could add, and what each option costs. Written 2026-10-03, right
after P2-5 (PR #28). The goal is to offer more ways to pay soon, and to make repeat checkout take fewer taps.

## Today

- **Card only.** `ALLOWED_PAYMENT_METHOD_TYPES = ["card"]` in `apps/web/src/lib/payment-methods.ts` sets
  both the PaymentIntent's `payment_method_types` and the web `Elements` `paymentMethodTypes`. Mobile confirms
  the same PI, so the same list applies there.
- **Link is off** in both UIs: `wallets: { link: "never" }` in `CheckoutForm.tsx`, and
  `link: { display: NEVER }` in `apps/mobile/app/checkout.tsx`.
  - Without that, Link shows up as a card wallet even on a card-only intent.
  - Its funding sources then add **Bank** and **Klarna** tabs.
- **Apple Pay and Google Pay are allowed in principle.** They're card wallets, so the PaymentMethod is a `card`.
  But neither actually shows up yet. See T1 and T3.
- **Why only methods that confirm instantly:** a trip can sail within hours of booking. Tickets are issued only
  when the PI is `succeeded`, and the expiry cron skips PIs that are `processing` (CODE_REVIEW P2-5). A method
  that settles days later leaves the customer with no boarding pass.

## Background: instant vs. delayed settlement

The question for any method is: **does Stripe report `succeeded` right after the customer approves it?**

- **Instant:** cards, Apple Pay, Google Pay, Link (including its Bank option, "Instant Bank Payments"), Cash App
  Pay, Amazon Pay, Klarna, Affirm, Afterpay. These fit our flow.
- **Delayed:** ACH Direct Debit (`us_bank_account`), SEPA, and other bank debits.
  - **ACH** is the US bank-to-bank network. The customer pays from a checking account, and fees are low
    (about 0.8%, capped at $5, against about 2.9% + 30¢ for cards).
  - But the PI sits in `processing` for 3–4 business days, and the debit can still fail afterwards. That
    doesn't fit a same-week fishing trip.

## Options

| Method | Who uses it | Available to us? | Work | Notes |
|---|---|---|---|---|
| Apple Pay (web) | iPhone/Mac Safari users | Yes, as a card wallet | XS: register domains (T1) | The biggest win for phone buyers. One tap, nothing typed. |
| Google Pay (web) | Android/Chrome users | Yes, as a card wallet | XS: same registration (T1) | |
| Apple Pay / Google Pay (app) | App users | Yes | S (T3) | Not turned on in `initPaymentSheet` yet. |
| Link | Customers who've used Link on any Stripe site | Yes | S (T5) | Faster for returning Link users. Adds an email/code step plus Bank and Klarna tabs. Settles instantly. |
| Cash App Pay | Younger customers | Yes (US) | S + T4 | Redirect or QR flow. Check Connect destination-charge support first. |
| Amazon Pay | Amazon shoppers | Yes (US) | S + T4 | Redirect flow. Check Connect support first. |
| Klarna / Affirm / Afterpay | Pay over time | Yes | S + T4 | Little value on a $55–$150 ticket. The provider may also restrict the business category. |
| PayPal | Broad, older customers | **Not through Stripe for US businesses.** Stripe's PayPal method is Europe-only. | M–L | US option: Stripe's private-preview "PayPal custom payment method" with the operator's **own PayPal account**. Money wouldn't flow through Connect, so no `application_fee_amount`. That breaks the fee model, so treat it as a product decision. |
| Venmo | Younger customers | **No.** Stripe doesn't offer Venmo. | L | Needs PayPal/Braintree as a second processor. |
| Zelle | Bank customers | **No.** It's a person-to-person bank transfer. | Not possible | No checkout integration, no refunds, no buyer protection. |
| ACH | Cost-conscious, large orders | Yes, but delayed | L | A ticket-lifecycle design change, not a toggle. See "Not planned". |

Sizes: XS under an hour, S a few hours, M a day or two, L several days.

## Faster repeat checkout

From least to most work:

1. **Apple Pay and Google Pay (T1, T3).** The phone stores the card. We don't need customer accounts or
   saved cards. This covers most mobile buyers.
2. **Browser autofill.** Works today: Chrome and Safari offer cards saved in the browser.
3. **Link (T5).** Stripe stores the card across every Stripe merchant. A returning Link user verifies by email
   or SMS code and pays in one click.
4. **Our own saved cards (T6).** A signed-in customer sees "Visa ending 4242" and taps Pay.

## Tasks

In suggested order. T1 is the cheapest win and can go first.

### T1. Turn on Apple Pay and Google Pay on the web: register domains (XS)

- **Status, checked 2026-10-03:**
  - Test mode has **no** payment-method domains registered.
  - Live mode wasn't checked; only the test key was available.
  - Both `openboatfishing.com` and `www.openboatfishing.com` serve the site.
- **Do:**
  - Register both hostnames on the **platform** account. Use `POST /v1/payment_method_domains` with
    `domain_name=…`, or Dashboard → Settings → Payment method domains.
  - Send **no** `Stripe-Account` header. We use destination charges, so the platform runs the charge.
  - Register in **live** mode. That registers the domain in test mode too.
- **No file hosting needed.** Stripe handles Apple's merchant validation, so we don't serve
  `/.well-known/apple-developer-merchantid-domain-association`.
- **Verify:** open checkout in Safari on a device that has Apple Pay set up, and check that the Apple Pay
  button appears. Headless Chromium never shows it.
- The same registration also covers Link, Amazon Pay, Klarna, and Stripe's PayPal method if we add them later.

### T2. Register each operator's domain automatically (S, before a second operator)

- In centralized mode, every operator hostname in the `domains` table needs registering. That includes
  `www.` variants.
- Call `paymentMethodDomains.create` when `/api/platform/operators` (or whatever adds a domain) saves it.
- Add a check that lists registered domains, so a missed registration is caught.

### T3. Turn on Apple Pay and Google Pay in the app (S)

- `apps/mobile/app/checkout.tsx` → `initPaymentSheet` needs two options:
  - `applePay: { merchantCountryCode: "US" }`
  - `googlePay: { merchantCountryCode: "US", testEnv: __DEV__ }`
- **Already in place:** `merchantIdentifier` (`merchant.com.openboat.fishing`) in `app.json`, and
  `EXPO_PUBLIC_APPLE_MERCHANT_ID` passed to `StripeProvider`.
- **Native Apple Pay setup (separate from T1):**
  - The Apple merchant ID needs an Apple Pay certificate created through Stripe: Dashboard → Settings →
    Apple Pay → iOS certificates.
  - The merchant ID must be on the app's provisioning profile, which is EAS-managed.
- **Test on a real device.** Both Apple Pay and Google Pay need a device build (EAS).

### T4. Prerequisites for any redirect-based method (M, once, before Cash App, Amazon Pay, Klarna, Affirm, or PayPal)

These methods send the customer to another site and back. Before enabling any of them:

- **Fix CODE_REVIEW P8-1.** The delivery and confirmation pages currently trust `?redirect_status=succeeded`
  from the URL. Redirect methods make that path the norm.
- **Fix CODE_REVIEW P8-8.** A failed or abandoned redirect lands on a "processing" screen that never ends.
- **Mobile:**
  - Pass `returnURL: "openboatfishing://stripe-redirect"` to `initPaymentSheet`. The app's scheme is
    `openboatfishing`.
  - Handle the deep link.
- **Web:** `confirmPayment` already uses `return_url`, so nothing to add.
- **E2E test:** the Payment Element shows tabs again, so the payment spec must click the Card tab first. See
  `docs/payment-e2e-handoff.md`.

### T5. Adding a payment method (S each, after T4 if it redirects)

Checklist:

1. **Confirm it settles instantly**, and that it supports **Connect destination charges** without
   `on_behalf_of`. Check the method's Stripe docs page, under "Connect support".
2. **Enable it on the platform account in live and test** (Dashboard → Settings → Payment methods).
   - Do this before shipping. A type that's pinned in code but not enabled on the account makes
     `paymentIntents.create` fail.
   - In this code, that failure cancels the booking and returns a 502, on **every** booking.
3. **Add the type** to `ALLOWED_PAYMENT_METHOD_TYPES` and update the assertion in `bookings.test.ts`.
4. **For Link only:** also remove the two Link opt-outs, `wallets.link` and `link.display`.
5. **Check mobile:** PaymentSheet supports the method, and `returnURL` is set (T4).
6. **Check refunds and disputes.** Run a test-mode refund through admin and confirm the `charge.refunded`
   webhook path works for this method.
7. **Run a real test-mode payment** with the method locally, then update the e2e spec.

### T6. Saved cards for signed-in customers (M)

1. **Stripe customer per customer.** Create a Stripe Customer for each `customers` row and store
   `stripeCustomerId`.
   - Watch the scope: `customers` is per operator. Decide whether a card saved with one operator should
     appear for another. The default should be no, matching the operator-isolation invariant.
2. **Save at payment time.** On the PI, set `customer` and `setup_future_usage: "on_session"` when the
   customer opts in.
3. **Show saved cards at checkout.**
   - Web: the Payment Element's saved-payment-method support, using a CustomerSession.
   - Mobile: PaymentSheet `customerId` plus an ephemeral key, or a CustomerSession.
4. **Let customers remove a saved card** from their account.
5. **Destination charges:** PaymentMethods live on the platform account, which is what we want here.

### Not planned: ACH and other delayed methods (L)

Only do this if a large-order use case shows up, like charters or group bookings paid weeks ahead. It would need:

- **A ticket state for `processing`.** No pass, a provisional pass, or a pass that's voided if the debit fails.
- **Cron and ticket-lifecycle changes.** The expiry cron and the ticket lifecycle module (CODE_REVIEW blocker
  #7) would have to handle `processing` bookings.
- **A policy for a debit that fails after the trip sailed.**
- **A cutoff,** for example ACH only when departure is more than 7 days away.

If it's ever added, pin it to bookings that meet the cutoff. Don't put it in the global list.
