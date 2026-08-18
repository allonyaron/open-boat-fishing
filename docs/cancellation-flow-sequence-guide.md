# Cancellation Flow — How to Read the Sequence Diagram

Read this alongside `cancellation-flow-sequence.md`.

---

## The Participants (columns)

```
A        →  Admin          (staff member in the admin dashboard browser)
API      →  API Routes     (Next.js serverless functions on the server)
PG       →  Postgres       (the database — note: PG, not DB)
S        →  Stripe         (external payment processor)
N        →  Notifications  (push notification service — Expo)
```

**Note on naming:** This diagram uses `PG` for the database instead of `DB`. The label is different but the role is identical — it's the same Postgres database used everywhere else. The abbreviation change is cosmetic.

There is no Customer or UI column here. The cancellation flow is triggered entirely by admin actions in the dashboard; customers are only involved at the end when they receive notifications.

This diagram covers two separate but related flows:
1. **Trip Cancellation** — an admin cancels an entire trip (all bookings refunded)
2. **Per-Ticket Refund** — an admin refunds a single ticket from one booking

---

## Arrow Types

**Solid `->>` ** — active request or command.

**Dotted `-->>`** — reply or response.

**`loop` block** — a repeating sequence. Every step inside runs once per iteration of the loop condition written at the top of the block.

**Self-arrow `A->>A`** — internal computation. Here: `API->>API: requireAdmin` is the session verification step that runs at the start of every admin endpoint.

---

## Section 1 — Trip Cancellation

This is the heavier of the two flows. When a trip is cancelled, every confirmed booking on that trip must be refunded, every ticket voided, and seats restored.

**Why does Stripe run before the database?**
The most important design decision in this diagram is the sequence: all Stripe refunds happen before the database transaction opens. If even one Stripe call fails, the function aborts with `502` and zero database changes have been made. This means the database is always consistent with what Stripe has actually processed.

**Step by step:**

1. **`A->>API: POST /api/admin/trips/tripId/cancel`** — Admin clicks "Cancel Trip" in the dashboard.

2. **`API->>API: requireAdmin — verify session cookie`** — Self-arrow. The API decrypts the admin's cookie and confirms they have the `admin` role. Every admin endpoint starts this way.

3. **`API->>PG: SELECT trip WHERE id + operatorId`** — Fetches the trip, scoped to this operator. The `operatorId` comes from the verified session, not the URL.

4. **`PG-->>API: trip row`** — Postgres returns the record. *(dotted — reply)*
   - The Note says: returns `409 Conflict` if the trip is already cancelled. No duplicate cancellations.

5. **`API->>PG: SELECT bookingItems WHERE tripId`** — Gets every booking item attached to this trip — one row per ticket type per booking.

6. **`PG-->>API: all items on this trip`** — Postgres returns the list. *(dotted — reply)*

7. **`API->>PG: SELECT bookings + all their bookingItems`** — Expands each booking to see all its items, not just the ones on this trip. This step is needed to determine whether a booking is entirely on this trip or spans other trips.

8. **`PG-->>API: affected bookings + full item lists`** — Postgres returns the expanded data. *(dotted — reply)*
   - Two Notes explain the refund logic:
     - **Full refund** if all of a booking's items are on this trip — the entire booking amount is returned.
     - **Partial refund** if the booking also covers other trips — only the cancelled trip's portion is refunded, and the booking itself stays `confirmed` for the other trips.

**The Stripe Loop**

```
loop each confirmed booking
    API->>S: refunds.create(...)
    S-->>API: refund object
end
```

The `loop` block repeats the inner sequence once per confirmed booking. Every refund call:
- Targets the booking's `payment_intent` (not a charge ID)
- Sets `reverse_transfer: true` — this reverses the portion of funds already transferred to the operator
- Sets `refund_application_fee: true` — this reverses the platform's $1.50 fee as well

`S-->>API: refund object` — Stripe confirms each refund. *(dotted — reply)*

The Note after the loop says: **if any single Stripe refund fails, the function aborts immediately with `502` and makes no database changes.** The loop does not continue past a failure. This is the "Stripe before DB" invariant — it's safe to re-run the cancellation if it failed partway through because no DB state has been written yet.

**The Database Transaction (runs only after all Stripe calls succeed)**

9. **`API->>PG: BEGIN TRANSACTION`** — Opens a single atomic transaction.

10. **`API->>PG: UPDATE trips SET status=cancelled + cancelledAt + reason`** — Marks the trip as cancelled with a timestamp and reason.

11. **`API->>PG: UPDATE tickets SET voided=true + feeStatus=reversed`** — Voids every ticket on the trip. `voided=true` means the mate app's QR scanner will reject these tickets at the dock. `feeStatus=reversed` marks the platform fee as reversed for revenue accounting.

12. **`API->>PG: UPDATE bookings SET status=cancelled (fully-refunded only)`** — Only bookings where the entire amount was refunded get marked `cancelled`. Bookings that spanned multiple trips remain `confirmed` for their other trips.

13. **`API->>PG: UPDATE trips SET seatsRemaining=capacity`** — Resets seats to full capacity. Since the trip is dead, no new bookings can be made anyway, but this keeps the inventory data clean.

14. **`API->>PG: COMMIT`** — Everything above lands atomically.

**Notifications**

15. **`API-->>N: sendPushToEmails — Trip Cancelled (best-effort)`** — *(dotted — fire-and-forget)* Push notifications are sent to all affected passengers. This is fire-and-forget: if push delivery fails, the cancellation and refund are not rolled back.

16. **`N-->>A: push delivered to affected passengers`** — The passengers receive the notification. *(dotted — async delivery)*

17. **`API-->>A: ok + bookingsCancelled + ticketsVoided`** — The admin sees the result summary in the dashboard. *(dotted — final reply)*

---

## Section 2 — Per-Ticket Refund

A lighter operation. One passenger's one ticket is refunded and voided — the rest of their booking is untouched.

A typical use case: a family of four books, but one person can't make it. The operator refunds just that one ticket.

1. **`A->>API: POST /api/admin/tickets/ticketId/refund`** — Admin clicks "Refund" on a specific ticket row.

2. **`API->>API: requireAdmin`** — Self-arrow. Session verification.

3. **`API->>PG: SELECT ticket + bookingItem + booking + payment`** — A single joined query that retrieves the ticket, its parent booking item, the booking itself, and the payment record (which holds the Stripe PaymentIntent ID and application fee ID).

4. **`PG-->>API: joined row`** — Postgres returns everything needed in one shot. *(dotted — reply)*
   - The Note says: returns `409` if the ticket is already voided (can't refund twice) or the booking is not `confirmed` (can only refund paid bookings).

**Stripe Calls**

5. **`API->>S: refunds.create(payment_intent, amount=priceCents, reverse_transfer)`** — A partial refund for exactly this ticket's price. `amount=priceCents` means Stripe does not refund the full payment — only the amount corresponding to this one ticket.

6. **`S-->>API: refund object`** — Stripe confirms the refund. *(dotted — reply)*

7. **`API->>S: applicationFees.createRefund if applicationFeeId known`** — Separately refunds the $1.50 platform fee for this ticket. This is a separate Stripe API call because platform fees are tracked independently from the payment.

8. **`S-->>API: fee refund object`** — Stripe confirms the fee refund. *(dotted — reply)*
   - The Note says: if Stripe fails, return `502` and make no DB changes. Same pattern as trip cancellation — Stripe before DB.

**The Database Transaction**

9. **`API->>PG: BEGIN TRANSACTION`**

10. **`API->>PG: UPDATE tickets SET voided=true + feeStatus=reversed`** — This specific ticket is voided. Other tickets on the same booking are unaffected.

11. **`API->>PG: UPDATE trips SET seatsRemaining += 1`** — One seat is freed up. The trip stays scheduled and this seat can be sold to someone else.

12. **`API->>PG: COMMIT`**

13. **`API-->>A: ok + ticketId + refundedCents`** — Admin sees the confirmation with the refund amount. *(dotted — final reply)*

---

## Key things to notice

**Stripe always runs before the database opens a transaction.**
Both sections follow the same pattern: make all Stripe calls, abort if any fail, only then open the DB transaction. This means the database is always consistent with what Stripe has actually processed.

**The `loop` block in the trip cancellation section.**
`loop each confirmed booking` means the Stripe refund call repeats for each booking. If a trip has 12 confirmed bookings, Stripe is called 12 times before the DB transaction opens. All 12 must succeed or nothing is committed.

**Trip cancellation resets seats to capacity; per-ticket refund increments by one.**
These are two different operations for two different reasons. A cancelled trip is dead — there's no reason to track exact seat counts any more, so `capacity` is the cleanest reset. A per-ticket refund leaves the trip alive, so only one seat is freed.

**Push notifications are always fire-and-forget (dotted).**
Notifications fire after the database commits and the response is ready. If push delivery fails, the cancellation still happened — the notifications are best-effort.
