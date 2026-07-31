# System Flows

## Booking Lifecycle — Happy Path

```mermaid
sequenceDiagram
    participant C as Customer (Browser)
    participant W as Web (Next.js)
    participant DB as Postgres
    participant S as Stripe

    C->>W: Browse /  (BookingCalendar)
    W->>DB: GET /api/trips?month=YYYY-MM
    DB-->>W: trips + vessel + pricing
    W-->>C: Calendar rendered

    C->>C: Add tickets to cart (localStorage)
    C->>W: Navigate to /cart
    C->>W: Fill name/email/phone (ContactOverlay)
    C->>W: POST /api/bookings {cart, customerName, …}

    W->>DB: BEGIN TRANSACTION
    W->>DB: SELECT trips FOR UPDATE (locks rows)
    W->>DB: Check seatsRemaining >= requested
    W->>DB: Decrement seatsRemaining
    W->>DB: INSERT booking (status=pending)
    W->>DB: INSERT booking_items + tickets (feeStatus=held)
    W->>DB: COMMIT
    W->>S: paymentIntents.create (amount, application_fee_amount)
    S-->>W: clientSecret
    W->>DB: UPDATE booking SET stripe_payment_intent_id
    W-->>C: {clientSecret, bookingId, confirmationCode}

    C->>W: Navigate to /checkout
    C->>S: stripe.confirmPayment() (PaymentElement)
    S-->>C: Redirect to /booking/delivery?redirect_status=succeeded

    S->>W: POST /api/webhooks/stripe  (payment_intent.succeeded)
    W->>DB: UPDATE booking SET status=confirmed
    W->>DB: INSERT payments record
    Note over W: TODO: send email via Resend
    Note over W: TODO: send SMS via Twilio
    W-->>S: 200 OK

    C->>W: /booking/delivery  (print / email / SMS options)
    C->>W: /boarding/[bookingId]  (printable boarding passes)
```

---

## Booking Lifecycle — Payment Cancelled / Abandoned

```mermaid
sequenceDiagram
    participant C as Customer (Browser)
    participant W as Web (Next.js)
    participant DB as Postgres
    participant S as Stripe

    Note over C,S: Seats decremented, booking=pending, PI created

    alt Stripe PI creation fails
        W->>DB: BEGIN TRANSACTION
        W->>DB: Restore seatsRemaining
        W->>DB: UPDATE booking SET status=cancelled
        W->>DB: COMMIT
        W-->>C: 502 Payment service unavailable
    else Customer abandons checkout / Stripe cancels PI
        S->>W: POST /api/webhooks/stripe  (payment_intent.canceled)
        W->>DB: SELECT booking_items for this booking
        W->>DB: BEGIN TRANSACTION
        W->>DB: Restore seatsRemaining (per ticket count)
        W->>DB: UPDATE booking SET status=cancelled
        W->>DB: COMMIT
        W-->>S: 200 OK
    end
```

---

## Fee Lifecycle

```mermaid
stateDiagram-v2
    [*] --> held : Booking confirmed\n(payment_intent.succeeded)

    held --> earned : Trip sailed +\nsettle_grace_hrs elapsed\n(lazy check on read)
    held --> reversed : Captain cancels trip\nor customer self-cancels\n(within cancel_window_hrs)

    earned --> reversed : Captain cancels AFTER\ngrace window (exception path —\nlog + manual refund)

    note right of held
        applicationFees collected by Stripe
        but NOT yet revenue
    end note

    note right of earned
        Counted in revenue reports
        (WHERE fee_status = 'earned')
    end note

    note right of reversed
        applicationFees.createRefund() called
        alongside customer refund
    end note
```

---

## Trip Status Lifecycle

```mermaid
stateDiagram-v2
    [*] --> scheduled : Admin materializes\nschedule → trips

    scheduled --> pending_settlement : Departure time passes\n(lazy transition on read)
    scheduled --> cancelled : Captain cancels\nbefore departure

    pending_settlement --> sailed : settle_grace_hrs elapsed\nno cancellation received
    pending_settlement --> cancelled : Captain cancels late\n(most common path —\nweather known after the fact)

    sailed --> cancelled : True unwind\n(exception — log it)

    note right of cancelled
        All tickets refunded
        All fees reversed
        Notifications fired
    end note

    note right of sailed
        fee_status → earned
        for all tickets
    end note
```

---

## Webhook Event Coverage

| Event | Handler | Action |
|---|---|---|
| `payment_intent.succeeded` | ✅ | Confirm booking, record payment |
| `payment_intent.canceled` | ✅ | Restore seats, cancel booking |
| `payment_intent.payment_failed` | ❌ not handled | Customer can retry — no action needed |
| `application_fee.refunded` | ❌ not handled | Future: update fee_status → reversed |
| `charge.refunded` | ❌ not handled | Future: trigger for cancellation flow |
