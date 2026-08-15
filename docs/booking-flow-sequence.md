# Booking Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Customer
    participant UI as Web UI
    participant API as API Routes
    participant DB as Postgres
    participant S as Stripe
    participant N as Notifications

    C->>UI: Browse calendar, select trip
    UI->>API: GET /api/trips
    API->>DB: SELECT trips WHERE date
    DB-->>API: trip rows + seatsRemaining
    API-->>UI: available trips + prices
    UI-->>C: Calendar with availability

    C->>UI: Add tickets to cart
    C->>UI: Enter email + phone, submit

    UI->>API: POST /api/bookings
    Note over API: Validate ticket types + quantities

    API->>DB: BEGIN TRANSACTION
    API->>DB: SELECT trips FOR UPDATE
    DB-->>API: trip rows (locked)
    Note over DB: Concurrent bookings wait here

    API->>DB: SELECT productPrices, schedulePrices, vessels
    DB-->>API: pricing + group discount config
    Note over API: Calculate total + apply group discount
    Note over API: platformFee = $1.50 x ticketCount

    API->>DB: UPDATE trips SET seatsRemaining -= N
    API->>DB: INSERT booking (status=pending, holdExpiresAt)
    API->>DB: INSERT bookingItems
    API->>DB: INSERT tickets (feeStatus=held, qrPayload=uuid)
    API->>DB: COMMIT

    API->>S: Create PaymentIntent (Destination Charge)
    S-->>API: client_secret
    API->>DB: UPDATE booking SET stripePaymentIntentId
    API-->>UI: clientSecret + bookingId + holdExpiresAt

    UI->>C: Render Stripe Payment Element
    C->>S: Enter card, confirm payment
    S-->>C: Redirect to /booking/delivery

    rect rgb(235, 245, 255)
        Note over C,N: Payment confirmation - async webhook
        S->>API: POST /api/webhooks/stripe (payment_intent.succeeded)
        API->>S: constructEvent - verify signature
        API->>S: Retrieve charge for applicationFeeId + transferId

        API->>DB: BEGIN TRANSACTION
        API->>DB: SELECT booking FOR UPDATE
        DB-->>API: booking (idempotency guard - skip if already confirmed)
        API->>DB: UPDATE booking SET status=confirmed
        API->>DB: INSERT payment record
        API->>DB: COMMIT

        API--)N: sendBookingConfirmation email (waitUntil)
        API--)N: sendPushToEmails (waitUntil)
        API--)N: PostHog payment_success event (waitUntil)
        N--)C: Confirmation email + push notification
        API-->>S: 200 OK
    end

    rect rgb(255, 243, 243)
        Note over C,N: Abandonment and error paths
        Note over API: Stripe PI creation fails - restore seats + cancel booking

        S->>API: payment_intent.canceled webhook
        API->>DB: BEGIN TRANSACTION
        API->>DB: SELECT booking FOR UPDATE
        API->>DB: UPDATE trips SET seatsRemaining += N
        API->>DB: UPDATE booking SET status=cancelled
        API->>DB: COMMIT

        Note over API: Cron expire-pending-bookings runs every 10 min
        Note over API: Uses same seat-restore logic
    end
```

## Key invariants

| Invariant | Where enforced |
|---|---|
| Seats never double-sold | `SELECT … FOR UPDATE` inside the booking transaction |
| Duplicate webhook delivery is safe | `FOR UPDATE` re-check before confirming; skips if already `confirmed` |
| Ghost holds don't accumulate | Seats restored on PI creation failure and on `payment_intent.canceled` |
| Platform fee captured atomically | `application_fee_amount` set at PI creation, not separately |
| Background tasks don't block Stripe ACK | `waitUntil` keeps function alive after `200 OK` returns |
