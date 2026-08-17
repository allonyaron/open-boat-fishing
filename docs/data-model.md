# Data Model

## Core Hierarchy

```
operators → vessels → products → product_prices → schedules → trips → bookings → tickets
                                                                               └── check_ins
```

- `schedules` = recurring patterns (date range, days of week, time, capacity)
- `trips` = materialized individual departures — must store both `start_time` AND `end_time` (fishing trips span 4-5 hours; e.g. 7:01 PM → 11:45 PM, 8:00 PM → 1:00 AM next day)
- `products` = trip type per vessel; has a category (e.g. "Sea Bass") AND a display name (e.g. "Sea Bass Fishing Express") — store both
- `product_prices` = per-ticket-type pricing within a product (Adult, Child, Senior each get their own price row; child price can differ from adult per product)
- `bookings` = one per customer purchase, can span multiple trips (multi-trip cart); `tickets` = one per passenger
- Multi-domain per operator: domain → operator_id mapping in platform config

---

## Schema Fields — All Implemented

All fields surfaced by competitor API analysis (`/docs/captree-booking-ux-audit.md` §6) and the fee decision are in the schema:

```
trips                                                       ✅ in schema
  status              enum('scheduled','pending_settlement','sailed','cancelled') not null default 'scheduled'
  sailed_at           timestamptz null
  cancelled_at        timestamptz null
  cancellation_reason text null          -- 'weather' | 'mechanical' | 'low_bookings' | free text
  boarding_time       time null          -- distinct from departure (06:30 board / 07:00 depart)
  duration_day        int not null default 0   -- multi-day trips: duration on the trip,
  duration_hr         int                      -- NOT a spanning calendar entity
  duration_min        int
  online_cutoff       timestamptz null   -- online booking closes
  deposit_percentage  int null           -- null = pay in full

tickets                                                     ✅ in schema
  fee_amount_cents    int not null default 150  -- SNAPSHOT at write time, never read from config at bill time
  fee_status          enum('held','earned','reversed') not null default 'held'

operators                                                   ✅ in schema
  fee_bearer          enum('passenger','operator') not null default 'passenger'
  fee_display         enum('itemized','folded')    not null default 'itemized'
  cancel_window_hrs   int not null default 48   -- customer self-cancel cutoff
  settle_grace_hrs    int not null default 48   -- departure → earned; absorbs late cancellations
```

---

## Capacity Rules

**Capacity is per-trip, not per-vessel.** The same hull runs 45 on a full-day and 30 on a limited-capacity trip. `schedules` already carries capacity and materializes it onto `trips` — that is correct as written.

Two constraints:

- A materialized trip's capacity must be editable **without re-materializing the schedule**
- Capacity must never be settable below tickets already sold (validate loudly)

Dev seed uses **29**.

---

## Trip Status Transitions

The sail signal needs a settlement lag — the captain records weather cancellations LATE. Assume trips get cancelled _after_ their departure time has passed and refunds go out then. This is the expected case, not an edge case. So the status transition is **not** at departure:

```
scheduled ──(departure passes)──▶ pending_settlement
                                         │
                    ┌────────────────────┴────────────────────┐
         (grace expires, no cancellation)          (captain cancels late)
                    ▼                                         ▼
                 sailed                                   cancelled
           fee_status → earned                      fee_status → reversed
```

Fees stay `held` through the grace window (`operators.settle_grace_hrs`, default 48h), so a late cancellation is an ordinary reversal instead of unwinding a revenue recognition that shouldn't have happened. Aging can be a cron or a lazy check on read — lazy is simpler.

There are two Vercel crons: `trip-reminders` (hourly) and `expire-pending-bookings` (every 10 min).

---

## Cancellation Rules

**Cancelling a trip is one atomic transaction:** refund every ticket, reverse every fee, set `status`/`cancelled_at`, fire notifications. If a cancellation ever arrives after `sailed` was set, that's a true unwind — log it as an exception, not a normal path.

**Make cancellation one tap at the dock.** The friction of recording a cancellation is why it happens late. Both the mate app and the admin dashboard should let the captain kill a trip instantly and fire a push the moment it's recorded — otherwise customers drive to Captree, find no boat, and get refunded the next day.
