# Booking Flow Spec — v3

_Last updated: 2026-08-07. Supersedes `booking-flow-spec.md` and `booking-flow-spec-v2.md`. Based on screenshots in `screenshots/mobile/` and `screenshots/desktop/`._

> **This is the single source of truth. Delete both predecessors.**
> Companion doc: `booking-flow-review-and-decisions.md` (UX review rationale and backlog).

---

## 0. Changelog

**Merged from `booking-flow-spec.md` (repo doc, 2026-08-07):** overall structure and gap-table format; per-product configurable ticket types; walk-up operator UI as its own spec; standby channel opt-in; one-tap captain cancellation as a success criterion; rate-limited endpoints; Screen 9 print detail; the SMS-link proposal for text updates.

**Merged from `booking-flow-spec-v2.md`:** inventory holds on add-to-cart; Full Name as optional; guest checkout explicitly supported with accounts never required; self-cancellation as full refund with automatic seat restoration; terms passivity as a deliberate friction choice; the standby fairness framing.

**New in v3 (from the UX review):** checkout restructured to one page with express payment first; post-purchase passenger-name capture; cutoff moved to departure with captain override; captain capacity expansion under a certificate ceiling; three-state add-on config; conditional inventory holds; departure-scaled standby windows; terms notice relocated above the pay CTA.

**Regressions corrected:** Full Name was marked Required in the repo doc — reverted to optional. Inventory holds had been dropped entirely — restored.

**Corrected after review:** an earlier v3 draft claimed walk-ups "write to the same inventory ledger as online sales," which implied a dock checkout mates would never use. Rewritten as a walk-on headcount counter (§3). Trip length was ambiguous about whether it replaced the return time — it does not; both display.

---

## 1. What the Product Does

A web-based ticket sales platform for party fishing boat operators. Operators list scheduled trips by date, vessel, and fish type. Customers browse departures, select ticket quantities by type, pay online, and receive printable boarding passes. The platform handles seat inventory, payment processing, ticket delivery, passenger manifests, and post-booking trip updates (cancellations, changes, reminders).

Walk-up purchases are supported. They are cash transactions handled offline at the dock — no ticket is generated — but the mate records them with a one-tap walk-on counter so seat inventory and manifest headcount stay accurate against the vessel's certificate.

Checkout is guest-first; account creation is offered after purchase and is never required.

---

## 2. Click-by-Click Flow

### Screen 1 — Trip Calendar / List

**Mobile:** Scrollable list grouped by date. Each row shows:

- Fish-type category label (FLUKE, STRIPED BASS, SEA BASS)
- Trip display name ("Bay Blues / Bass / Weakfish")
- Vessel name + departure–return time range **with duration appended**: `Laura Lee · 7:00 AM – 12:00 PM · 5 hr`
  - _The return time stays — customers plan the rest of their day around it. The duration is added so nobody has to compute it. Both, not either._
- **Price from** ("$65") — _new; price is a primary decision variable and currently requires a tap-in_
- Availability badge

**Desktop:** Calendar / List toggle (top-right). Calendar shows a month grid; days with trips display colored dots, one per vessel. Right panel prompts "Select a date to see trips."

**Availability badge thresholds** _(revised — current build renders "8 left" in the same red as "Sold out")_:

| State                  | Copy            | Treatment         |
| ---------------------- | --------------- | ----------------- |
| ≤3 seats               | "3 left"        | Red               |
| 4 seats – 40% capacity | "8 seats left"  | Neutral           |
| >40% capacity          | "29 seats left" | Green             |
| 0                      | "Sold out"      | Red + standby CTA |

Single vocabulary — "left" everywhere. Drop "avail."

**Vessel legend:** Calendar dots get a key mapping color to boat, in the right-panel header.

---

### Screen 2 — Trip Detail / Ticket Selector

**Mobile:** Bottom sheet. **Desktop:** persistent right panel. Both show:

- Vessel name (with colored dot), trip display name
- Departure–return range with duration appended (`7:00 PM – 12:00 AM · 5 hr`)
- Available seat count
- **Weather / refund policy summary** — _new; one line plus a link. This is the largest hesitation for a weather-dependent purchase and currently lives two screens away._
- **What's included** — rods, bait, license status. Driven by add-on config (§4).

TICKETS section: types with –/+ steppers, price, age range, live subtotal. **Adult defaults to 1.** "Add to cart" CTA.

> **Verify:** "Add to cart" renders pale/disabled in `03-qty-selected.png` with a valid 2-ticket, $130 selection. Confirm this is a pressed state and not a real disabled state.

**Inventory hold on add-to-cart** _(restored from v2, now conditional)_:

- Adding tickets decrements live seat inventory, not just cart-local state, and starts a hold.
- **Duration: 10 minutes.**
- **Engaged only when remaining inventory is below 4 seats or 15% of capacity**, whichever is greater. A boat with 29 of 40 seats open has no double-booking problem, and an unconditional hold adds a countdown, a background job, and customer anxiety to solve a problem that isn't occurring.
- **Countdown is hidden until under 2:00 remaining**, or on return to an aging cart. A timer on arrival reads as pressure.
- **Any payment attempt in progress extends the hold** by 5 minutes. A hold expiring mid-3DS or mid-Cash-App-handoff is the ugliest possible support ticket.
- Expiry runs via background job; the job is idempotent against walk-up POS writes.
- **On expiry, the cart is not silently emptied.** Line items persist, marked "seat released — tap to check availability," and re-add if still available.

---

### Screens 3–4 — Cart Feedback

Trip row shows an "X in cart" badge alongside remaining availability. Mobile: pinned bottom bar. Desktop: cart summary in right panel. Multi-trip cart supported — customers add departures from multiple trips into one checkout.

**CTA label is "Checkout →" everywhere.** The current build says "Reserve →" here and "Checkout →" on the cart page; two labels for one motion.

> **Fix:** the pinned mobile bar overlaps list content in `04-cart-bar.png` — "$130 / 2 tickets" strikes through the Friday trip card.

---

### Screens 5–7 — Checkout (single page)

**Restructured.** The current build is three surfaces: cart page → contact sheet → Stripe page. A customer ready to pay with a wallet in one tap must hand-type three fields and load a second full page first. Two sequential data-entry screens on mobile is where abandonment concentrates.

v3 is one scrollable page, in this order:

1. **Order summary** — per-trip cards with category, trip name, vessel, date, time range, ticket type, price each, editable quantity, line total, Remove. ORDER TOTAL with ticket count. Hold countdown if active and under 2:00.
2. **Express payment** — wallets and Link, above the form. Email is harvested from the payment payload; for these customers the contact fields never render.
3. **Contact** — Email (required). Mobile (optional, for text updates). **Full Name optional and collapsed** behind "Add a name" — the card or wallet supplies a name, and the manifest needs one name per booking, which you'll have. _Repo doc marked this Required; that is a regression and is reverted here._
   - `autocomplete="email"` / `"tel"`, `type=email`, `inputmode=numeric`.
4. **Payment element** — card fields, country/ZIP.
5. **Terms notice, immediately above the pay CTA** (see §5).
6. **Pay CTA.**
7. "← Continue shopping" below.

**Payment methods:** Card, Stripe Link, Cash App Pay, wallets. **Bank transfer and Affirm are suppressed** — see §5.

> **Note:** the "$5 back" ACH badge visible on the mobile checkout capture is Stripe-rendered, not ours. It's removed by disabling the method in the Payment Element, not by a UI change.

**Guest checkout is the default and only required path.** Account creation is offered post-purchase and is never a gate.

---

### Screen 8 — Booking Confirmation / Delivery

**"You're booked!"** with delivery options:

| Option        | Behavior                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| Print tickets | Opens `/boarding/[token]` — print or save as PDF                          |
| Email tickets | Sent automatically at payment, **with the PDF attached**; shown confirmed |
| Text updates  | Auto-sends an SMS link at booking (see §5)                                |

**New — "Who's coming?" passenger capture.** Ticket 1 pre-fills with the purchaser; a solo angler does nothing. Remaining tickets get name fields; child tickets get an age field. Skippable, editable later from the booking link, and re-prompted by the 24h reminder email. See §4.

**New — "Save this booking"** offers magic-link account creation. No password, ever. The email is already verified by the receipt.

Primary CTA: "View booking details." Secondary: "Back to calendar" (desktop).

---

### Screen 9 — Boarding Passes

One pass per ticket, stacked, print-optimized (`@media print`). Tab title shows confirmation number and ticket count. "Print / Save PDF" top-right.

Each pass:

- Header band: operator name, vessel name, QR (top-right)
- Ticket type, trip name, date, departure, return
- **Passenger name** if captured; purchased-by; confirmation code
- **Dock location with map link, and arrival time** ("be at the boat by 6:30") — _new; these two omissions generate the most support calls_
- **Operator phone, weather policy, cancel link** — _new_
- Boarding notice
- Ticket ID (monospace, bottom-left), "Ticket X of N" (bottom-right)

**QR:** HMAC-signed value, not a bare UUID. Unforgeable; the mate app verifies the signature offline against a cached manifest.

**URL token:** `/boarding/[token]` uses a high-entropy random token, **not** the booking ID or confirmation code. The confirmation code (`080602`) reads as date-plus-sequence; if it or a sequential ID appears in the path, the page — which exposes purchaser name, trip, and passes — is enumerable. The signed QR protects tickets, not the page. Rate limiting mitigates but does not fix this.

**Wallet passes:** Apple/Google Wallet in addition to PDF. Captree has spotty coverage, and an SMS _link_ assumes the customer can load a page at the gangway. The mate has an offline fallback; the customer needs one too.

---

## 3. Operator / Captain Surfaces

_Walk-up POS and admin get their own flow spec. Requirements that constrain the customer flow are recorded here._

**Walk-on counter — not a dock checkout.** Cash walk-ups are handled the way they always have been: cash, offline, no ticket, no QR, no name. Mates will not create tickets at the gangway and should not be asked to.

What the system needs is **headcount**, not revenue. If the captain takes 6 cash walk-ons while the site still shows 8 seats open, the site can sell past the vessel's certificate. That is the failure that matters.

The control is a single large +/− in the mate app. One tap per person boarding without an online ticket. It decrements available inventory and increments manifest headcount. Nothing else.

- Only load-bearing in the window where both channels are live. Once the captain hits **close sales**, online can't sell and the collision disappears — so in practice the counter matters most in the last stretch before departure, which is exactly when the dock is busiest. Keep it to one tap.
- Optional for inventory purposes. **Becomes mandatory before departure if the COI requires exact headcount** — see §7 question 2.
- Cash reconciliation (dollars per trip) is a separate admin field, not the mate's job. Out of scope for v1 unless an operator asks.
- The hold-expiry job must be idempotent against counter writes.

Full walk-up admin flow gets its own spec.

**Live manifest.** If the mate pulls a manifest at 6:45 and someone buys at 6:52, the app picks it up.

**Captain close/reopen sales.** A "close sales" control in the mate app is the authoritative signal, ahead of the scheduled cutoff. Captains can reopen if holding the boat.

**Capacity expansion.** Captains can raise a listed capacity when a trip sells out — 29 to 39 or beyond.

- The vessel's certificate maximum is a **hard cap, server-enforced, admin-only**, never editable in the field.
- The app shows both numbers: "29 listed, 45 certified."
- **Adding seats fires the standby queue.** This is the most common way seats open — more so than cancellations — and it's where standby earns its keep.
- Capacity cannot be set below seats already sold.
- All capacity changes are logged with actor and timestamp. When a manifest and a certificate disagree during an inspection, that history resolves it.

**One-tap cancellation** fires passenger notifications immediately (§5).

**Check-in never blocks.** A valid signed QR scans through regardless of whether a passenger name is attached. An optional name field exists for dock walk-ups, but is never required — a mate blocked by a required field with fifteen people behind him will stop using the app.

---

## 4. Constraints

| Area                     | Constraint                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment processor        | Stripe. No raw card data touches the server.                                                                                                                                                                                                                                                                                                                      |
| Payment methods          | Card, Stripe Link, Cash App Pay, Apple/Google Pay. Bank transfer and Affirm disabled (§5).                                                                                                                                                                                                                                                                        |
| Responsive               | Mobile: bottom sheets, list-only calendar. Desktop: persistent right panel, List/Calendar toggle.                                                                                                                                                                                                                                                                 |
| Ticket types             | Adult (13+), Child (5–12) shown; **configurable per product** — supports an under-5 tier.                                                                                                                                                                                                                                                                         |
| Fee display              | Operator-configurable: absorb the platform fee (flat price) or pass through as a checkout line item.                                                                                                                                                                                                                                                              |
| Inventory states         | Per the badge table in §2.                                                                                                                                                                                                                                                                                                                                        |
| Multi-vessel             | Multiple boats, color-coded, with a legend.                                                                                                                                                                                                                                                                                                                       |
| Multi-trip cart          | Supported.                                                                                                                                                                                                                                                                                                                                                        |
| Walk-up                  | Cash, offline, no ticket generated. Mate taps a walk-on counter that decrements inventory and increments headcount. Own flow spec.                                                                                                                                                                                                                                |
| Checkout modes           | Guest by default. Post-purchase magic-link accounts. Never a gate.                                                                                                                                                                                                                                                                                                |
| Terms                    | Passive notice, no checkbox, positioned above the pay CTA. Version + timestamp recorded on the order.                                                                                                                                                                                                                                                             |
| Booking cutoff           | **Departure time**, or captain close — whichever comes first. Configurable per operator.                                                                                                                                                                                                                                                                          |
| Last-15-minute purchases | Interstitial: "This trip departs in 4 minutes — are you at the dock?" Card and wallets only.                                                                                                                                                                                                                                                                      |
| Self-cancellation        | Allowed within a configurable window. **Full refund. Seat returns to inventory automatically and fires the standby queue.** Outside the window, operator-only, with no time limit on operator-initiated refunds.                                                                                                                                                  |
| Inventory hold           | 10 min, conditional on low inventory. Background expiry.                                                                                                                                                                                                                                                                                                          |
| Passenger names          | Captured post-purchase. Optional. Never blocks check-in.                                                                                                                                                                                                                                                                                                          |
| Add-ons                  | Three-state per trip: **included** / **available at $X** / **not offered**. Generic object — covers rods, fillet service, licenses, gratuity. Set at trip-template level with per-departure override. "Included" is distinct from "not offered" and surfaces on Screen 2: a first-timer who doesn't know whether to bring gear is a first-timer who doesn't book. |
| Capacity                 | Captain-expandable under a server-enforced certificate ceiling.                                                                                                                                                                                                                                                                                                   |
| QR                       | HMAC-signed, verifiable offline.                                                                                                                                                                                                                                                                                                                                  |
| Security                 | Stripe-native payments; high-entropy boarding URLs; rate-limited sensitive endpoints; no PII beyond what's necessary.                                                                                                                                                                                                                                             |

---

## 5. Resolved Decisions

### 5.1 Terms acceptance — passive, but relocated and split

Keep the no-checkbox approach. Two things are currently conflated:

- **Refund / cancellation / weather policy.** Passive notice is the right friction call. But current placement — below the Checkout button and below "Continue shopping" — is the weakest possible one. Conspicuous notice _immediately adjacent to the action_ is what makes clickwrap hold up; placement matters more than a checkbox. Record terms version and timestamp on the order — that's the artifact that helps in a chargeback dispute.
- **Liability waiver, if one exists.** Assumption-of-risk waivers for a vessel trip are held to a materially higher standard of assent, and passive notice is a poor fit. If the operator's terms include one, pull it into an affirmative step at check-in in the mate app, where it costs zero conversion.

_Not legal advice. Counsel should confirm the split — see §7._

### 5.2 Standby — first-in-line, departure-scaled window

Notify-all is worse than it looks: a customer who taps a text and hits "sold out" has a worse experience than never being notified, and it generates support contacts. First-in-line also mirrors the hold mechanism, so it's less new machinery than it appears.

| Time to departure | Claim window              |
| ----------------- | ------------------------- |
| >24 h             | 30 min                    |
| Same day, >2 h    | 10 min                    |
| <2 h              | Notify all, first to book |

- **Card captured at signup** (SetupIntent, no charge) so claiming is one tap, not a checkout under a countdown.
- **Queue position shown** ("you're #3") — sets expectations, cuts "did it work?" contacts.
- **Channel opt-in at signup** — email and/or SMS.
- **Day-scoped, not trip-scoped.** Demand is last-minute and weather-correlated; someone who wanted the 7 AM fluke trip will usually take the 7 PM bass trip. Let people join standby for a date or a species.
- Auto-advance on expiry; cap the walk-through before falling back to open notification.
- **Triggers:** seat freed by cancellation, hold expiry, _or captain capacity expansion._

### 5.3 Inventory hold — 10 minutes, conditional

Duration is the least important part. See Screen 2 for the full behavior. The three things that matter: conditional engagement, hidden countdown, and extension on payment attempt.

### 5.4 Booking cutoff — departure time, captain-overridable

Sail time is a schedule; the boat leaves when the captain says it leaves. Trips run late; trips leave early when everyone's aboard. A hard 1-hour cutoff is wrong in both directions. Online sales close at departure or captain-close, whichever is first, with reopen available.

### 5.5 Passenger names — post-purchase

The mate app is the wrong place for primary capture; a line waiting to board is the worst possible input moment. The confirmation screen is the only place in this flow where asking for more data is free — the purchase is complete, so anything skipped costs nothing in conversion.

### 5.6 Payment methods — suppress async

ACH refunds are slow; BNPL refunds slower. On a weather-dependent product, enabling them builds a refund-latency support problem into checkout. **Offer trip credit as a one-tap alternative to refund** in the cancellation notification — better for operator cash flow, and most customers prefer rebooking.

### 5.7 Accounts — deferred, magic-link at confirmation

Full account infrastructure before the checkout restructure risks adding a login prompt to a flow being shortened. Magic-link-at-confirmation captures most of the repeat-customer benefit. Recognized email plus a saved Stripe payment method gets to one-tap rebooking without a password system.

Repeat-customer levers, in order of expected impact: "book this trip again" deep link in the post-trip email; captain-triggered "seats open next Wednesday" SMS to past customers; then accounts. Accounts are plumbing; the trigger is the product.

---

## 6. Notifications

_Implementation state as of 2026-08-17: **Push (Expo)** is live. **Email (Resend)** is live for booking confirmation. **SMS (Twilio)** is planned but not yet wired — the TODO is in the webhook handler. SMS cells below reflect the intended channel once Twilio is connected._

| Event                  | Email            | Push       | SMS (planned)  | Notes                                                                                     |
| ---------------------- | ---------------- | ---------- | -------------- | ----------------------------------------------------------------------------------------- |
| Booking confirmed      | ✓ (PDF attached) | ✓          | link to pass   | Email + push sent via `payment_intent.succeeded` webhook                                  |
| 24 h reminder          | —                | ✓          | ✓              | Cron window `[+23h, +24h)`. Includes passenger-name prompt if incomplete. Email planned.  |
| Operator cancellation  | —                | ✓          | ✓              | Push fires on one-tap cancel. One-tap refund-or-credit choice planned for SMS.            |
| Booking expired        | —                | ✓          | —              | Cron fires when a pending booking times out without payment.                              |
| Payment abandoned      | —                | ✓          | —              | `payment_intent.canceled` webhook fires notification.                                     |
| Refund initiated       | —                | —          | —              | Planned.                                                                                  |
| Refund processed       | —                | —          | —              | Planned; on Stripe settlement.                                                            |
| **Trip changed**       | —                | —          | —              | _Planned._ Species/vessel swap; accept-or-refund action.                                  |
| Standby seat available | per opt-in       | per opt-in | per opt-in     | Claim window per §5.2.                                                                    |
| Hold expiring          | —                | —          | —              | In-page only.                                                                             |

---

## 7. Open Questions

Everything above is decided. These five need outside input. Each has a working default so nothing is blocked.

| #   | Question                                                                             | Working default                                                  | What would change it                                                                                                                                                                  | Owner         |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Do the operator's terms include a liability waiver?                                  | Assume yes; design the check-in affirmative step                 | If no waiver, §5.1 collapses to the passive notice alone                                                                                                                              | Counsel       |
| 2   | What does the vessel's COI require for passenger records — names, or headcount only? | Names optional, captured post-purchase; walk-on counter optional | If names are mandatory per-passenger, optional capture is not viable and moves into checkout. If exact headcount is mandatory, the walk-on counter becomes required before departure. | Captain       |
| 3   | Actual weather-cancellation rate?                                                    | Assume material; suppress ACH/BNPL, build trip credit            | If <5% of departures, ACH suppression is over-correction and trip credit may not be worth building                                                                                    | Operator data |
| 4   | Child at $65, same as Adult — intentional? Under-5 tier?                             | Leave as-is; ticket types are per-product configurable           | Identical pricing across two visible tiers makes customers stop and wonder what they're missing                                                                                       | Operator      |
| 5   | Are add-ons in v1 scope?                                                             | Build the config object; ship with everything "not offered"      | Ancillaries are where party-boat margin lives — matters for operator adoption                                                                                                         | Operator      |

**Also unverified (engineering, not decisions):**

- Boarding-pass URL enumerability — audit before launch
- Ticket-count mismatch in the captures: delivery screen shows 2 tickets / $130 / Aug 5 bass; pass page shows 3 tickets / Aug 6 fluke under confirmation 080602. Probably fixtures, but it touches pass generation against line items. A family one pass short at 6:45 AM is unrecoverable.
- "Add to cart" disabled-state rendering
- Apple/Google Pay — needs an Apple developer account and device testing

---

## 8. What "Success" Means

- **Operator:** Captains manage trips, cancellations, capacity, manifests, and pricing with minimal friction, especially at the dock under time pressure. One-tap cancellation firing passenger notifications immediately is the target.
- **Customer:** Booking is fast, clear, and trustworthy. Target path is list → sheet → pay. The boarding pass works at the gangway without cell signal; the email and Wallet pass are reliable fallbacks.
- **Conversion:** High completion from calendar view to paid booking. Accounts reduce clicks for repeat customers without adding friction for new ones.
- **Architecture:** Appropriately scoped, not over-engineered. Scales to the load of a fishing fleet.
- **Design:** Polished and visually consistent — professional to customers, credible to operators.
- **Security:** Stripe-native payments, signed tickets (planned — QR currently encodes a bare UUID; HMAC signing required before launch), unguessable boarding URLs, rate-limited sensitive endpoints, no PII leakage.

---

## 9. Instrumentation

Wire before shipping the checkout restructure, or the result won't be attributable:

- Step-level drop-off, list view → paid
- Express-payment share of completions
- Hold expiries per completed checkout
- Standby claim rate
- Passenger-name completion rate (at confirmation vs. after the 24h reminder)

The middle two will show fairly quickly whether holds are calibrated right.
