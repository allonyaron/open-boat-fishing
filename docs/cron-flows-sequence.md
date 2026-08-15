# Cron Job Flows — Sequence Diagram

```mermaid
sequenceDiagram
    participant V as Vercel Scheduler
    participant API as API Routes
    participant DB as Postgres
    participant S as Stripe
    participant N as Notifications

    Note over V,N: EXPIRE PENDING BOOKINGS - runs every 10 minutes
    V->>API: GET /api/cron/expire-pending-bookings
    Note over API: Bearer CRON_SECRET header required - returns 401 if missing
    API->>DB: SELECT stale pending bookings with no payment row
    Note over DB: holdExpiresAt passed OR older than 30 min if no holdExpiresAt set
    DB-->>API: list of stale bookings

    loop each stale booking
        alt has stripePaymentIntentId
            API->>S: paymentIntents.retrieve
            S-->>API: PI status
            API->>S: paymentIntents.cancel if not already cancelled or succeeded
            Note over API,S: Prevents a late payment going through after seats are restored
        end
        API->>DB: BEGIN TRANSACTION
        API->>DB: SELECT booking FOR UPDATE
        DB-->>API: fresh booking status
        Note over API: Skips if status no longer pending - webhook may have processed it
        API->>DB: SELECT bookingItems + count tickets per item
        API->>DB: UPDATE trips SET seatsRemaining += ticketCount per trip
        API->>DB: UPDATE booking SET status=cancelled
        API->>DB: COMMIT
    end

    API-->>V: ok + count cancelled

    Note over V,N: TRIP REMINDERS - runs every hour
    V->>API: GET /api/cron/trip-reminders
    Note over API: Bearer CRON_SECRET header required - returns 401 if missing
    API->>DB: SELECT scheduled trips departing in 23-25 hour window
    DB-->>API: upcoming trips with vessel + product names

    loop each upcoming trip
        API->>DB: SELECT bookingItems for trip
        API->>DB: SELECT confirmed booking emails
        DB-->>API: passenger email list
        API->>N: sendPushToEmails - Trip Reminder with vessel + departure time
        N-->>N: deliver to passenger devices
    end

    API-->>V: ok + tripsProcessed + pushSent count
```

## Key invariants

| Invariant | Where enforced |
|---|---|
| Cron endpoints require auth | `Bearer CRON_SECRET` header checked before any DB work |
| PI cancelled before seats restored | Stripe cancel runs outside transaction to prevent late payments |
| No double seat-restore | `SELECT FOR UPDATE` re-checks status — skips if webhook already handled it |
| Reminder window is exactly 23-25h | Hourly cron + 2h window = every trip gets exactly one reminder |
| Reminders only go to confirmed bookings | `WHERE status = confirmed` filters out pending and cancelled |
