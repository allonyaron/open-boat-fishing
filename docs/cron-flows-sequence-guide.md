# Cron Job Flows — How to Read the Sequence Diagram

Read this alongside `cron-flows-sequence.md`.

---

## The Participants (columns)

```
V        →  Vercel Scheduler   (Vercel's built-in cron trigger — fires HTTP requests on a schedule)
API      →  API Routes         (Next.js serverless functions on the server)
DB       →  Postgres           (the database)
S        →  Stripe             (external payment processor)
N        →  Notifications      (push notification service — Expo)
```

There is no Customer or UI column. Cron jobs are fully automated — no human triggers them. The customer only appears indirectly when they receive a notification at the end of a loop.

**What is a cron job in this context?**
Vercel has a built-in scheduler that calls an HTTP endpoint on your app at a configured interval. The `V` column represents Vercel's infrastructure making that HTTP call. From the API's perspective, it looks like any other incoming HTTP request — except the caller is Vercel, not a browser.

This diagram covers two cron jobs:
1. **Expire Pending Bookings** — runs every 10 minutes. Cancels bookings whose payment window has elapsed.
2. **Trip Reminders** — runs every hour. Sends push notifications to passengers whose trip departs within 23–24 hours.

---

## Arrow Types

**Solid `->>` ** — active request or command.

**Dotted `-->>`** — reply or response.

**`loop` block** — a repeating sequence. Runs once per item matching the condition at the top.

**`alt` block** — a conditional branch (if/else). Exactly one branch runs.

**`Note over X`** — a box of explanatory text anchored to one or more columns. Notes add context that doesn't fit into an arrow label.

---

## Section 1 — Expire Pending Bookings (every 10 minutes)

When a customer starts checkout, their seats are locked and a `holdExpiresAt` timestamp is set. If they don't pay within that window, the booking stays `pending` forever and the seats are never freed. This cron job finds and cleans up those stale bookings.

**Authentication first**

1. **`V->>API: GET /api/cron/expire-pending-bookings (Authorization: Bearer CRON_SECRET)`** — Vercel fires the HTTP request on schedule. The request includes a `CRON_SECRET` in the `Authorization` header.
   - The Note says: returns `401` if the header is missing or the secret is wrong. No processing happens. This guard prevents anyone from triggering the cron endpoint manually via a browser or curl.

**Finding stale bookings**

2. **`API->>DB: SELECT bookings LEFT JOIN payments WHERE status=pending AND payments.bookingId IS NULL AND (holdExpiresAt < NOW() OR createdAt < NOW()-30min)`** — This query identifies bookings that have expired without payment. The conditions together mean:
   - `status=pending` — still in the unpaid state
   - `payments.bookingId IS NULL` — no payment row exists (a payment row is only created when Stripe confirms payment via webhook; its absence means the customer never paid)
   - `holdExpiresAt < NOW() OR createdAt < NOW()-30min` — the hold window has passed, or the booking is at least 30 minutes old as a safety fallback

3. **`DB-->>API: list of stale bookings`** — Postgres returns the expired bookings. *(dotted — reply)*

**The main loop**

```
loop each stale booking
    ...
end
```

Everything inside this block runs once per stale booking found above.

**Stripe check (inside loop, inside `alt`)**

```
alt has stripePaymentIntentId
    API->>S: paymentIntents.retrieve(id)
    S-->>API: PI status
    Note: SKIP ENTIRELY if PI is succeeded or processing
    API->>S: paymentIntents.cancel(id) if status not already "canceled"
end
```

4. The `alt` block asks: does this stale booking have a Stripe PaymentIntent attached?
   - **If yes** — the API retrieves the PI status from Stripe before doing anything.
     - The Note explains the most important guard in this entire cron job: if Stripe reports the PI as `succeeded` or `processing`, **skip this booking entirely**. This covers the race condition where a customer pays at the exact moment the cron fires — the Stripe webhook confirming the payment may be in-flight but not yet processed. Cancelling a booking whose payment is `succeeded` or `processing` would void paid tickets and restore seats on a trip the customer actually paid for. Skipping means the webhook wins and the cron leaves it alone.
     - If the PI status is anything other than `succeeded` or `processing`, the API cancels it in Stripe (`paymentIntents.cancel`). This releases Stripe's hold on any authorized funds.
   - **If no** — no `else` branch; the `alt` simply closes and execution continues to the database transaction.

**Database transaction (inside loop)**

5. **`API->>DB: BEGIN TRANSACTION`**

6. **`API->>DB: SELECT booking FOR UPDATE (re-check status inside lock)`** — Even though the query in step 2 found this booking as `pending`, the status is re-read inside a lock. The Note says: **skip if status != pending**. This handles the case where the Stripe webhook arrived and confirmed the booking between when the cron's initial SELECT ran and when the transaction opened. Without this check, the cron could cancel a booking that was just confirmed.

7. **`DB-->>API: fresh booking status`** — Postgres returns the current status under lock. *(dotted — reply)*

8. **`API->>DB: SELECT bookingItems WHERE bookingId + count(*) tickets per item`** — Counts how many tickets are tied to each trip in this booking, so seats can be restored correctly per trip.

9. **`API->>DB: UPDATE trips SET seatsRemaining += ticketCount per trip (relative increment)`** — Seats are restored trip-by-trip using the ticket counts from the previous step. Note the phrasing: **relative increment** (`+=`), not an absolute reset. This matters because other concurrent bookings may have changed `seatsRemaining` since this booking was created.

10. **`API->>DB: UPDATE booking SET status=cancelled, updatedAt=NOW()`**

11. **`API->>DB: COMMIT`**

**Notification (inside loop)**

12. **`API-->>N: sendPushToEmails "Booking Expired — payment wasn't completed" (fire-and-forget)`** — *(dotted)* Push sent to the customer. Fire-and-forget: if delivery fails, the cancellation is not rolled back.

13. **`N-->>N: deliver to customer device`** — *(dotted — self-arrow on N)* The notification service delivers to the device. This is shown as a self-arrow on `N` because the delivery is internal to the notifications system — the cron job doesn't wait for confirmation.

**Cleanup after the loop**

14. **`API->>DB: DELETE rate_limits WHERE windowStart < NOW() - INTERVAL '1 day'`** — After processing all stale bookings, the cron cleans up old rate limit rows. The `rate_limits` table accumulates rows as requests come in; rows older than one day are expired and can be deleted safely. This keeps the table from growing unbounded.

15. **`API-->>V: { ok, cancelled: N }`** — The cron returns a summary response to Vercel. *(dotted — reply)* `N` is the count of bookings cancelled in this run. Vercel logs this response.

---

## Section 2 — Trip Reminders (every hour)

This cron sends a "trip tomorrow" push notification to every confirmed passenger whose trip departs in the next 23–24 hours.

**Authentication**

1. **`V->>API: GET /api/cron/trip-reminders (Authorization: Bearer CRON_SECRET)`** — Same auth pattern as the expire cron.
   - The Note says: returns `401` if the secret is wrong.

**Finding upcoming trips**

2. **`API->>DB: SELECT trips WHERE status=scheduled AND startTime >= NOW()+23h AND startTime < NOW()+24h`** — The query finds trips departing between 23 and 24 hours from now.
   - The Note explains the half-open interval `[+23h, +24h)`:
     - The lower bound is inclusive: `>= NOW()+23h`
     - The upper bound is exclusive: `< NOW()+24h`
     - Because the cron fires every hour, each run covers exactly one hour of the 24-hour window. No two runs overlap. A trip departing at exactly `NOW()+23.5h` is caught by this run and not by the next. This design is called "tiling" — the hourly runs tile together to cover the 23–24h window exactly once with no gaps and no double-sends.

3. **`DB-->>API: upcoming trips with vessel + product names`** — Postgres returns the trips. *(dotted — reply)*

**The trip loop**

```
loop each upcoming trip
    API->>DB: SELECT bookingItems WHERE tripId
    API->>DB: SELECT customerEmail FROM bookings WHERE id IN (bookingIds) AND status=confirmed
    DB-->>API: confirmed passenger email list
    API->>N: sendPushToEmails "Trip Reminder..." (all channels)
    N-->>N: deliver to passenger devices
end
```

For each upcoming trip:

4. **`API->>DB: SELECT bookingItems WHERE tripId`** — Gets all bookings attached to this trip.

5. **`API->>DB: SELECT customerEmail FROM bookings WHERE id IN (bookingIds) AND status=confirmed`** — Gets the email addresses of only the confirmed bookings. Pending and cancelled bookings are excluded — only passengers who have actually paid receive a reminder.

6. **`DB-->>API: confirmed passenger email list`** — Postgres returns the email list. *(dotted — reply)*

7. **`API->>N: sendPushToEmails "Trip Reminder — departs tomorrow at <time>" (all channels)`** — Push notification sent to all confirmed passengers on this trip.

8. **`N-->>N: deliver to passenger devices`** — *(dotted — self-arrow on N)* Delivery is internal to the notifications system.

**After the loop**

9. **`API-->>V: { ok, tripsProcessed: N, pushSent: N }`** — Summary response to Vercel. *(dotted — reply)*

---

## Key things to notice

**The `CRON_SECRET` guard is the first thing that runs.**
Both cron endpoints check the authorization header before touching the database or Stripe. Without this, anyone who discovers the cron URL could trigger seat restores or send push notifications to all customers at will.

**Stripe is checked before the database is written.**
In the expire cron, the PI status is retrieved from Stripe before the database transaction opens. This is the same pattern as the cancellation and booking flows — Stripe calls happen before DB writes, so the DB is never ahead of what Stripe has actually processed.

**The double `pending` check protects against webhook races.**
Step 2 finds `pending` bookings. Step 6 re-reads the status inside a locked transaction. Both checks are needed. The outer query can run fine, but by the time the inner transaction runs, the Stripe webhook may have arrived and confirmed the booking. The inner `FOR UPDATE` + status check catches this.

**The half-open reminder window `[+23h, +24h)` is a precise engineering decision.**
Without the exclusive upper bound, a trip exactly 24 hours away would be caught by both the current run and the next run, sending a duplicate reminder. The exclusive `<` on the upper bound means each trip falls into exactly one hourly window. The Note in the diagram calls this "tiling."

**`N-->>N` self-arrows mean fire-and-forget.**
When you see a dotted self-arrow on the Notifications column, it means the API handed the work to the notification service and moved on. The cron does not wait to confirm delivery. If push delivery fails, the cron still returns `200` to Vercel and the seats/bookings are unaffected.

**Rate limit cleanup happens at the end of the expire cron, not separately.**
The `DELETE rate_limits` query is a maintenance operation piggybacked onto the expire cron. It runs after all the seat-restoring work is done, so a failure in cleanup doesn't roll back any cancellations.
