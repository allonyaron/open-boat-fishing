# Project Walkthrough — OpenBoat Fishing Platform

## The Monorepo

```
open-boat-fishing/
  apps/
    web/        Next.js 14 — marketing + booking + admin
    api/        Fastify — REST API, webhooks, PDF gen
    mobile/     Expo — consumer app + mate check-in
  packages/
    db/         Drizzle schema + migrations ← core piece
    types/      shared TS types (stub)
    utils/      QR gen, PDF, Zod schemas (stub)
  package.json        root, Turborepo scripts
  turbo.json          task pipeline config
  pnpm-workspace.yaml workspace definition
```

**Why Turborepo?** One `pnpm dev` starts all three apps. One `pnpm typecheck` checks all packages. Turborepo caches build outputs so unchanged packages aren't rebuilt. `packages/db` is the shared dependency — both `api` and `web` import from it.

---

## The Schema — Table by Table

### `operators`
The root of everything. In production this table has **one row** — the client that owns this deployment. Stores their Stripe Connect account ID, email sending config (`email_from`, `email_domain`), Twilio number, and terms URL. Multi-tenancy lives here — every other table's `operator_id` traces back to this.

### `vessels`
The boats. Each has a `color` (hex) stored on the row — not hardcoded anywhere. Captree's four colors (blue, red, amber, green) go in here at seed time. The fleet calendar is only shown when there's more than one vessel; that logic lives in the UI, not the schema.

### `products`
Trip types per vessel. Two-level naming captured here:
- `category` = "Sea Bass" (fish species, shown on calendar cells)
- `display_name` = "Sea Bass Fishing Express" (full name shown in trip modal)

`show_remaining` controls whether the calendar shows "X Left" on cells or just shows the trip as bookable. Only shows "SOLD OUT" when `seats_remaining = 0`.

### `product_prices`
One row per ticket type per product. Adult, Child, Senior each get their own row with their own `price_cents`. Unique constraint on `(product_id, ticket_type)` — can't accidentally have two adult prices for the same product. This drives the separate per-type quantity selectors and "Add to Cart" buttons in the booking modal.

### `schedules`
The recurring pattern. Key fields:
- `start_date` / `end_date` — the season bounds (e.g., June 1 → September 30)
- `days_of_week` — a PostgreSQL array of the `day_of_week` enum (`['tue', 'thu']`)
- `departure_time` / `return_time` — stored as `TIME`, not timestamp, because these repeat daily
- `capacity` — can differ from the vessel's default capacity

No trips live here. This is just the template.

### `trips`
Materialized individual departures. Written when an admin saves a schedule. Key design points:
- `start_time` and `end_time` are full `TIMESTAMP WITH TIME ZONE` — not just a time field. A night striper trip departing 7 PM and returning 1 AM next day is captured correctly.
- `departure_date` as a separate `DATE` column — makes calendar queries (`WHERE departure_date BETWEEN ? AND ?`) fast and readable without timezone math.
- `seats_remaining` — decremented atomically using `FOR UPDATE SKIP LOCKED` when a booking is confirmed. Never decremented at cart-add time, only on `payment_intent.succeeded`.
- Unique constraint on `(schedule_id, departure_date)` — re-materializing a schedule is idempotent. Run it twice, no duplicates.
- Index on `(operator_id, departure_date)` — the calendar page query is the hottest query in the system.

### `trip_overrides`
When the captain cancels a trip or changes capacity for a specific date, it goes here rather than mutating the `trips` row. The `trips` row stays as-materialized; the override is applied at query time. Matches how the incumbent's `/overrides` API works.

### `customers`
Email-based login, order history. Deliberately separate from `staff` — different auth mechanism, different data. `password_hash` is nullable because guest checkout is supported. Unique on `(operator_id, email)`.

### `staff`
PIN-based + password-based login. `role` is `admin | mate`. Mates can be assigned to a specific `vessel_id` so the tablet knows which boat's manifest to load by default. `pin_hash` is for the mate tablet (4-6 digit PIN). `password_hash` is for admin web login.

### `bookings`
One per checkout session. The multi-trip cart means a single `bookings` row can reference tickets across multiple departures. Key fields:
- `confirmation_code` — 6-character alphanumeric, unique, shown to the customer and searchable at the gangway
- `status` enum: `pending` → `confirmed` → `cancelled`. Only `confirmed` bookings issue tickets.
- `stripe_payment_intent_id` — stored here before payment lands, so the webhook can find the booking
- `customer_name` / `customer_email` / `customer_phone` — denormalized so you always have them even if the customer record changes
- `platform_fee_cents` — $2.50 × ticket count, stored so revenue reporting is trivial
- `customer_id` is nullable — guest checkout creates a `bookings` row with no `customers` row

### `booking_items`
The join between a booking and a trip. One row per trip in the cart. If a customer buys a Fluke trip on July 8 and a Night Striper on July 9, there are two `booking_items` rows, both pointing at the same `bookings` row. `tickets` hang off `booking_items` — because a ticket is for a specific departure.

### `tickets`
One per passenger. Key fields:
- `ticket_type` — `adult | child | senior`
- `price_cents` — snapshot of the price at time of purchase (historical accuracy matters for refunds)
- `qr_payload` — the string encoded into the QR code. Contains the ticket ID. The mate's app decodes this to look up the ticket and mark it checked in.
- `voided` — set to `true` on refund, so a voided ticket can't be scanned in
- Direct `booking_id` FK in addition to `booking_item_id` — makes "all tickets for this booking" a single-hop query

### `check_ins`
Written when a mate checks someone in. Unique constraint on `ticket_id` — can't check in the same ticket twice. `method` tracks how it happened (`qr | name_search | manual`). `synced_at` is null when created offline — the sync job fills this in when connectivity returns.

### `payments`
Written by the `payment_intent.succeeded` webhook handler. Stores every Stripe ID you'll need: `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_transfer_id` (payout to the operator), `application_fee_id` (your $2.50/ticket). One-to-one with `bookings`.

### `domains`
Maps domain names to operators. Captree gets two rows: `your-domain.com` and `your-domain.com`, both pointing at the same `operator_id`. The API reads this table on every request to know which operator it's serving. One domain is marked `primary: true`.

---

## Key Constraints & Indexes

| Constraint | Why |
|---|---|
| `trips(schedule_id, departure_date)` unique | Re-materializing a schedule is safe to run multiple times |
| `check_ins(ticket_id)` unique | One check-in per ticket. Prevents double-scan |
| `product_prices(product_id, ticket_type)` unique | One price per ticket type per product |
| `bookings(confirmation_code)` unique | Search by confirmation code at gangway |
| `customers(operator_id, email)` unique | No duplicate accounts per deployment |
| `domains(domain)` unique | One operator per domain globally |

| Index | Why |
|---|---|
| `trips(operator_id, departure_date)` | Calendar page — load all trips in a date range |
| `bookings(operator_id, status)` | Admin dashboard — filter by status |
| `bookings(stripe_payment_intent_id)` | Webhook lookup — find booking from Stripe event |
| `check_ins(trip_id)` | Running count — "how many checked in for this departure" |
| `booking_items(booking_id)` | Load all items for a booking |

---

## The Data Flow — Customer to Gangway

### Booking
1. Customer opens calendar → API queries `trips` joined with `products` + `vessels`, filtered by `operator_id` and date range
2. Customer picks a trip → modal shows `product_prices` for Adult/Child/Senior
3. Customer adds to cart → client-side state only, nothing written to DB yet
4. Customer checks out → API creates `bookings` (status: `pending`) + `booking_items` + calls Stripe to create a `PaymentIntent`
5. Stripe processes payment → `payment_intent.succeeded` webhook fires
6. Webhook handler: update `bookings.status = confirmed`, decrement `trips.seats_remaining` with `FOR UPDATE SKIP LOCKED`, write `tickets` (one per passenger), write `payments` row, send Resend email + Twilio SMS

### Check-in
1. Mate opens app → loads today's manifest (all `tickets` + `bookings` for today's trips, cached in `expo-sqlite`)
2. Customer scans QR → app decodes `ticket.qr_payload` → looks up ticket in local cache → validates it's for the right trip, not voided, not already checked in
3. App writes a `check_ins` row locally → queues sync event
4. Green ✓ shown on screen, running count updates
5. When connectivity returns → sync job posts pending check-ins to API → API writes to `check_ins` table, sets `synced_at`

---

## What's Done vs. What's Next

### Done
- Monorepo scaffold (Turborepo + pnpm workspaces)
- Full Drizzle schema, zero type errors
- First migration generated (`packages/db/migrations/0000_safe_kingpin.sql`)
- Fastify API stub with `/health` endpoint
- Next.js web app stub
- Expo mobile app stub

### Next in Build Order

1. **Seed script** — `packages/db/src/seed.ts` — seeds the Captree operator row, 4 vessels with their colors, and the ~61 products from the HAR file. Run this against a fresh Railway DB to get a working dev environment.

2. **Fastify API routes** — schedule query (`GET /schedule`), booking create (`POST /bookings`), Stripe webhook (`POST /webhooks/stripe`)

3. **Stripe Connect** — operator onboarding flow, PaymentIntent creation with `transfer_data.destination` and `application_fee_amount: 250`

4. **Next.js calendar + booking flow** — calendar UI, trip detail modal with per-type quantity selectors, multi-trip cart, Stripe Elements payment form, post-payment delivery screen

5. **Boarding pass PDF** — Puppeteer template matching the format in `images/` (boat name color-coded, QR code, ticket ID, "Purchased By")

6. **Expo mate app** — manifest screen, QR scanner, name search, offline sync

7. **Admin dashboard** — trip CRUD, re-materialize button, booking list, manifest print

---

## Architecture Decisions Locked In

- **Deployment:** Option A — multi-tenant code, single-tenant deployment. Each client owns their own Vercel + Railway on their own accounts. One `operators` row per database.
- **Auth:** Two separate tables — `customers` (email-based) and `staff` (PIN-based). Never merged.
- **Payments:** Stripe Connect Destination Charges. `application_fee_amount: 250` ($2.50/ticket). Use `/v1/payment_intents`, not `/v1/charges`.
- **Seat inventory:** `FOR UPDATE SKIP LOCKED` on `trips.seats_remaining` — not application-level checks.
- **Trip materialization:** On schedule save for the full bounded date range. Re-materialize button for edits. No nightly cron for MVP.
- **PDF generation:** Puppeteer on Railway (Fastify server) — requires persistent server, not serverless.
- **Mobile check-in:** Offline-first via `expo-sqlite` + MMKV. Bluetooth scanner (Tera HW0002) emulates keyboard input into a `TextInput`.
- **Email:** Resend, from `office@oceansidecharters.example.com`. Confirmation email is a link to download boarding passes, not inline QR.
- **SMS:** Twilio, sent after `payment_intent.succeeded` confirms.
