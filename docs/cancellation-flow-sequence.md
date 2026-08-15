# Cancellation Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant A as Admin
    participant API as API Routes
    participant PG as Postgres
    participant S as Stripe
    participant N as Notifications

    Note over A,N: TRIP CANCELLATION - admin cancels entire trip
    A->>API: POST /api/admin/trips/tripId/cancel
    API->>API: requireAdmin - verify session cookie
    API->>PG: SELECT trip WHERE id + operatorId
    PG-->>API: trip row
    alt already cancelled
        API-->>A: 409 Trip is already cancelled
    end

    API->>PG: SELECT bookingItems WHERE tripId
    PG-->>API: all items on this trip
    API->>PG: SELECT bookings + all their bookingItems
    PG-->>API: affected bookings + full item lists

    Note over API: Calculate refund plan per booking
    Note over API: full refund if all items are on this trip
    Note over API: partial refund if booking spans other trips

    loop each confirmed booking
        API->>S: refunds.create (payment_intent, reverse_transfer, refund_application_fee)
        Note over API,S: partial refund includes amount param
        Note over API,S: full refund omits amount - Stripe refunds all
        S-->>API: refund object
        alt Stripe refund failed
            API-->>A: 502 - cancellation aborted, check Stripe dashboard
        end
    end

    Note over API,PG: All Stripe refunds succeeded - commit DB changes
    API->>PG: BEGIN TRANSACTION
    API->>PG: UPDATE trips SET status=cancelled, cancelledAt, cancellationReason
    API->>PG: UPDATE tickets SET voided=true, feeStatus=reversed
    API->>PG: UPDATE bookings SET status=cancelled (fully-refunded bookings only)
    API->>PG: UPDATE trips SET seatsRemaining=capacity (reset)
    API->>PG: COMMIT

    API->>N: sendPushToEmails - Trip Cancelled (best-effort, non-blocking)
    N-->>A: push delivered to affected passengers
    API-->>A: ok + bookingsCancelled + ticketsVoided count

    Note over A,N: PER-TICKET REFUND - admin refunds one ticket
    A->>API: POST /api/admin/tickets/ticketId/refund
    API->>API: requireAdmin - verify session cookie
    API->>PG: SELECT ticket + bookingItem + booking + payment
    PG-->>API: joined row
    alt ticket already voided
        API-->>A: 409 Ticket already refunded
    end
    alt booking not confirmed
        API-->>A: 409 Booking is not in a refundable state
    end

    API->>S: refunds.create (payment_intent, amount=priceCents, reverse_transfer)
    S-->>API: refund object
    alt applicationFeeId known
        API->>S: applicationFees.createRefund (amount=feeAmountCents)
        S-->>API: fee refund object
    end
    alt Stripe refund failed
        API-->>A: 502 Stripe refund failed
    end

    API->>PG: BEGIN TRANSACTION
    API->>PG: UPDATE tickets SET voided=true, feeStatus=reversed
    API->>PG: UPDATE trips SET seatsRemaining += 1
    API->>PG: COMMIT
    API-->>A: ok + ticketId + refundedCents
```

## Key invariants

| Invariant | Where enforced |
|---|---|
| Stripe refunds always run before DB changes | All `stripe.refunds.create` calls complete before the transaction opens |
| Cancellation aborts if any refund fails | 502 returned immediately; no DB writes made |
| Fee always reversed with the refund | `refund_application_fee: true` or explicit `applicationFees.createRefund` |
| Seats restored on per-ticket refund | `seatsRemaining += 1` inside the same transaction |
| Seats reset to full capacity on trip cancel | `seatsRemaining = capacity` — trip is dead, no new bookings possible |
| Multi-trip bookings get partial refund only | Refund scoped to `subtotalCents` of items on the cancelled trip |
| Push notifications are non-blocking | Fire-and-forget after the response is ready |
