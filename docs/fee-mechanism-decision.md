# Fee mechanism — decision doc

**Status:** ✅ **RESOLVED — Option A + C's bookkeeping.** Payment code is unblocked. See "DECIDED" below.
**Decides:** how the $1.50 gets from a passenger's card into our account, given we only earn it if the boat sails.

*Options A, B, and C are retained below as the record of why. The decision is A + C.*

---

## The problem in one paragraph

`CLAUDE.md` currently specifies Stripe Connect destination charges with `application_fee_amount: 250` — $2.50 taken at charge time. Two things have changed since that was written. The fee is now **$1.50** (matching GoFish, confirmed via `gettripConvFee` in the Miss Montauk HAR). And the policy is now **we only keep the fee if the trip sails** — weather cancellations and early customer cancellations refund it. `application_fee_amount` is collected the moment the card is charged, which can be weeks before the boat leaves the dock. So the current plan collects a fee we haven't earned yet, on every booking, and then has to give it back on every cancellation.

This is a real architectural fork, not a config change.

---

## Two layers, kept separate

Conflating these is the main source of confusion. They're independent.

- **Presentation** — what the customer sees at checkout, and who bears the cost. Operator-configurable (`fee_bearer`, `fee_display`). Specified in the audit, section 7. Not this document.
- **Settlement** — how the $1.50 physically reaches us, and when. Platform-wide, not per-operator. **This document.**

A folded, operator-absorbed fee and an itemized, passenger-paid fee can settle identically. Presentation changes the number in the charge; settlement changes where that number goes.

---

## Option A — `application_fee_amount` + reversals

Keep destination charges. Take $1.50 at charge time. On cancellation, call `Stripe.applicationFees.createRefund()` alongside the customer refund.

**Flow:**
```
Booking  → PaymentIntent(amount: total, application_fee_amount: 150 × tickets,
                         transfer_data.destination: operator_acct)
         → $1.50/ticket lands in platform balance immediately
Cancel   → refund customer  +  applicationFees.createRefund()
Sail     → nothing to do; fee already collected
```

**For:**
- Least code. Stripe does the split.
- Money arrives immediately; no invoicing system, no collections risk.
- Reconciliation is Stripe-native — the fee shows on every charge.

**Against:**
- **We collect a fee we haven't earned on 100% of bookings.** Every cancellation is a reversal. Given a weather-dependent business in the Northeast, this is not an edge case; it's a weekly occurrence.
- Reversals are extra API calls that can fail independently of the customer refund, producing drift between what we hold and what we're owed.
- Partial-cancellation cases get fiddly: a booking spans multiple trips (multi-trip cart), one trip cancels, we must reverse exactly that trip's tickets' fees, not the whole booking's.
- If the fee is **folded** into the price, `application_fee_amount` is a hidden deduction from a number the customer thinks is the ticket price — awkward if it ever surfaces in a dispute.

---

## Option B — full charge to operator + monthly invoicing on sailed tickets

Drop `application_fee_amount`. The entire charge goes to the operator. We track sailed tickets in our own database and bill the operator monthly.

**Flow:**
```
Booking  → PaymentIntent(amount: total, transfer_data.destination: operator_acct)
         → operator receives everything; we take nothing
Sail     → trip marked sailed → tickets marked sailed → billable
Cancel   → refund customer; nothing billable (we never held the fee)
Month-end→ SUM(sailed tickets) × $1.50 → invoice operator
```

**For:**
- **Matches the promise exactly.** We never hold money we haven't earned. "You only pay for trips that sail" is literally true, not true-after-a-reversal.
- No reversal logic anywhere. Cancellation is just a refund.
- Fee-display combinations don't touch settlement at all — folded, itemized, absorbed, all settle the same.
- Mirrors GoFish, so an operator switching from them sees a familiar bill.
- Clean story for disputes: the charge is entirely the operator's.

**Against:**
- **Requires building a billing system.** Invoice generation, delivery, payment collection, dunning. This is real work and it's work that produces no customer-facing value.
- **Collections risk.** The operator has already received the money. We're now a creditor. A captain having a bad season can simply not pay.
- Requires a reliable "did this trip sail?" signal — see below.
- Monthly cash flow instead of per-transaction.

---

## Option C — hybrid: hold, then settle

Take `application_fee_amount` at charge time but treat it as **held, not earned**. Recognize revenue on sail; auto-reverse on cancellation via the same webhook that processes the refund.

This is Option A with better bookkeeping, not a third mechanism. Worth naming because it's what Option A *should* look like if chosen: the difference is an internal `fee_status` (`held` → `earned` | `reversed`) so our own reporting never counts unearned fees as revenue.

---

## DECIDED: Option A + C's bookkeeping

**Status: resolved. Payment code is unblocked.**

Take `application_fee_amount: 150` at charge time via destination charges. Reverse on every cancellation. Track `fee_status` internally so our own books never count unearned fees as revenue.

### What this means concretely

From Option A — the money mechanism:
- `application_fee_amount: 150` on every PaymentIntent, via `transfer_data.destination`
- Cancellation handler calls `applicationFees.createRefund()` alongside the customer refund, in the same transaction
- Partial cancellations (multi-trip cart, one trip dies) reverse only that trip's tickets' fees

From C — the bookkeeping layer:
- `tickets.fee_status` tracks `held` → `earned` | `reversed`
- Written `held` at charge time; flipped to `earned` when the trip is marked sailed; `reversed` on cancellation
- Reporting counts revenue only `WHERE fee_status = 'earned'`

C is not a separate mechanism. Money moves identically with or without it — Stripe does the same thing either way. C is two columns and a discipline about what we call revenue. Without it, a July Stripe balance containing $1.50 for every ticket sold through September reads as revenue, when much of it belongs to trips that haven't sailed and some of which will cancel. `fee_status` is also the audit trail: Stripe's balance and our earned-revenue number will disagree constantly *by design*, and this column is what explains the gap.

### Why, honestly

Option B is the more correct model — it matches the promise exactly, has no reversal logic, and mirrors GoFish. The always-reverse cancellation policy makes B's case stronger than it was when this doc was drafted: there is now no cancellation path that avoids a reversal under A, so A is "collect on every ticket, hand back on every cancellation," not "occasional exception handling."

A won anyway, on one consideration: **B makes us a creditor to a seasonal fishing business.** The operator holds all the money and we invoice monthly. With one client we know personally, fine. With ten, that's a collections function we didn't plan to build, in a business where a bad August is a normal event. A's reversal churn is a *code* problem. B's collections risk is a *business* problem. We're better equipped for the first.

### What would flip this

If "pay nothing up front, billed like a utility" ever becomes the sales pitch, B is the only path. That's a posture question, not an engineering one. **Revisit at operator #3**, once we know whether it wins deals.

---

## The "did it sail?" signal — and why it needs a settlement lag

This is the load-bearing dependency for `fee_status`, and it doesn't exist yet.

`trips` needs a terminal status — `sailed` | `cancelled` — set per departure. Who sets it:

1. **The mate app.** Mate closes out check-in, trip marks sailed. Most accurate; requires the mate app (build order step 8).
2. **The admin dashboard.** Captain marks trips sailed/cancelled. Manual.
3. **Time-based default.** Departure passes, trip wasn't cancelled ⇒ assume sailed.
4. **Hybrid.** Time-based default, overridable by admin or mate app.

**Decided: (4), with a settlement lag. Migrate to (1) once the mate app ships.**

### The lag exists because the captain records cancellations late

**Assume he won't record weather cancellations promptly.** Trips will be cancelled *after* their departure time has passed, and refunds will go out then. This is the expected case, not an edge case.

That breaks a naive time-based rule. If `departure passed + not cancelled ⇒ sailed` fires the moment the clock rolls over, a trip cancelled three hours later has already flipped `fee_status` to `earned` and been counted as revenue. The late cancellation then has to *unwind* a recognition that should never have happened.

So the transition isn't at departure — it's at **departure + grace period**:

```
scheduled ──(departure passes)──▶ pending_settlement
                                         │
                    ┌────────────────────┴────────────────────┐
         (grace expires, no cancellation)          (captain cancels late)
                    ▼                                         ▼
                 sailed                                   cancelled
           fee_status → earned                      fee_status → reversed
                                                     + refund customers
```

**Grace period: 48 hours past departure, tunable.** Size it to how late the captain actually is — 24h if he's reliably next-morning, 72h if it's whenever he gets to it. During the window the trip sits in `pending_settlement`, fees stay `held`, and a late cancellation is an ordinary reversal rather than an unwind.

The aging can be a cron job or a lazy check on read (any query touching a `pending_settlement` trip past its grace window resolves it). Lazy is simpler and there's no cron in the stack yet.

### Two consequences worth naming

**Revenue recognition is delayed by the grace period.** Fees earn 48h after the boat sails, not at departure. That's the cost of correctness and it's cheap.

**Customers get refunded after they've already been stood up.** Someone drives to Captree, the boat isn't going, they drive home, and the refund lands whenever the captain gets around to recording it. That's a customer-experience failure the schema cannot fix. What can: make "cancel this trip" a one-tap action *at the dock* in both the mate app and the admin dashboard, and fire a push the instant it's recorded. The friction of recording a cancellation is exactly why it happens late — remove the friction rather than modeling around it.

### Cancellation is one transaction

Cancelling must atomically: refund every ticket, reverse every fee, set `status = 'cancelled'` and `cancelled_at`, and fire notifications. This holds whether the cancellation arrives before departure, during the grace window, or after `sailed` was already set — that last case is a true unwind and should be logged as an exception, not treated as a normal path.

---

## Schema implications

```
trips
  + status            enum('scheduled','pending_settlement','sailed','cancelled')
                                   not null default 'scheduled'
  + sailed_at         timestamptz  null
  + cancelled_at      timestamptz  null
  + cancellation_reason text       null    -- 'weather' | 'mechanical' | 'low_bookings' | free text

tickets
  + fee_amount_cents  int          not null default 150   -- snapshot; don't read from config at bill time
  + fee_status        enum('held','earned','reversed')  not null default 'held'

operators
  + fee_bearer        enum('passenger','operator')  not null default 'passenger'
  + fee_display       enum('itemized','folded')     not null default 'itemized'
  + cancel_window_hrs int          not null default 48   -- customer self-cancel cutoff
  + settle_grace_hrs  int          not null default 48   -- departure → earned, absorbs late cancellations
```

`fee_amount_cents` on the ticket rather than a global constant: if the fee ever changes, historical bookings must bill at the rate in force when they were sold. Snapshot it at write time.

---

## Cancellation matrix

**Policy decided:** customers may self-cancel up to **48 hours** before departure. Inside 48 hours the self-service path is closed — but the captain can refund manually at any time, for any reason. These are two different powers, not one rule with an exception: the 48h cutoff governs the *customer's button*; the captain's refund has no time limit at all.

**Fee rule decided: always reverse on cancellation.** Automatic, captain-discretionary, or weather — if the passenger doesn't sail, we don't earn. No asterisk on "you only pay for people who actually sail."

| Scenario | Customer refund | Fee | Operator |
|---|---|---|---|
| Weather cancellation, before departure | Full | Reversed | Keeps nothing |
| **Weather cancellation, recorded late** (within grace window) | Full | Reversed | Keeps nothing |
| Customer self-cancels, >48h out | Full | Reversed | Keeps nothing |
| Customer requests <48h, captain declines | None | **Earned** | Keeps ticket revenue |
| Captain refunds at discretion, <48h | Per his call | Reversed | Per his call |
| No-show | None | **Earned** | Keeps ticket revenue |
| Trip sails | — | Earned (after grace) | Keeps ticket revenue |

The late-weather row is the expected case, not an exception — see the settlement lag section. Because fees stay `held` through the grace window, a late cancellation reverses normally; nothing has to be unwound.

Two notes. **No-show earns the fee** — the passenger didn't cancel, they just didn't show. The rule is "reverse on *cancellation*," not "reverse on empty seat." And the accepted tradeoff on always-reverse: a captain who refunds generously inside 48 hours costs us $1.50 each time, with nothing in the system discouraging it. At one operator's volume that's noise; revisit only if it becomes a pattern across many.

**Folded pricing exception:** if `fee_display = 'folded'`, always refund the full displayed amount. Never claw a hidden fee out of a price the customer believes is just the ticket.

---

## Open questions

1. ~~A or B?~~ — **decided: A + C's bookkeeping.** See the DECIDED section above.
2. ~~Free cancellation window~~ — **decided: 48h customer self-cancel cutoff; captain refund unlimited.**
3. ~~Does the operator's refund policy differ from ours?~~ — **decided: no. Always reverse the fee on any cancellation.** The operator's ticket-refund choice inside 48h is his own; our fee reverses regardless.
4. ~~Who marks a trip sailed at launch?~~ — **decided: time-based default with a 48h settlement grace window** (`operators.settle_grace_hrs`), because the captain is assumed *not* to record weather cancellations promptly. Migrate to mate-app close-out when that ships.
5. **Fee on a $760 trip?** Flat $1.50 is 1.9% of a Helen H tuna trip and 3.2% of a Captree sea bass ticket. Fine for one operator; revisit if the segment widens.
6. **Manifest headcount under collapsed ticket types.** If Coast Guard or insurance requires children broken out even when priced identically, the collapse rule (audit §6) is wrong. Unverified — captain question.

---

## What this unblocks

Resolved. `/api/bookings`, `/api/webhooks/stripe`, the cart total, and the cancellation handler can all now be written against Option A + C.

The one remaining dependency is the **sail signal** (`trips.status`) — `fee_status` can't flip to `earned` without it. For MVP that's the time-based default described above (departure passed + not cancelled ⇒ sailed), overridable by admin. That's a small piece of work but it's a prerequisite for revenue recognition, not for taking payments — the charge path works without it.
