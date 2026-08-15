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
    Note over API: Returns 409 if trip already cancelled
    API->>PG: SELECT bookingItems WHERE tripId
    PG-->>API: all items on this trip
    API->>PG: SELECT bookings + all their bookingItems
    PG-->>API: affected bookings + full item lists
    Note over API: Full refund if all booking items are on this trip
    Note over API: Partial refund if booking spans other trips

    loop each confirmed booking
        API->>S: refunds.create (payment_intent, reverse_transfer, refund_application_fee)
        S-->>API: refund object
    end
    Note over API,S: If any Stripe refund fails - abort and return 502, no DB writes

    API->>PG: BEGIN TRANSACTION
    API->>PG: UPDATE trips SET status=cancelled + cancelledAt + reason
    API->>PG: UPDATE tickets SET voided=true + feeStatus=reversed
    API->>PG: UPDATE bookings SET status=cancelled (fully-refunded only)
    API->>PG: UPDATE trips SET seatsRemaining=capacity
    API->>PG: COMMIT

    API-->>N: sendPushToEmails - Trip Cancelled (best-effort)
    N-->>A: push delivered to affected passengers
    API-->>A: ok + bookingsCancelled + ticketsVoided

    Note over A,N: PER-TICKET REFUND - admin refunds one ticket
    A->>API: POST /api/admin/tickets/ticketId/refund
    API->>API: requireAdmin - verify session cookie
    API->>PG: SELECT ticket + bookingItem + booking + payment
    PG-->>API: joined row
    Note over API: Returns 409 if ticket already voided or booking not confirmed

    API->>S: refunds.create (payment_intent, amount=priceCents, reverse_transfer)
    S-->>API: refund object
    API->>S: applicationFees.createRefund if applicationFeeId known
    S-->>API: fee refund object
    Note over API,S: If Stripe refund fails - return 502, no DB writes

    API->>PG: BEGIN TRANSACTION
    API->>PG: UPDATE tickets SET voided=true + feeStatus=reversed
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
