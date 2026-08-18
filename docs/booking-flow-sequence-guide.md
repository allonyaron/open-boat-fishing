# Booking Flow — How to Read the Sequence Diagram

Read this alongside `booking-flow-sequence.md`.

---

## What is a sequence diagram?

A sequence diagram shows **who talks to whom, in what order, and what kind of message is sent**. Time flows top-to-bottom. The participants are the columns, and each arrow is one message between them.

---

## The Participants (columns)

```
C        →  Customer       (the person in the browser)
UI       →  Web UI         (Next.js frontend, running in the browser)
API      →  API Routes     (Next.js serverless functions on the server)
DB       →  Postgres       (the database)
S        →  Stripe         (external payment processor)
N        →  Notifications  (email / push / analytics — Resend, Expo, PostHog)
```

Each one has a vertical **lifeline** running down the page. Every arrow crosses from one lifeline to another.

---

## The Two Arrow Types

**Solid line `->>`** — an **active request** or **command**. The sender is doing something and expecting the receiver to act on it. It's a call going forward.

> Example: `UI->>API: POST /api/bookings` — the browser is sending a request to the server.

**Dotted line `-->>`** — a **response** or **reply**. The receiver from a prior solid-line call is sending data back. It signals "here's the result of what you asked for."

> Example: `DB-->>API: trip rows + seatsRemaining` — the database is handing results back to the API that queried it.

**The rule of thumb:** solid = initiating action, dotted = returning a result.

---

## Section 1 — Calendar Load

This is the read-only page load before any purchase intent.

1. **`C->>UI`** — Customer opens the calendar page in the browser.
2. **`UI->>API`** — The UI fires `GET /api/trips` to fetch what trips exist.
3. **`API->>DB`** — The API queries Postgres: `SELECT trips WHERE date`.
4. **`DB-->>API`** — Postgres returns trip rows including how many seats remain. *(dotted — a reply)*
5. **`API-->>UI`** — The API sends available trips and prices back to the UI. *(dotted — a reply)*
6. **`UI-->>C`** — The browser renders the calendar with availability highlighted. *(dotted — a reply)*

No money, no locks, no side effects — pure data fetch.

---

## Section 2 — Cart + Booking Creation

This is when the customer commits to buying and the system locks seats.

**Steps 1–2** — The customer fills the cart and enters their contact details. These are pure browser interactions, no server calls yet.

**Step 3** — `UI->>API: POST /api/bookings` — The UI sends the full cart (which trips, which ticket types, quantities) plus email/name/phone to the server. This is the moment the server gets involved.

**Steps 4–5 (Notes)** — Before touching the database, the API runs two guards:
- A rate limit check — 20 booking attempts per 15 minutes per IP. If exceeded, it returns HTTP 429 immediately.
- A Zod schema validation — checks email format, cart size (1–10 trips), ticket quantities (1–30 per type). Rejects bad data before touching the DB.

**The Atomic Transaction**

This is the critical section. Everything from `BEGIN TRANSACTION` to `COMMIT` is one atomic database operation.

- `API->>DB: SELECT trips FOR UPDATE` — The API locks the trip rows in Postgres. The Note "Concurrent bookings wait here" is key: if two people are buying at the same moment, the second one is blocked at this step until the first finishes. This is what prevents overselling.
- `DB-->>API: trip rows (locked)` — Postgres returns the rows, now locked. *(dotted — reply)*
- The API fetches pricing and calculates the total including group discounts and the platform fee ($1.50 × ticket count).
- `UPDATE trips SET seatsRemaining -= N` — Seats are decremented.
- `INSERT booking (status=pending)` — A pending booking is created with a `holdExpiresAt` timestamp (the hold window).
- `INSERT bookingItems` and `INSERT tickets` — Line items and individual tickets are written.
- `COMMIT` — All of the above lands atomically. Either all of it succeeds or none of it does.

**Stripe PaymentIntent**

After the DB commit, the API calls Stripe to create a PaymentIntent.

- `API->>S: Create PaymentIntent` — This is a Destination Charge, meaning the platform fee is baked in at creation.
- `S-->>API: client_secret` — Stripe returns a secret the browser needs to show the payment form. *(dotted — reply)*
- The Note says: if Stripe fails here, the API reverses — restores seats and cancels the booking. This handles the gap between "seats locked in DB" and "payment not yet initiated."
- `API->>DB: UPDATE booking SET stripePaymentIntentId` — The PI id is written back so the webhook can look up the booking later.
- `API-->>UI: clientSecret + bookingId + holdExpiresAt` — Everything the browser needs is returned. *(dotted — reply)*

---

## Section 3 — Customer Pays

- `UI->>C: Render Stripe Payment Element` — The UI renders Stripe's hosted card form (loaded directly from Stripe's servers into the page).
- `C->>S: Enter card, confirm payment` — The customer submits their card **directly to Stripe** — the card number never touches the app's servers.
- `S-->>C: Redirect to /booking/delivery` — Stripe redirects the browser to the delivery page to show next steps. *(dotted — reply)*

Note that at this point the browser thinks it's done, but the booking is **not yet confirmed**. Confirmation happens asynchronously in the next section.

---

## Section 4 — Payment Confirmation Webhook

**This runs entirely server-to-server, asynchronously.** The customer is already on the delivery page while this is happening.

The `Note over C,N: PAYMENT CONFIRMATION - async webhook` banner marks the start of an async flow — it spans from C to N across all participants, signalling this is a cross-cutting event.

1. `S->>API` — Stripe POSTs `payment_intent.succeeded` to the webhook endpoint. *(solid — Stripe is initiating)*
2. `API->>S` — The API calls Stripe back to verify the webhook signature and retrieve charge metadata (fee ID, transfer ID).
3. `API->>DB: BEGIN TRANSACTION` + `SELECT booking FOR UPDATE` — Another locked read. The Note says this is an idempotency guard: if Stripe delivers the webhook twice, the second delivery sees `status=confirmed` and skips, so the booking is never double-confirmed.
4. `UPDATE booking SET status=confirmed` + `INSERT payment record` + `COMMIT` — Booking is confirmed atomically.
5. Three `API-->>N` dotted lines — The API fires off email, push notification, and PostHog analytics **without waiting for them**. The `waitUntil` pattern means the serverless function stays alive long enough for these to complete, but Stripe already got its `200 OK` before they finish. This is why the arrows are dotted — they're fire-and-forget replies, not blocking calls.
6. `N-->>C` — The customer receives the confirmation email and push. *(dotted — async delivery)*

---

## Section 5 — Abandonment / Cancellation Webhook

Triggered when the payment window expires or the customer leaves without paying. Stripe fires `payment_intent.canceled`.

1. `S->>API` — Stripe sends the cancellation webhook.
2. The API opens a transaction, locks the booking (`FOR UPDATE`), and checks current status — if it's already cancelled (e.g. a previous cron run got there first), it skips entirely.
3. `UPDATE trips SET seatsRemaining += ticketCount` — Seats are **restored**, so the next customer can book them.
4. `UPDATE booking SET status=cancelled` — Booking is marked cancelled.
5. `API-->>N` — A push notification is sent to the customer: "Booking Cancelled — payment wasn't completed."
6. The Note at the bottom says: the cron job `expire-pending-bookings` runs every 10 minutes and does **the same logic** — so whether Stripe fires the webhook or the cron runs first, the result is identical. Both are idempotent.

---

## Section 6 — External Full Refund Webhook

Triggered when someone issues a full refund from the Stripe dashboard (e.g. an operator refunding a trip).

1. `S->>API` — `charge.refunded` webhook arrives.
2. The Note says partial refunds are ignored — only `amount_refunded == amount` triggers the cancellation logic.
3. The API looks up the booking via the payment's `stripePaymentIntentId`.
4. Inside a transaction: seats are restored, **all tickets are voided** (`voided=true`) and their fees reversed (`feeStatus=reversed`), and the booking is marked cancelled.

Voiding tickets blocks boarding even if the customer still has the QR code on their phone.

---

## Section 7 — Dispute Webhook

Triggered when a customer files a chargeback with their bank.

1. `S->>API` — `charge.dispute.created` arrives.
2. The API finds the booking via the payment record.
3. `UPDATE tickets SET voided=true` — Tickets are voided to **block boarding**, but the booking itself stays `confirmed` (because the dispute outcome is unknown — the operator might win).
4. The Note says this is logged for manual review. No seat restoration happens yet because the money may or may not be returned.

---

## Summary: Solid vs. Dotted at a Glance

| Line type | Meaning | Examples |
|-----------|---------|---------|
| `->>` solid | Active call / command / event | Browser → server, server → DB, Stripe → API webhook |
| `-->>` dotted | Reply / response / async callback | DB → API query result, API → browser response, fire-and-forget notifications |

One useful mental model: **follow the solid lines to understand what triggers what; follow the dotted lines to understand what data flows back.**
