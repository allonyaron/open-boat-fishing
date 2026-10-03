# Handoff: real-payment e2e test in CI

Follow-up to launch blocker #2 (P9-1, merged in PR #27). The `Tests` job runs the booking Playwright spec,
but the spec stops at the payment form. The booking `POST` only fires after Stripe's Payment Element
accepts a card (`CheckoutForm.tsx` `handleSubmit`), and with placeholder keys that never happens. So the
money path (seat hold → PaymentIntent → card → webhook → confirmed booking + tickets) has no end-to-end test.
This doc covers what you and Claude each need to do to close that gap properly.

## Order of work

1. **Launch blockers #3 (P8-2) and #4 (P2-1)**: in progress, independent of this.
2. **Launch blocker #5 (P2-5)**: done on `fix/p2-5-pin-payment-methods`. See "Allowed payment methods" below.
3. **This work**, in its own session, once P2-5 is merged.

## Allowed payment methods (set by P2-5)

**`["card"]` only.** The list is `ALLOWED_PAYMENT_METHOD_TYPES` in `apps/web/src/lib/payment-methods.ts`.
Import it in the spec; don't hardcode the list.

- **PaymentIntent** (`POST /api/bookings`): `payment_method_types: ["card"]`, with no `automatic_payment_methods`.
  This applies to mobile too, which confirms the same PI.
- **Web Elements** (`CheckoutClient.tsx`): `paymentMethodTypes: ["card"]`.
- **Link is off** (product decision, 2026-10-02). A card-only intent still shows Link as a *card wallet*.
  On the platform's test account, Link's funding sources then add **Bank** (Instant Bank Payments, with a
  "$5 back" promo) and **Klarna** tabs. So `PaymentElement` passes `wallets: { link: "never" }`, and mobile
  PaymentSheet passes `link: { display: NEVER }`.
- **Apple Pay / Google Pay** still appear where the browser supports them. They're card wallets, and the
  resulting PaymentMethod is a `card`. Headless Chromium shows neither.
- **What the Payment Element renders:** card fields only. No tabs, no Link email or OTP step. The fields
  are Card number, Expiration date, Security code, Country, and ZIP code.

**Verified 2026-10-03** with a real test-mode payment (4242, local dev server, scratch DB, demo operator's
test connected account). It redirected to `/booking/delivery?…&redirect_status=succeeded`. The PI came back
`succeeded`, with `payment_method_types: ["card"]`, `automatic_payment_methods: null`,
`application_fee_amount: 150`, and `transfer_data.destination` set to the connected account.

Selector notes from that run, for the iframe helper:
- **Two iframes match the title.** There are two `iframe[title="Secure payment input frame"]`. The first
  is the one with the card inputs, but select by content (`getByLabel(/card number/i)`), not by index.
- **CVC needs a role selector.** `getByLabel(/security code|cvc/i)` matches both the input and a CVC icon
  `<svg aria-label>`. Use `getByRole("textbox", { name: "Security code" })`.
- **ZIP code is shown** (Country defaults to United States). Fill it.

## You: before the session

| # | Task | Where |
|---|------|-------|
| U1 | Add repo secret `STRIPE_TEST_SECRET_KEY`, the `sk_test_…` key for the **platform** account. It's the same value as `STRIPE_SECRET_KEY` in `apps/web/.env.local`. | GitHub → Settings → Secrets and variables → Actions |
| U2 | Add repo secret `STRIPE_TEST_PUBLISHABLE_KEY`, the matching `pk_test_…` key. | same |
| U3 | Add repo secret `STRIPE_TEST_CONNECTED_ACCOUNT_ID`, a **test-mode** connected account (`acct_…`). The demo operator's test account is fine. | same |
| U4 | Confirm that U3's account has `charges_enabled` and the `transfers` capability **active**. Destination charges fail at PI creation without them. | Stripe Dashboard (test mode) → Connect → Accounts → the account |
| U5 | Confirm `Tests` is a required check on `main`. It wasn't when PR #27 merged: only the smoke test and the build were listed. | GitHub → Settings → Branches → `main` rule |

Never paste key values into the chat. Claude reads them only as `${{ secrets.* }}` in the workflow.

## Claude: in the session

Start the session with:

> Build the real-payment e2e test described in docs/payment-e2e-handoff.md. Start on a new branch.

### C1. Workflow (`.github/workflows/web-checks.yml`, `tests` job)

- **Fail closed.** Add a first step that fails the job if any of the three secrets is empty. A missing
  secret must never turn into a skipped payment test that still shows green.
- **Install the Stripe CLI** with a pinned version: the GitHub release tarball, or Stripe's apt repo.
- **Get the webhook signing secret** with `stripe listen --api-key "$STRIPE_TEST_SECRET_KEY" --print-secret`
  and export it as `STRIPE_WEBHOOK_SECRET` through `$GITHUB_ENV`.
- **Forward events in the background**, logging to `$RUNNER_TEMP/stripe-listen.log`:
  `stripe listen --api-key … --forward-to localhost:3000/api/webhooks/stripe --events payment_intent.succeeded,payment_intent.canceled,charge.refunded,charge.dispute.created`.
  Those are the four events the handler processes. Wait for the `Ready!` line before running Playwright.
- **Seed with `STRIPE_CONNECTED_ACCOUNT_ID`** set to the secret. `seed-demo.ts` already reads it and sets
  `stripeAccountId` and `stripeOnboardingComplete`.
- **Build and start with the real keys.** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is inlined at **build**
  time, so it has to be in the build step's env, not just `start`'s. Pass the real `STRIPE_SECRET_KEY` and
  the `STRIPE_WEBHOOK_SECRET` from `stripe listen`.
- **Add `stripe-listen.log` to the failure artifact upload.**

### C2. Spec (`e2e/booking-flow.spec.ts`, or a new `e2e/payment.spec.ts`)

New test: **"pays with a test card and gets confirmed tickets"**.

- **Skip locally when `STRIPE_SECRET_KEY` is a placeholder or unset.** In CI, throw instead, the same pattern
  as the post-payment fixture guard.
- **Use a unique email per run and per project**, for example `e2e+${Date.now()}-${project}@example.com`.
  The desktop and mobile projects run in parallel.
- **Pay:** book via `/book?date=…` as the existing flow does, fill the contact form, then fill the Payment
  Element inside its iframe:
  - use `page.frameLocator(...)` with label/role selectors;
  - card `4242 4242 4242 4242`, any future expiry, any CVC, ZIP if shown;
  - click **Pay**.
- **Assert:**
  1. The page lands on `/booking/delivery?…&redirect_status=succeeded`.
  2. Poll the e2e DB directly (the `postgres` package, `DATABASE_URL` from env, timeout about 30s) until the
     booking is `confirmed`. Then check that ticket count equals seats bought and that the fee row is
     `held`. Don't poll `GET /api/bookings?email=&code=`: it's rate-limited, and the global-setup already
     spends attempts on it.
  3. Retrieve the PaymentIntent with the `stripe` SDK (already a web dependency) and check:
     - `transfer_data.destination` is the connected account;
     - `application_fee_amount` is `150 × tickets` (CLAUDE.md invariants);
     - `payment_method_types` equals `[...ALLOWED_PAYMENT_METHOD_TYPES]` (`["card"]`).
  4. `/boarding/{bookingId}` shows one `QR code for ticket …` image per ticket.
- **Also cover a decline:** card `4000 0000 0000 0002` shows the error inline, stays on `/checkout`, and
  leaves the booking `pending`. Restoring the seats is the expiry cron's job, which is already unit-tested.

### C3. Verify before handing back

- **Run it locally** with the real test keys from `.env.local`, the Stripe CLI (`brew install stripe/stripe-cli/stripe`)
  and a scratch Postgres, using the same steps as the workflow. The scratch-cluster replay from the P9-1
  session is the model.
- **Push nothing yourself** (the user pushes). After the user opens the PR, check the `Tests` job log for:
  - the payment test actually **executed**, not skipped;
  - the webhook delivery lines in `stripe-listen.log`.
- **Update CLAUDE.md** (the Playwright commands section) and this doc's status line.

## Known risks

- **Stripe Link.** It's off (see "Allowed payment methods"), so no Link step should appear. If one does,
  `wallets: { link: "never" }` has regressed. Fail the test; don't add handling for the step.
- **Payment Element labels.** They're Stripe's, not ours, and can change between Stripe.js versions. Keep the
  iframe selectors in one helper.
- **Test-mode clutter.** Every CI run leaves PaymentIntents and customers in the platform's test account.
  That's harmless, but expect it in the Dashboard.
- **Network dependency.** The job now depends on Stripe's API and webhook forwarding. If that turns out
  flaky, retry at the step level. Never make the payment test optional.

## Status

Not started. Blocked on P2-5 merging and on U1–U4.
