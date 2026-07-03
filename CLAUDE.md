# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**Scaffolded.** Monorepo exists with full Drizzle schema and first migration generated. Next step: seed script, then Next.js API routes + booking flow.

## What This Is

A **multi-tenant codebase, single-tenant deployment** platform for party fishing boat operators. The code is built multi-tenant (operators table, operator-scoped queries throughout), but each client gets their own dedicated Vercel + Railway deployment with their own database. Their database has exactly one row in `operators` — themselves.

**MVP client:** Captree / Blue Wave fleet — 4 boats, 2 domains (`your-domain.com` + `your-domain.com`), same operator record.

**Onboarding a new operator = fork repo + configure env vars + deploy to their own Vercel + Railway Postgres + point their domain. ~2-3 hours. No shared infrastructure.**

## Planned Monorepo Structure (Turborepo)

```
open-boat-fishing/
  apps/
    web/        # Next.js 14 App Router — marketing + booking UI + admin dashboard + API routes
    mobile/     # Expo (managed) — consumer app + mate check-in app
  packages/
    db/         # Drizzle ORM schema + migrations (shared source of truth)
    types/      # Shared TypeScript types
    utils/      # QR gen, Zod validation schemas
```

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
- **Boarding pass (printable page)** — `/boarding/[ticketId]` with CSS `@media print` — one ticket per page, boat name color-coded, trip + date + time, "Purchased By" name, QR code. No Puppeteer or PDF generation — browser's "Save as PDF" handles downloads.
- **Confirmation email is a link, not inline QR** — email sends a "click here to view boarding passes" link to `/boarding/[bookingId]`; QR is on the printable page. Include: "this email is sufficient for boarding" fallback line.
- **"Tickets Available" display logic** — some trips show remaining count (limited capacity), others just show as bookable; only show "SOLD OUT" when fully booked. Implement a `show_remaining` flag on products or trips.
- **Email domain** — configure Resend with `oceansidecharters.example.com` (incumbent uses `office@oceansidecharters.example.com`)

## Key Architecture Decisions

**Hosting:** Each client owns their own Vercel deployment + Railway Postgres, billed to their accounts. The developer deploys and configures it for them. No shared infrastructure between operators — each client's database is fully isolated.

**Serverless:** All API logic runs as Next.js route handlers on Vercel. No persistent server needed — boarding passes are printable web pages (`/boarding/[ticketId]`) with CSS `@media print`, not server-generated PDFs.

**Multi-tenancy (in code, not in deployment):** The code is written as if it could serve multiple operators, but in production each deployment has exactly one `operator_id` in its database. Write every DB query scoped to `operator_id`. Never build cross-operator features (no super-admin views across clients, no aggregate analytics across deployments). This keeps the codebase reusable for every new operator without being a liability if one client's data is ever compromised.

**Payments:** Stripe Connect Destination Charges. Each operator is Merchant of Record on their own charges. Developer is the Stripe platform account. `application_fee_amount: 250` ($2.50) per ticket via `transfer_data.destination`. Use `/v1/payment_intents`, NOT `/v1/charges`.

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

## Build Order

1. ✅ Monorepo setup → DB schema (`packages/db`) → Drizzle migrations
2. Seed script (`packages/db/src/seed.ts`) → Railway Postgres dev database
3. Next.js API routes (`/api/bookings`, `/api/webhooks/stripe`) → Stripe Connect → ticket issuance → email/SMS
4. Next.js UI → calendar → booking flow → cart → payment → post-payment delivery screen → `/boarding/[ticketId]` printable page
5. Expo: manifest screen + offline cache → QR scanner → name search → manual override → offline sync
6. Admin dashboard: trip CRUD → re-materialize → booking management → revenue reporting → refunds
7. Captree infra setup (Vercel + Railway on their accounts) → DNS migration → SEO → load test (k6) → go live

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
pnpm --filter @openboat/mobile start  # Expo dev server
```
