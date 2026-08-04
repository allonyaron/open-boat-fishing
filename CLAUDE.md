# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**In progress.** Steps 1–6 complete. Step 7 (Expo) partially done.

**Web app:** Full booking flow live end-to-end — BookingCalendar → cart → checkout (Stripe PaymentElement) → post-payment delivery screen → printable boarding passes at `/boarding/[bookingId]`. Webhooks handle `payment_intent.succeeded` (confirm booking + send Resend email) and `payment_intent.canceled` (restore seats). Seat inventory uses `FOR UPDATE` row-lock inside a transaction (race-condition-safe). Confirmation email sends via Resend with ticket list, boarding pass link, and "this email is sufficient for boarding" fallback.

**Expo consumer app:** Trips tab complete (month calendar, vessel dots, trip cards, ticket bottom sheet, cart bar). Tickets tab complete (SQLite wallet, add-by-code+email, offline boarding pass QR at `/boarding/[ticketId]`, brightness boost, cancelled state). Account tab is a stub. **Checkout flow complete** — Reserve → `/checkout` (order summary + contact form) → Stripe Payment Sheet → confirmation screen + background wallet sync via `GET /api/bookings` polling.

Native module setup resolved: `expo-linking`, `react-native-safe-area-context`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-screens` all installed at SDK 53-compatible versions. `metro.config.js` has a custom `resolveRequest` to force singleton resolution of these packages (pnpm virtual store otherwise bundles duplicates, causing "Tried to register two views with the same name" crash).

**Database:** Migrated from Railway to Neon (Postgres 18). Update `DATABASE_URL` in Vercel when deploying.

**Known gaps blocking production:**
- SMS not sent (Twilio TODO in webhook)
- `fee_status` never transitions from `held` → `earned` or `reversed` (revenue reporting blocked)
- Trip cancellation handler not implemented (no sail signal, no `applicationFees.createRefund()`)
- QR payload is bare UUID — needs HMAC signing before launch
- Weekend vs. weekday pricing not modelled (incumbent Blue Wave charges differently on weekends — schema change needed)
- Account tab is a stub (login, order history)
- Push notifications not wired

**Next:** fee transitions → admin dashboard (step 9) → mate check-in app (step 8).

## Known Tech Debt (pre-launch, not blocking dev)

- **QR signing** — `tickets.qrPayload` is currently a bare UUID. Must be replaced with an HMAC of the ticket ID using a per-operator secret before launch. A guessable ID lets someone mint a plausible pass. The mate app must validate the signature offline against the cached manifest.
- **Webhook fee transitions** — `fee_status` is written as `held` at booking time but never transitions to `earned` (trip sailed + grace window cleared) or `reversed` (cancellation). The sail signal + `applicationFees.createRefund()` on cancellation still need to be implemented. Revenue reporting is blocked on this.
- **Weekend/weekday pricing** — implemented via `schedule_prices` table (migration `0002`). Create separate schedules per price tier (e.g. Mon–Fri at $58, Sat–Sun at $62); the booking route checks `schedule_prices` first, falls back to `product_prices`. Seed data not yet updated with Captree's actual weekday/weekend split — needs admin dashboard or manual seed entries.
- **Holiday pricing** — `holiday_dates` table added (migration `0002`). No booking logic yet; holidays should resolve to the weekend schedule's price. Needs admin UI and booking route update to check trip date against `holiday_dates`.

## What This Is

A **multi-tenant codebase, single-tenant deployment** platform for party fishing boat operators. The code is built multi-tenant (operators table, operator-scoped queries throughout), but each client gets their own dedicated Vercel + Railway deployment with their own database. Their database has exactly one row in `operators` — themselves.

**MVP client:** Captree / Blue Wave fleet — 4 boats, 2 domains (`your-domain.com` + `your-domain.com`), same operator record.

**Onboarding a new operator = fork repo + configure env vars + deploy to their own Vercel + Neon Postgres + point their domain. ~2-3 hours. No shared infrastructure.**

## Planned Monorepo Structure (Turborepo)

```
open-boat-fishing/
  apps/
    web/        # Next.js 14 App Router — marketing + booking UI + admin dashboard + API routes
    mobile/     # Expo (managed) — two apps from one codebase (see below)
  packages/
    db/         # Drizzle ORM schema + migrations (shared source of truth)
    types/      # Shared TypeScript types
    utils/      # QR gen, Zod validation schemas
```

### Mobile Apps (Expo EAS — two distinct apps, one codebase)

**Consumer booking app** — white-labeled, published to App Store + Google Play under the *operator's* name (e.g., "OpenBoat Fishing" by Captree, not by the developer). Scope: browse trip calendar, buy tickets, view/manage bookings, display boarding pass QR in-app (wallet-style), receive push notifications for trip reminders. Each new operator gets their own App Store Connect + Google Play Console accounts; Expo EAS handles per-client builds via separate `eas.json` build profiles (different bundle ID, app name, icon, theme colors per client).

**Mate check-in app** — internal tool, distributed via TestFlight / internal Play track (no public App Store listing needed). Scope: offline manifest, QR scanner, name search, manual override, sync when online.

**Onboarding a new operator's app** = new EAS build profile + client's App Store/Play accounts + submit. ~1-2 hours per platform.

**No separate API server.** All backend logic lives in Next.js API routes (`apps/web/src/app/api/`). Stripe webhooks, booking creation, seat decrement — all Next.js route handlers deployed as Vercel serverless functions.

## Data Model (core hierarchy)

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

### Required fields not yet in the schema

Surfaced by competitor API analysis (`/docs/captree-booking-ux-audit.md` §6) and the fee decision:

```
trips
  + status              enum('scheduled','pending_settlement','sailed','cancelled')
                                     not null default 'scheduled'
  + sailed_at           timestamptz null
  + cancelled_at        timestamptz null
  + cancellation_reason text null          -- 'weather' | 'mechanical' | 'low_bookings' | free text
  + boarding_time       time null          -- distinct from departure (06:30 board / 07:00 depart)
  + duration_day        int not null default 0   -- multi-day trips: duration on the trip,
  + duration_hr         int                      -- NOT a spanning calendar entity
  + duration_min        int
  + online_cutoff       timestamptz null   -- online booking closes
  + deposit_percentage  int null           -- null = pay in full

tickets
  + fee_amount_cents    int not null default 150  -- SNAPSHOT at write time, never read
                                                  -- from config at bill time
  + fee_status          enum('held','earned','reversed') not null default 'held'

operators
  + fee_bearer          enum('passenger','operator') not null default 'passenger'
  + fee_display         enum('itemized','folded')    not null default 'itemized'
  + cancel_window_hrs   int not null default 48   -- customer self-cancel cutoff
  + settle_grace_hrs    int not null default 48   -- departure → earned; absorbs late cancellations
```

**Capacity is per-trip, not per-vessel.** The same hull runs 45 on a full-day and 30 on a limited-capacity trip. `schedules` already carries capacity and materializes it onto `trips` — that is correct as written. Two constraints: a materialized trip's capacity must be editable **without re-materializing the schedule**, and capacity must never be settable below tickets already sold (validate loudly). Dev seed uses **29**.

**The sail signal needs a settlement lag — the captain records weather cancellations LATE.** Assume trips get cancelled *after* their departure time has passed and refunds go out then. This is the expected case, not an edge case. So the status transition is **not** at departure:

```
scheduled ──(departure passes)──▶ pending_settlement
                                         │
                    ┌────────────────────┴────────────────────┐
         (grace expires, no cancellation)          (captain cancels late)
                    ▼                                         ▼
                 sailed                                   cancelled
           fee_status → earned                      fee_status → reversed
```

Fees stay `held` through the grace window (`operators.settle_grace_hrs`, default 48h), so a late cancellation is an ordinary reversal instead of unwinding a revenue recognition that shouldn't have happened. Aging can be a cron or a lazy check on read — lazy is simpler and there's no cron in the stack.

**Cancelling a trip is one atomic transaction:** refund every ticket, reverse every fee, set `status`/`cancelled_at`, fire notifications. If a cancellation ever arrives after `sailed` was set, that's a true unwind — log it as an exception, not a normal path.

**Make cancellation one tap at the dock.** The friction of recording a cancellation is why it happens late. Both the mate app and the admin dashboard should let the captain kill a trip instantly and fire a push the moment it's recorded — otherwise customers drive to Captree, find no boat, and get refunded the next day.

## Booking Flow Requirements (gaps found vs. original plan)

These are things the incumbent does that were not explicitly in the original architecture docs:

- **End time required on trips** — display start + end time on the trip modal and boarding pass
- **Two-level product naming** — show both category ("Sea Bass") and display name ("Sea Bass Fishing Express") in UI
- **Per-type "Add to Cart"** — Adult and Child have separate quantity selectors and separate "Add to Cart" buttons; inline cart feedback ("IN CART: 1 TOTAL: $65.00") appears on the modal after adding
- **Multi-trip cart** — a customer can add tickets across multiple departures and pay in one checkout; bookings table must support this
- **Editable cart** — quantity is adjustable in the cart view; items can be individually removed
- **Terms acceptance** — "Purchasing tickets means you accept the terms and conditions" inline at cart; need a `/terms` page
- **Phone number at checkout** — collect mobile number during payment for SMS delivery (Stripe Payment Element supports this)
- **Post-payment delivery screen** — after payment succeeds, show a dedicated screen with three options: Print Now (browser print dialog on `/boarding/[ticketId]`), Email to address, Text to phone. This is separate from the confirmation page.
- **Boarding pass (printable page)** — two URL forms, one component: `/boarding/[bookingId]` (whole order, every ticket stacked — this is what the confirmation email links to) and `/boarding/[ticketId]` (single ticket; build this first, the booking page maps over it). Each ticket is one `<article>` with `page-break-after: always`. Fields: operator masthead in `operator.brand_color` (white-labeled, not hardcoded red), "Boarding pass" + ticket type, boat name color-coded from `vessels.color_hex` **and in text** (never color alone — half these print in grayscale), product display name, departs AND returns, "Purchased by" (the buyer; all tickets in an order carry the same name), QR top-right, ticket ID in monospace at the bottom as the scan-failure fallback.
- **The QR must encode a signed value, not a bare ticket ID** — a URL to `/boarding/[ticketId]` or an HMAC of the ticket ID with a per-operator secret. A guessable ID lets someone increment their own and mint a plausible pass. The mate app validates the signature offline against the cached manifest.
- **Print CSS is why this is a web page** — `@media print` sets `page-break-after: always` per pass, hides chrome, and critically sets `print-color-adjust: exact` (browsers strip background colors when printing; without it the boat-color coding vanishes on paper). Print button is `window.print()`; the browser's dialog handles Save-as-PDF. No Puppeteer, no server-side PDF.
- **A cancelled/refunded ticket must render a CANCELLED state** — the pass URL is durable and effectively public. Check ticket status on render.
- **Confirmation email is a link, not inline QR** — email sends a "click here to view boarding passes" link to `/boarding/[bookingId]`; QR is on the printable page. Include: "this email is sufficient for boarding" fallback line.
- **"Tickets Available" display logic** — some trips show remaining count (limited capacity), others just show as bookable; only show "SOLD OUT" when fully booked. Implement a `show_remaining` flag on products or trips.
- **Email domain** — configure Resend with `oceansidecharters.example.com` (incumbent uses `office@oceansidecharters.example.com`)
- **Fee presentation is operator-configurable, account-wide** — `operators.fee_bearer` (`passenger` | `operator`) and `operators.fee_display` (`itemized` | `folded`) produce four combinations. Defaults: `passenger` / `itemized` (matching GoFish). Scope is account-wide, never per-product: the fee is identical on every ticket and only its presentation varies; per-product display would make a multi-trip cart show a fee on one line and hide it on the next. Surface the setting in the pricing setup screen (where the captain is already thinking about money), not in account settings. Include a live preview: "Customer sees → $80.50".
- **Rod rental is an optional per-product ticket type** — most Captree trips include rods in the fare (one price row); long-distance trips may offer rods for an extra fee (a second row, e.g. `Passenger with rod`). Captain enables and prices it per product. Default off. No `is_addon` flag and no parent-product relationship — a rod is just another named ticket type.
- **Customer cancellation cutoff is 48 hours** before departure (`operators.cancel_window_hrs`, default 48). Inside 48h the customer's self-service cancel is closed. **The captain's manual refund has no time limit** — it is a separate, always-available admin power, not an override of the 48h rule.
- **The platform fee always reverses on cancellation** — weather, customer self-cancel, or captain discretion. No exceptions. A **no-show earns the fee** (the passenger didn't cancel; the boat sailed with the seat sold).
- **No slip/dock numbers** — Captree doesn't assign them. Boat name + boat color do the wayfinding on the pass and in reminder pushes.

## Key Architecture Decisions

**Hosting:** Each client owns their own Vercel deployment + Railway Postgres, billed to their accounts. The developer deploys and configures it for them. No shared infrastructure between operators — each client's database is fully isolated.

**Serverless:** All API logic runs as Next.js route handlers on Vercel. No persistent server needed — boarding passes are printable web pages (`/boarding/[ticketId]`) with CSS `@media print`, not server-generated PDFs.

**Multi-tenancy (in code, not in deployment):** The code is written as if it could serve multiple operators, but in production each deployment has exactly one `operator_id` in its database. Write every DB query scoped to `operator_id`. Never build cross-operator features (no super-admin views across clients, no aggregate analytics across deployments). This keeps the codebase reusable for every new operator without being a liability if one client's data is ever compromised.

**Payments:** Stripe Connect Destination Charges. Each operator is Merchant of Record on their own charges. Developer is the Stripe platform account. Use `/v1/payment_intents`, NOT `/v1/charges`. Payment methods — credit/debit card, PayPal, Venmo, Apple Pay, Google Pay — are all enabled via the Stripe Payment Element; no separate PayPal integration needed. Stripe handles routing regardless of which method the customer picks.

**Platform fee: $1.50 per ticket** (`application_fee_amount: 150`), NOT $2.50. Taken at charge time via `transfer_data.destination`. The fee is only *earned* when a trip sails, so it is tracked as held-then-earned in our own books:

- `tickets.fee_amount_cents` — snapshot at write time (default 150). Never read the fee from config when billing; historical tickets bill at the rate in force when sold.
- `tickets.fee_status` — `held` at charge time → `earned` only after the trip clears its settlement grace window (departure + `settle_grace_hrs`, default 48h) → `reversed` on cancellation. The lag exists because the captain records weather cancellations late; see the schema section.
- **Revenue reporting counts only `WHERE fee_status = 'earned'`.** Stripe's balance and our earned-revenue number will disagree constantly by design; `fee_status` is what explains the gap.
- **Every cancellation reverses the fee** — weather, customer self-cancel, or captain discretion, no exceptions. The cancellation handler calls `applicationFees.createRefund()` alongside the customer refund, in the same transaction.
- **Partial cancellations** (multi-trip cart, one trip dies) reverse only that trip's tickets' fees, not the whole booking's.
- **A no-show earns the fee** — the passenger didn't cancel; the boat sailed with the seat sold.

Rationale and the rejected alternative (monthly invoicing on sailed tickets) are in `/docs/fee-mechanism-decision.md`. Revisit at operator #3.

**Booking confirmation flow:** `payment_intent.succeeded` webhook (Next.js API route) → confirm booking → issue tickets → send email (Resend) + optional SMS (Twilio).

**Seat inventory:** Use PostgreSQL `FOR UPDATE SKIP LOCKED` on seat decrement to prevent race conditions — not application-level checks. Works correctly with serverless because the lock is database-side.

**Mobile check-in:** Offline-first. Manifest cached at app open via `expo-sqlite` + `MMKV`. Check-in events queued locally and synced when online. Bluetooth barcode scanners (Tera HW0002) emulate keyboard input into a `TextInput` — test this early.

**Fleet calendar:** Only shown when `vessels.count > 1` for an operator. Color-coded per vessel. For Captree: Blue Wave = blue, Express = red, Princess = amber, Pride = green. These colors are stored on the `vessels` row, not hardcoded.

**Auth model:** Two separate tables — `customers` (email-based login, order history) and `staff` (PIN-based login, role: `admin | mate`). These have incompatible auth mechanisms and different data; never merge them into one `users` table.

**Trip materialization:** Materialize on schedule save — when an admin saves a schedule, immediately write all `trips` rows for the full bounded date range (e.g., June 1 → September 30). Fishing seasons are defined and bounded; no open-ended schedules. The admin dashboard includes a "Re-materialize" button per schedule for edits and extensions. Use `(schedule_id, departure_date)` as a unique constraint to prevent duplicates on re-run. No nightly cron needed for MVP.

## Incumbent Booking Flow (observed from live purchase — `images/` directory)

The full flow the client uses today. Our platform must match or improve on every step.

**1. Calendar** — Month view, color-coded by boat. Each trip cell shows time + "X Left" (remaining tickets). Fish species images on each cell. Legend distinguishes "Limited Capacity" trips (show count) from open trips (no count shown). A trip only says "SOLD OUT" when fully booked.

**2. Trip detail modal** (opens over calendar) — Shows trip type, date, start time AND end time, boat name, product display name (e.g. "Sea Bass Fishing Express"), tickets available count. Ticket types (Adult/Child) each have their own quantity dropdown + individual "Add to Cart" button. After adding, inline feedback appears: "IN CART: 1 TOTAL: $65.00" with a remove icon.

**3. Cart** — Groups tickets by date/time. Shows ticket type + boat + trip + date/time, editable quantity dropdown, price per ticket, subtotal per line, grand total, terms & conditions link. Payment method choice: PayPal, Venmo, or Debit/Credit Card (separate "Add to Cart" per type means multi-trip cart is possible — buying across multiple departures in one checkout).

**4. Payment** — PayPal popup OR inline card form (email, card, expiry, CVV, billing name, ZIP, mobile phone). Phone is collected here for SMS delivery.

**5. Post-payment delivery screen** — "How Would You Like To Receive Your Tickets?" — three actions: "Print Tickets" (immediate PDF download), "Email Tickets" (pre-filled with PayPal email, editable), "Text Tickets" (phone field). Done button. This is a distinct screen, not just a confirmation page.

**6. Boarding pass PDF** — One ticket per page. Header: "CAPTREE FISHING TICKETS" (red). Fields: "Boarding Pass" + ticket type, boat name (color-coded), trip type + date/time, "Purchased By: [name]", QR code (top-right), ticket ID string at bottom (e.g. `34P33704GT014254Y-48ADULT1782860460-1`). Served from `interface.ticketmgmt.dev/info/{merchant_id}/passes/{ticket_id}`.

**7. Confirmation email** — From `office@oceansidecharters.example.com` via `mg.your-domain.com`. Subject: "Tickets Purchased". Body lists tickets ordered + "Click Here" link to download boarding passes. Includes: "If you have a problem printing your ticket (or boarding pass) This email will be sufficient for boarding." — showing the email at the gangway is an accepted fallback.

**Check-in reality:** QR codes are generated and on boarding passes but the mate currently checks people in off a printed clipboard manifest — the QR scanner is not in use yet. The boat goes out 3x/day so the manifest must be printed per departure (likely from the admin dashboard or a boat-side printer). Our PDF manifest + mate app QR scanner is a direct upgrade from the clipboard.

## Incumbent System (being replaced)

- Booking platform: `ticketmgmt.dev`, merchant ID `DSLVFD8QBSNR8`
- HAR files at project root contain the full API response shape from the incumbent — use these to understand the data model being migrated
- `captree-6-23.com.har` — calendar page with full API responses (boats, products, schedule, overrides)
- `captree_com.har` — full checkout flow
- Incumbent departure time hack: `:01/:02/:03` minute suffixes disambiguate multiple products at the same hour on the same boat — our materialized `trips` model does not need this

## Competitive Position

**GoFish (`gofish.rocks`) is a live direct competitor** in this exact segment — they publish a landing page for Long Island fishing charters, and Miss Montauk runs on them. They charge $1.50/passenger, on the operator's own domain, operator as merchant of record, free migration, no setup fee. Nearly every structural advantage this platform was designed around, they already ship. **Do not position on price or on "you keep your brand."**

Two things are actually differentiated. First, **execution**: their production site points at `dev-api.gofish.rocks`, does seat holds over `GET` requests that mutate inventory, and runs a half-migrated payment stack (Square 404s, Stripe loads only for fingerprinting, Authorize.net seal on the page). Our `FOR UPDATE SKIP LOCKED` seat decrement is genuinely better engineering — but that advantage only exists if we actually ship something robust. Second, and more important: **the consumer mobile app with an offline tickets wallet.** No competitor in this category — GoFish, FareHarbor, AttractionSuite, or the incumbent — ships one. Captree State Park's dock is where cell coverage is worst, and a boarding pass that won't load at the gangway is the nightmare scenario. **The booking flow is table stakes; the app is the product.** Prioritize accordingly.

## Build Order

1. ✅ Monorepo setup → DB schema (`packages/db`) → Drizzle migrations
2. ✅ Schema additions (`trips.status`, fee fields, `boarding_time`, duration fields) → migration `0001_nifty_maximus.sql` applied
3. ✅ Seed script (`packages/db/src/seed-trips-dev.ts`) → 157 dev trips across 4 vessels, capacity 29
4. ✅ Mobile-first rebuild of web `BookingCalendar.tsx` — month grid + day list, desktop calendar/list toggle, bottom sheet ticket selector, pinned cart bar
5. ✅ (partial) `/api/bookings` (transaction-safe, `FOR UPDATE` seat lock, schedule-level pricing, group discounts), `/api/webhooks/stripe` (`payment_intent.succeeded` + `payment_intent.canceled`), Stripe Connect (`application_fee_amount: 150`), ticket issuance. **Remaining:** Resend email, Twilio SMS, `fee_status` transitions (`held → earned/reversed`), trip cancellation handler.
6. ✅ Cart → checkout (Stripe PaymentElement) → post-payment delivery screen → `/boarding/[bookingId]` printable boarding passes
7. ⚠️ (partial) Expo consumer app scaffolded, EAS configured. Trips tab complete. Tickets tab complete (SQLite wallet, offline QR, brightness boost). Checkout flow complete (cart → Stripe Payment Sheet → confirmation + wallet sync). **Remaining:** push notifications → Account tab → EAS build + store submission.
8. Expo mate check-in app → manifest + offline cache → QR scanner → name search → manual override → offline sync → TestFlight/internal track
9. Admin dashboard (web): trip CRUD → per-trip capacity edit → re-materialize → booking management → revenue reporting → refunds. Mobile subset in mate app: trip cancellation (one-tap, highest urgency) + today's manifest.
10. Fishing reports: captain posts after each trip (web admin + quick-post from mate app mobile). Fields: date/vessel/trip auto-populated, catch summary text, photos, structured fish counts per species. Displayed publicly on the marketing site and in the consumer app to drive bookings.
11. Captree infra (Vercel + Neon on their accounts) → DNS migration → SEO → load test (k6) → go live

## Commands

```bash
# Root
pnpm install                      # install all workspaces
pnpm dev                          # run all apps in parallel (Turborepo)
pnpm build                        # build all apps
pnpm typecheck                    # tsc across all packages

# Database (packages/db)
pnpm db:migrate                   # run Drizzle migrations against DATABASE_URL
pnpm db:studio                    # open Drizzle Studio (requires DATABASE_URL)
pnpm --filter @openboat/db generate   # generate migration from schema changes

# Individual apps
pnpm --filter @openboat/web dev
pnpm --filter @openboat/mobile dev    # Expo dev server (use `-- --clear` to clear Metro cache)
```

## Dependency Overrides (pnpm-workspace.yaml)

These overrides are pinned — do not remove without testing. All exist to prevent pnpm's non-flat `node_modules` from bundling duplicate copies of packages that register native view managers or hold singleton state.

- `react-native-screens: ~4.11.1` — Expo SDK 53 expects this version. `4.25.x` uses a `CodegenTypes` namespace not exported by `react-native@0.79.6`, causing Metro bundling to fail with "Unknown prop type" errors.
- `react: 19.0.0` / `react-dom: 19.0.0` — `react-native@0.79.6` bundles `react-native-renderer@19.0.0`; mismatched React versions cause an "Incompatible React versions" runtime error.
- `react-native-safe-area-context: ~5.4.0` — without this, `@react-navigation/bottom-tabs` pulls in its own copy (5.8.x), Metro bundles both, and the app crashes at startup with "Tried to register two views with the same name RNCSafeAreaProvider".
- `react-native-gesture-handler: ~2.24.0` — same reason; navigation packages pull a conflicting transitive version.
- `react-native-reanimated: ~3.17.5` — same reason.

The overrides alone are not sufficient — `metro.config.js` also has a custom `resolveRequest` that forces all imports of these packages to resolve from the app's own `node_modules`, regardless of which pnpm store entry is doing the require. Both the override (deduplication) and the resolver (resolution pinning) are needed together.
