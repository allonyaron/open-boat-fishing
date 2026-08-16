# Project Walkthrough — OpenBoat Fishing Platform

## The Monorepo

```
open-boat-fishing/
  apps/
    web/        Next.js 14 — marketing + booking UI + admin + API routes
    mobile/     Expo — consumer app + mate check-in
  packages/
    db/         Drizzle schema + migrations ← core piece
    types/      shared TS types (stub)
    utils/      QR gen, Zod schemas (stub)
  package.json        root, Turborepo scripts
  turbo.json          task pipeline config
  pnpm-workspace.yaml workspace definition
```

**No separate API server.** All backend logic (booking, Stripe webhooks, schedule queries) lives in Next.js API routes under `apps/web/src/app/api/`, deployed as Vercel serverless functions. Boarding passes are printable web pages (`/boarding/[ticketId]`) — no Puppeteer, no PDF generation.

**Why Turborepo?** One `pnpm dev` starts all apps. One `pnpm typecheck` checks all packages. Turborepo caches build outputs so unchanged packages aren't rebuilt. `packages/db` is the shared dependency — both `web` and `mobile` import from it.

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

| Constraint                                       | Why                                                       |
| ------------------------------------------------ | --------------------------------------------------------- |
| `trips(schedule_id, departure_date)` unique      | Re-materializing a schedule is safe to run multiple times |
| `check_ins(ticket_id)` unique                    | One check-in per ticket. Prevents double-scan             |
| `product_prices(product_id, ticket_type)` unique | One price per ticket type per product                     |
| `bookings(confirmation_code)` unique             | Search by confirmation code at gangway                    |
| `customers(operator_id, email)` unique           | No duplicate accounts per deployment                      |
| `domains(domain)` unique                         | One operator per domain globally                          |

| Index                                | Why                                                      |
| ------------------------------------ | -------------------------------------------------------- |
| `trips(operator_id, departure_date)` | Calendar page — load all trips in a date range           |
| `bookings(operator_id, status)`      | Admin dashboard — filter by status                       |
| `bookings(stripe_payment_intent_id)` | Webhook lookup — find booking from Stripe event          |
| `check_ins(trip_id)`                 | Running count — "how many checked in for this departure" |
| `booking_items(booking_id)`          | Load all items for a booking                             |

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

- Monorepo scaffold (Turborepo + pnpm workspaces) — packages namespaced `@openboat/*`
- Full Drizzle schema, zero type errors — 13 tables, 5 enums applied to Railway Postgres
- Seed script — 1 operator, 4 vessels, 2 domains, 61 products, 98 price rows
- Dev trip fixtures — 52 trips materialized July–September 2026 via `seed-trips-dev.ts`
- `GET /api/trips?month=YYYY-MM` — calendar data route with nested vessel + product + prices
- Booking calendar UI — month grid → week strip → expandable trip cards with stepper buttons
- Design system: Space Grotesk + Plus Jakarta Sans, teal `#0E7C7B`, full token set in tailwind.config.ts
- Desktop: two-column layout (calendar left, sticky summary card right). Mobile: checkout bar pinned bottom with blur
- `/status` page — dark theme, live DB stats, build progress bar, planned features tracker
- **Stripe Connect** — platform account + Laura's connected test account (`acct_1TpdmKQ2psTV61Cr`)
- `POST /api/bookings` — creates pending booking + booking items + tickets at creation time, PaymentIntent routed to Laura's account with $2.50/ticket platform fee
- `/checkout` — Stripe Payment Element with brand theme (Apple Pay / Google Pay supported via Payment Element)
- `/booking/confirmation` — post-payment page with confirmation code, trip details, total paid
- **Stripe webhook** — `POST /api/webhooks/stripe`: `payment_intent.succeeded` → confirmed booking + seats decremented + payments row. Idempotent. Tested end-to-end ✅
- `/boarding/[bookingId]` — printable boarding pass page, QR code per ticket, vessel color header, CSS `@media print`
- GitHub repo: github.com/allonyaron/open-boat-fishing (private)

### Next in Build Order

1. **Customer info form** — collect real name/email/phone before checkout (currently hardcoded to "Guest")
2. **Admin dashboard** — schedule CRUD, trip materialize, booking list, refunds
3. **Expo mate app** — manifest, QR scanner, offline sync
4. **Production setup** — Vercel + Railway on Captree's accounts, DNS cutover, go-live

### ⚠️ Pre-Launch Checklist (must not ship without these)

- [ ] **Stripe webhook — production registration**: Add `https://[domain]/api/webhooks/stripe` in Stripe Dashboard → Developers → Webhooks. Subscribe to `payment_intent.succeeded`. Copy the production `whsec_` into Vercel env vars as `STRIPE_WEBHOOK_SECRET`. The Stripe CLI listener is dev-only and does not run in production.
- [ ] **Customer info form**: Real name/email/phone must be collected before checkout. Currently hardcoded to "Guest" / "guest@example.com".
- [ ] **12 products with no prices**: Set prices via admin dashboard before go-live (seeded products with unmapped price keys from incumbent).
- [ ] **Resend email**: Wire up confirmation email after webhook confirms booking.
- [ ] **DNS cutover**: Point your-domain.com + your-domain.com to Vercel deployment.
- [ ] **Live Stripe keys**: Swap test keys (`sk_test_`, `pk_test_`) for live keys (`sk_live_`, `pk_live_`) in Vercel env vars.

### Planned Features (decided, not yet built)

- **Automated waitlist** — cancellation triggers time-limited reservation link to next in queue
- **Repeat customer / magic link** — silent account creation at checkout, magic link return flow
- **Apple/Google Wallet passes** — post-payment, boarding pass on lock screen
- **Persistent cross-trip cart** — cart survives month navigation, multi-trip checkout

---

## Seed Script — What It Does and Why

### Why the seed script is the first coding step after schema

The schema is the blueprint — the seed makes it real. Without seeded data:

- The calendar page has nothing to render
- The booking flow has no products to select
- Drizzle Studio is empty and useless for verifying data relationships
- Any UI you build can't be tested against realistic data

The seed answers the question: "what does the DB look like when a real operator uses it?"

### What's seeded

**Operator row** — The single `operators` row that every other table traces back to. Captree's email config is hardcoded here (sourced from the incumbent's `/config` endpoint).

**4 Vessels** — Colors and names sourced directly from the incumbent's `/boats` API endpoint:

| Vessel            | Color              | Capacity |
| ----------------- | ------------------ | -------- |
| Blue Wave         | `#000099` (blue)   | 29       |
| Blue Wave Express | `#CC0000` (red)    | 29       |
| Harbor Princess   | `#CC00CC` (purple) | 120      |
| Harbor Star       | `#FFC107` (amber)  | 115      |

**2 Domains** — `your-domain.com` (primary) and `your-domain.com` — both point at the same operator. The web app resolves the operator from the request's `Host` header against this table.

**61 Products** — All `publish: true` products from the incumbent's `/` endpoint, organized by vessel. Each product has:

- `category` — fish species shown on calendar cells (e.g. "Sea Bass", "Fluke")
- `displayName` — full product name shown in the trip modal (e.g. "Night Striped Bass")
- `showRemaining` — whether the calendar shows "X Left" count on cells

**98 Price rows** — One row per ticket type per product. Only adult and child are seeded (Captree doesn't use senior pricing). 12 products have no prices yet because the incumbent used custom/descriptive price keys that didn't map cleanly — set these via the admin dashboard before go-live.

### Two-file structure — platform vs. operator data

The seed is split into two files to keep the platform generic:

```
packages/db/src/
  seed.ts        ← generic runner, knows nothing about any operator
  seed-data.ts   ← Captree-specific config (the only file that changes per client)
```

**`seed-data.ts`** exports three things:

- `operatorData` — name, slug, email config
- `domainData` — list of domains that map to this operator
- `fleetData` — vessels, each with their nested product list

**`seed.ts`** imports those exports and does the actual DB insertions. It has no hardcoded names, colors, or prices anywhere. When onboarding a new operator, you only touch `seed-data.ts`.

### Key design decisions in the seed

**Idempotent** — The seed checks if an operator row already exists before inserting anything. Run it twice, no duplicates, no errors. Safe to re-run during development.

**HAR file as source of truth** — Product names, categories, vessel colors, and prices came from intercepted API calls to the incumbent's live system (saved in `.har` files, excluded from git). Once the seed script exists, the HAR files can be deleted.

**Prices in cents** — All `price_cents` values are stored as integers in cents. `$68.00 = 6800`. A `toCents()` helper in seed.ts converts dollars → cents. This matches Stripe's format and avoids floating-point issues.

**No schedules or trips seeded** — Schedules and materialized trips are created by the admin dashboard when the operator sets up their season. The seed only creates the static reference data (who, what boats, what products, what prices) — not the temporal data.

### How to run

```bash
pnpm --filter @openboat/db seed
```

Requires `DATABASE_URL` in `packages/db/.env`. First run applies to Railway dev DB. For a fresh Captree production DB, run the same seed after provisioning their Railway Postgres.

### How to reset and re-seed

There's no teardown script yet. To reset: drop all tables in Railway (or delete and re-provision the DB), run the migration again, then re-seed.

```bash
pnpm --filter @openboat/db migrate
pnpm --filter @openboat/db seed
```

---

## Booking UI — Design Decisions

### Calendar: month grid → week strip (not a persistent month view)

Clicking an available day in the month grid collapses it to a week strip showing just that week's pills, then reveals trip cards below. This is faster than a modal and keeps context — the customer can see the whole week at a glance and tap adjacent days without going back to month. The month grid is the entry point; the week strip is the working view.

### Trip cards expand inline (no modal, no side panel)

We evaluated three patterns:

- **Modal** (what the incumbent uses) — loses calendar context, feels dated
- **Side panel** (built briefly) — good on desktop, awkward on mobile, cart state gets complicated
- **Inline expanded card** (final choice) — trip card expands in place to show ticket steppers. Calendar stays visible, works on all screen sizes, single-select keeps it simple

### Stepper buttons instead of dropdowns

`−` / count / `+` buttons instead of `<select>`. Matches native mobile feel, faster to tap, cleaner visually. Minus is disabled (grayed border) at 0; plus is always teal.

### Desktop vs mobile layout

- **Desktop (≥1024px)**: two-column grid — calendar+cards left, sticky summary card right. Summary card shows live order total and Reserve button. Customer never loses sight of what they're buying.
- **Mobile**: full-width, single column. Checkout bar pinned to bottom with `backdrop-filter: blur` — shows live total + Reserve button, always reachable.

### Design system source

Design handoff came from Claude Artifacts (`.dc.html` prototype). Colors, typography, radii, and shadows are all specified in `apps/web/tailwind.config.ts` as named tokens (`teal`, `ink`, `muted`, `surface`, `hairline`, etc.) so they can be used as Tailwind classes throughout. Fonts loaded via `next/font/google` — Space Grotesk for headings/numbers, Plus Jakarta Sans for body/UI.

### Checkout flow

Reserve button → passes cart as URL-encoded JSON to `/checkout` → Next.js server component creates booking + PaymentIntent on load → Stripe Payment Element renders. On success, Stripe redirects to `/booking/confirmation?code=XXXXXX&redirect_status=succeeded`. No separate cart page — the sticky summary card IS the cart for single-trip purchases. Multi-trip cart is a planned feature.

### Payments: Stripe Connect Destination Charges

- You (developer) are the Stripe platform account
- Laura is a connected account (`acct_...`) — Stripe Express onboarding
- PaymentIntent uses `transfer_data.destination` (not `on_behalf_of`) — funds settle to Laura's account after Stripe's payout schedule
- `application_fee_amount` = $2.50 × ticket count — deducted before transfer
- All amounts in cents throughout — no floats anywhere

---

## Architecture Decisions Locked In

- **Deployment:** Multi-tenant code, single-tenant deployment. Each client owns their own Vercel + Railway Postgres on their own accounts. One `operators` row per database.
- **No separate API server:** All backend logic lives in Next.js API routes (`apps/web/src/app/api/`), deployed as Vercel serverless functions. The Fastify API was dropped in favor of this simpler model.
- **Boarding passes:** Printable web pages at `/boarding/[ticketId]` with CSS `@media print`. No Puppeteer, no PDF generation. Browser's "Save as PDF" handles downloads.
- **Auth:** Two separate tables — `customers` (email-based) and `staff` (PIN-based). Never merged.
- **Payments:** Stripe Connect Destination Charges. `application_fee_amount: 250` ($2.50/ticket). Use `/v1/payment_intents`, not `/v1/charges`.
- **Seat inventory:** `FOR UPDATE SKIP LOCKED` on `trips.seats_remaining` — not application-level checks. Works correctly with serverless because the lock is database-side.
- **Trip materialization:** On schedule save for the full bounded date range. Re-materialize button for edits. No nightly cron for MVP.
- **Mobile check-in:** Offline-first via `expo-sqlite` + MMKV. Bluetooth scanner (Tera HW0002) emulates keyboard input into a `TextInput`.
- **Email:** Resend, from `office@oceansidecharters.example.com`. Confirmation email is a link to the boarding pass page, not inline QR.
- **SMS:** Twilio, sent after `payment_intent.succeeded` confirms.
