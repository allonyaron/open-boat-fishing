# Booking Flow — UX Review, Decisions, and Backlog

Source: `booking-flow-spec-v2.md` + as-built screenshots (01–09).
Reviewed from a consumer-marketplace checkout perspective, biased against friction before payment.

---

## 1. Drop-off risk points

**Screen 1 — no price on list rows.** Price is a primary decision variable for a charter. A customer must tap into every trip to learn it, and every tap-in-and-back is an exit opportunity. Same for trip length: "7:00 AM – 12:00 PM" makes the customer do arithmetic to learn it's a half day.

**Screen 1 — availability badges are miscalibrated.** "8 left" and "6 left" render red, the same visual family as "Sold out." A boat with 8 open seats reads as almost-gone. Two vocabularies ("left" / "avail.") for one concept. Red should be reserved for ≤3 seats or sold out.

**Screen 2 — no refund/weather policy at the decision point.** The largest hesitation for a weather-dependent outdoor purchase, and the answer currently lives behind a terms link on the _next_ screen.

**Screen 2 — Child priced identically to Adult ($65 both).** Two ticket types at the same price makes customers stop and wonder what they're missing. No under-5 option, which creates a real question at the gangway for families.

**Screens 3–4 — pinned mobile cart bar overlaps list content.** In `04-cart-bar.png`, "$130 / 2 tickets" strikes through the Friday trip card. CTA is "Reserve →" here and "Checkout →" on the cart page — two labels for one motion.

**Screens 5→6 — contact form is a second modal on top of the cart.** In `06-contact-form.png` the sheet covers the order total and "Continue to payment" reads visually disabled. Highest-risk transition: the customer has committed, and there's no visible confirmation of what they're buying.

**Screen 6→7 — name, email, phone collected _before_ Stripe.** The structural problem. A customer ready to pay with a wallet in one tap must hand-type three fields first, then load a second full page. Two sequential data-entry screens on mobile is where abandonment concentrates.

**Screen 7 — order summary says "2 tickets — $130" and nothing else.** No trip name, date, or vessel at the moment of payment, and no visible way back.

**Screen 7 — "$5 back" badge steers toward ACH.** Visible on the mobile capture; renders as an untitled green icon on desktop. Almost certainly Stripe-rendered (the ACH incentive in the Payment Element), so it's a Payment Element configuration decision, not a UI change.

---

## 2. Click / friction reduction

- **Reorder checkout: express payment first, form second.** Put wallets/Link above the details form and harvest email from the payment payload. For those users, Screen 6 disappears. Target path: list → sheet → pay.
- **Collapse Screens 5, 6, 7 into one scrollable page.** Order summary (with trip name and date), email, payment element.
- **Cut Full Name or make it optional-and-collapsed.** The spec already flags it non-required.
- **Fix input ergonomics.** `autocomplete="email"` / `"tel"`, `type=email`, `inputmode=numeric`.
- **Default the Adult stepper to 1.** Consider quantity chips (1 / 2 / 4) — party size clusters hard around 2.
- **Verify "Add to cart" enabled state.** Renders pale in `03-qty-selected.png` with a valid selection and $130 subtotal.
- **Skip passwords for repeat customers.** Strongest moment to create an account is the confirmation screen — the customer is happy and their email is verified by the receipt. Magic link, no password. On return, recognized email + saved Stripe payment method = one-tap rebooking.
- **Push rebooking, not just accounts.** "Book this trip again" deep link in the post-trip email; captain-triggered "seats open next Wednesday" SMS to past customers. Accounts are the plumbing; the trigger is the product.

---

## 3. Domain-specific gaps

**Weather cancellation defines this product, and payment method selection is downstream of it.** ACH refunds are slow; BNPL refunds slower. If a meaningful share of departures get cancelled, you're building a refund-latency support problem into checkout — and incentivizing it. Suppress bank transfer and BNPL at this price point; lead with card and wallets. Offer **trip credit as a one-tap alternative to refund**: better for operator cash flow, and most customers prefer rebooking.

**Manifest / passenger names.** A party of three is currently one name on three passes. See Decision 5 below.

**Walk-up and online must share one inventory ledger in real time.** The oversell risk is a mate selling three seats at the dock while three online carts hold the same seats. POS needs the same write path and hold semantics; the hold-expiry job must be idempotent against it.

**Offline is a dock problem.** Captree has spotty coverage. An SMS _link_ assumes the customer can load a page at the gangway. Attach the PDF to the confirmation email and add Apple/Google Wallet passes. The signed-QR-plus-cached-manifest design on the mate side is right; the customer side needs the same assumption.

**Standby should be day-scoped, not trip-scoped.** Demand is last-minute and weather-correlated. Someone who wanted the 7 AM fluke trip will usually take the 7 PM bass trip. Let people join standby for a date or a species.

**Trip changes, not just cancellations.** Captains switch target species and swap vessels. Needs a "your trip changed" notification with accept-or-refund.

**Missing revenue surfaces.** No rod rental, fillet service, license, or mate gratuity. See Decision 6.

**Boarding pass omits the two things that generate support calls:** dock location (with map link) and arrival time ("be at the boat by 6:30"). Also missing: operator phone, weather policy, cancel link.

---

## 4. Decisions

### 1. Passive terms acceptance — KEEP, but split and relocate

Two things are conflated today:

- **Refund/cancellation/weather policy.** Passive notice is the right friction call. But current placement — below the Checkout button and below "Continue shopping" — is the weakest possible one. Conspicuous notice _immediately adjacent to the action button_ is what makes clickwrap hold up; placement matters more than a checkbox. Move it above the pay CTA. Record terms version + timestamp on the order record — that's the artifact that helps in a chargeback dispute.
- **Liability waiver, if one exists.** Assumption-of-risk waivers for a vessel trip are held to a materially higher standard of assent, and passive notice is a poor fit. If the operator's terms include one, pull it into an affirmative step — ideally at check-in on the mate's app, where it costs zero conversion.

_Not legal advice; have counsel confirm the split. The friction argument only applies to the first bucket._

### 2. Standby — FIRST-IN-LINE, window scaled to departure

Notify-all is worse than it looks: a customer who taps a text and hits "sold out" has a worse experience than never being notified, and it generates support contacts. First-in-line also mirrors the hold mechanism, so it's less new machinery than it appears.

- **Scale the window.** ~30 min if >24h out; ~10 min same-day; inside ~2 hours drop to notify-all-first-to-book, because there isn't time to be fair. A fixed 10 minutes at 6:05 AM for a 7:00 AM departure burns a fifth of remaining sell time.
- **Take a card at signup** (SetupIntent, no charge) so claiming is one tap, not a full checkout under a countdown.
- **Show queue position** ("you're #3") — sets expectations, cuts "did it work?" contacts.
- Auto-advance on expiry; cap how many people you walk through before falling back to open notification.

### 3. Inventory hold — 10 MIN, but conditional

The duration matters less than three other things:

1. **Make the hold conditional.** A 40-seat boat with 29 open seats has no double-booking problem. Engage holds only below ~4 seats or ~15% of capacity. Otherwise you're adding a countdown, a background job, and customer anxiety to solve a problem that isn't occurring.
2. **Hide the countdown until it matters.** Surface under 2:00 remaining, or on return to an aging cart. A timer on arrival at the cart reads as pressure.
3. **Extend on payment attempt.** A hold expiring mid-3DS or mid-Cash-App-handoff produces the ugliest support tickets.

On expiry, don't silently empty the cart. Keep line items, mark "seat released — tap to check availability," re-add if still there.

### 4. Booking cutoff — DEPARTURE TIME, captain-overridable

Default the cutoff to departure rather than 1 hour prior, but add a captain-controlled "close sales" button in the mate app and treat that as the real signal. Sail time is a schedule; the boat leaves when the captain says it leaves. Online sales stay open until departure _or_ captain close, whichever comes first. Captain can reopen if holding the boat.

- **Last-minute buyer who doesn't make it.** Confirmation interstitial inside the last ~15 min: "This trip departs in 4 minutes — are you at the dock?" Defensible friction; the alternative is a chargeback.
- **Async payment methods.** Bank transfer and BNPL don't settle fast enough inside the cutoff window. Card and wallets only for imminent departures.
- **Manifest must keep updating.** If the mate pulls a manifest at 6:45 and someone buys at 6:52, the app needs to pick it up — same live-ledger requirement as the walk-up POS.

### 5. Passenger names — POST-PURCHASE, never at the gangway

The mate app is the wrong place for primary capture; a line waiting to board is the worst possible input moment. Collect names **after payment** via a "Who's coming?" step on the confirmation screen. The purchase is already complete, so anything skipped costs nothing in conversion — the only place in this flow where asking for more data is free.

- Ticket 1 pre-fills with the purchaser. Solo angler: zero input.
- Remaining tickets get name fields; child tickets get an age field.
- Form stays editable from the booking link, so it can be filled the night before.
- Reminder email 24h out with a one-tap link picks up stragglers.
- Print names on passes once known, so the mate reads rather than types.
- Keep an _optional_ name field in the mate app for dock walk-ups, but never required to check someone in. A valid signed QR must always scan through.

_Open: COI requirements vary by vessel class, route, and passenger count. Confirm with the captain what his certificate actually obliges him to record — that determines whether "optional at checkout" is even viable._

### 6. Add-ons — THREE-STATE, admin-configurable

Build as a generic per-trip add-on object, not a rod-specific feature. Three states, not two:

- **Included** — surfaced on the trip detail screen. Not the same as "off": a first-timer who doesn't know whether to bring gear is a first-timer who doesn't book.
- **Available at $X** — sold as a line item.
- **Not offered.**

Same shape covers fillet service, licenses, gratuity. Set at trip-template level with per-departure override, so a captain configures "every Wednesday night bass trip" once, not forty times.

### 7. Capacity — CAPTAIN-EXPANDABLE UNDER A HARD CEILING

Captains can raise a listed 29 to 39 or higher when a trip sells out. This is a real operational need.

- **Certificate maximum is a hard cap, server-enforced, admin-only.** Never editable by the captain in the field.
- **Show both numbers** in the app — "29 listed, 45 certified" — so headroom is obvious.
- **Adding seats must fire the standby queue.** This is the most common way seats become available, more so than cancellations, and it's where standby earns its keep.
- **Guard against going backward past sold count.** If 31 are sold, capacity can't be set to 30. Same screen gets used to reduce capacity on a boat swap.
- **Log capacity changes with who and when.** When a manifest and a certificate disagree during an inspection, that history resolves it.

---

## 5. Two flags outside the review scope

**Confirmation code looks derivable.** `080602` reads as August 6 plus a sequence. If that — or a sequential booking ID — appears in `/boarding/[bookingId]`, the page exposing purchaser name, trip, and passes is enumerable. The signed QR protects against forged _tickets_, not against the page. Use a high-entropy token in the URL; keep the friendly code display-only.

**Screenshot data doesn't reconcile.** Delivery screen shows 2 tickets / $130 / Aug 5 bass trip; boarding pass page shows 3 tickets / Aug 6 fluke trip under confirmation 080602. Probably demo fixtures, but it touches pass generation against line items. A family showing up one pass short at 6:45 AM is an unrecoverable failure.

---

## 6. Backlog

Four batches, ordered so nothing blocks on something later.

### Batch 1 — Verify (urgent)

| #   | Item                                                      |
| --- | --------------------------------------------------------- |
| 1   | Audit boarding-pass URL for enumerability                 |
| 2   | Reconcile ticket count between order and generated passes |

### Batch 2 — Quick wins (no decisions needed, ship independently)

| #   | Item                                                               |
| --- | ------------------------------------------------------------------ |
| 3   | Price + trip length on trip list rows                              |
| 4   | Recalibrate availability badge thresholds; unify "left" / "avail." |
| 5   | Unify forward CTA label across cart bar and cart page              |
| 6   | Fix pinned mobile cart bar overlapping list content                |
| 7   | Add `autocomplete` / `inputmode` / `type` to contact fields        |
| 8   | Default Adult stepper to 1                                         |
| 9   | Surface refund + weather policy in ticket selector sheet           |
| 10  | Move terms notice above the pay CTA                                |
| 11  | Record terms version + timestamp on order                          |
| 12  | Verify "Add to cart" enabled state                                 |
| 13  | Add dock location, arrival time, operator phone to boarding pass   |

### Batch 3 — Checkout restructure (blocked on #14 and on the waiver question)

| #   | Item                                                               |
| --- | ------------------------------------------------------------------ |
| 14  | Instrument step-level funnel, list view → paid                     |
| 15  | Collapse cart + contact + payment into one page                    |
| 16  | Express payment above the details form; harvest email from payload |
| 17  | Trip name, date, vessel in payment-screen order summary            |
| 18  | Full Name optional and collapsed                                   |
| 19  | Magic-link account creation at confirmation                        |
| 20  | Post-purchase "Who's coming?" passenger name step                  |

### Batch 4 — Inventory (holds before standby)

| #   | Item                                                                 |
| --- | -------------------------------------------------------------------- |
| 21  | Conditional inventory hold — 10 min, below ~4 seats or ~15% capacity |
| 22  | Hold expiry job, idempotent against walk-up POS writes               |
| 23  | Countdown UI surfaced only under 2:00                                |
| 24  | Extend hold on payment attempt in progress                           |
| 25  | Preserve cart line items on expiry with re-check affordance          |
| 26  | Standby — first-in-line, scaled window, SetupIntent, queue position  |
| 27  | Cutoff at departure + captain "close sales" control                  |
| 28  | Captain capacity expansion under server-enforced certificate ceiling |
| 29  | Admin add-on config — three-state, trip-template level               |

### Open decisions (need an owner and a date)

| #   | Question                                                           | Owner       |
| --- | ------------------------------------------------------------------ | ----------- |
| 30  | Does the operator's terms include a liability waiver? _Blocks #15_ | Counsel     |
| 31  | What is the actual weather-cancellation rate?                      | —           |
| 32  | What does the COI require for passenger names?                     | Captain     |
| 33  | Are ancillaries in v1 scope?                                       | Operator    |
| 34  | Does walk-up POS share the inventory ledger? _Blocks #22_          | Engineering |
| 35  | Child pricing parity with Adult; under-5 tier?                     | Operator    |

---

## 7. Instrumentation

Once the funnel is wired, watch:

- Step-level drop-off, list view → paid
- Express-payment share of completions
- Hold expiries per completed checkout
- Standby claim rate

The last two will tell you fairly quickly whether the holds are calibrated right.
