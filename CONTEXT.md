# Captree.com — Project Context for Claude Code

## Project Overview

A multi-tenant SaaS booking + check-in platform for party fishing boats. Any fishing boat operator can use the same system. The MVP is built for the Blue Wave / Captree fleet (Captree State Park, NY), which is the first customer. The platform is designed so adding a second customer is one new row in the `operators` table — not a rewrite.

**MVP client:** Blue Wave / Captree fleet (4 boats, 2 domains — see below)  
**My role:** Full-stack developer, software architect, platform owner

---

## Platform Model

**Deployment model: Option A — Multi-tenant code, single-tenant deployment.**

One codebase. Each client gets their own Vercel + Railway deployment with their own database. The database has exactly one row in `operators` (themselves). The code is built multi-tenant so every new operator is a fork-and-configure, not a rewrite.

- Each operator's deployment is billed to the client (Vercel + Railway on their accounts)
- Each operator's database is isolated — no shared data, no cross-operator risk
- Every DB query is scoped to `operator_id`. No cross-operator features. Ever.
- Each operator has their own vessels, products, schedules, bookings
- Each operator gets their own domain pointing at their own deployment
- Multi-vessel operators show a combined fleet calendar; single-vessel operators see a single schedule

**Operator onboarding:** Developer forks the repo, runs migrations against a fresh DB, configures env vars, points the client's domain at their Vercel deployment. ~2-3 hours per new operator. Self-service signup is a future feature.

**Platform name:** openboat (npm namespace `@openboat/*`). Not yet customer-facing branded.

---

## MVP Client: Captree / Blue Wave Fleet

- **4 boats:** Blue Wave (blue), Blue Wave Express (red), Harbor Princess (amber), Harbor Star (green)
- **2 domains, 1 operator:** your-domain.com and your-domain.com both belong to the same operator (Blue Wave bought the Princess and Pride vessels). Both domains point at the same platform operator, same 4-boat combined fleet calendar.
- **Incumbent merchant ID:** `DSLVFD8QBSNR8` (used across both domains)
- **~61 published trip products** across 4 boats (Fluke, Night Stripers, Sea Bass, Tilefish, Fireworks cruises, etc.)
- **HAR files at project root:** `captree_com.har` (checkout flow), `captree-6-23.com.har` (calendar page with full API responses)

---

## Business Model

### Client (Captree) — Launch Customer

- Pays a **$20,000 upfront build fee** (custom build, white-labeled, first customer)
- Deployed to **their own infrastructure** — Vercel + Railway billed to the client's accounts
- Client is their own Merchant of Record via Stripe Connect (they own their Stripe account and funds)
- **12-month minimum term** — after that, either party can terminate with 30 days notice
- On termination: they keep their deployment running as-is, fee-free. Per-ticket platform fee stops.
- Because they own the infrastructure, no data export or handover is needed — it's already theirs

### Developer (me) — Revenue

- **$1.50 flat platform fee** per ticket via Stripe Connect `application_fee_amount`
- Fee is passed to the consumer at checkout as a visible booking fee
- Scales with ticket volume, not ticket price — incentive-aligned with the client
- Estimated: ~$19,800/season at current Captree volume before growth
- **Future operators:** Fork the repo, configure their env, deploy to their own Vercel + Railway. Same $2.50/ticket model. Upfront build fee TBD per engagement.

### Why this model beats the alternatives (for pitch)

- FareHarbor: ~$4.08/ticket (~$32,000/season) + they are Merchant of Record
- GoFish.Rocks: $1.50/ticket, generic, bootstrapped side project, no infrastructure ownership
- ticketmgmt.dev (incumbent): opaque fees, PayPal/Braintree, client has zero data portability

---

## Current Stack (Incumbent — to be replaced)

### Booking Platform: ticketmgmt.dev

- Frontend: `your-domain.com/ticketmgmt/` (white-labeled)
- Backend API: `interface.ticketmgmt.dev`
  - `GET /info/{merchant_id}/schedule/{unix_start}/{unix_end}` → `[{stamp, qty, pid}]`
  - `GET /info/{merchant_id}/overrides/{date}/{date}` → override exceptions
- Merchant ID: `DSLVFD8QBSNR8`
- SKU pattern: `{pid}{ticket_type}{unix_timestamp}` e.g. `335ADULT1782475200`

### Payment Processor: PayPal + Braintree (to be replaced with Stripe)

- PayPal client ID: `AeL0LB8bjah6qzZVIETJtMj1I2PF2_eoMlxOwu4LhEsUJNLmtsjCDlOK2-zooT2pkBTQzbbwadv5-_6Z`
- Braintree merchant ID: `t6g6m9z83cd7ykhp`, environment: production
- Payee: `neil@lauraleeyour-domain.com`

### Current Pricing (observed from HAR)

- Adult ticket: **$68.00**
- Capacity observed: 22 tickets on one transaction (boat holds ~80)
- No line-item platform fees visible to consumer — ticketmgmt takes cut server-side

---

## Target Architecture

### Payment Stack: Stripe Connect (Destination Charges)

- Client connects their Stripe account via Connect onboarding
- Client is Merchant of Record on all charges
- `application_fee_amount` = 150 cents ($1.50) per ticket, collected at checkout
- Use `/v1/payment_intents` with `transfer_data.destination` — NOT the legacy `/v1/charges`
- Stripe processes at 2.9% + $0.30 per transaction

### Frontend: React Native (cross-platform iOS/Android + web)

- Expo managed workflow for faster iteration
- Shared codebase for consumer app + mate check-in app
- Offline-first for check-in (manifest cached at app open, syncs when connectivity returns)

### Backend: Next.js API Routes (Vercel serverless)

- All backend logic lives in `apps/web/src/app/api/` — no separate server
- Stripe webhook handler (`payment_intent.succeeded`, `payment_intent.canceled`)
- Boarding passes are printable web pages at `/boarding/[bookingId]` — no PDF generation
- QR payload encoded per ticket (bare UUID for now; HMAC signing before launch)

### Database: PostgreSQL

- Tables to design: `trips`, `vessels`, `products`, `schedules`, `bookings`, `tickets`, `payments`, `check_ins`, `users`
- Stripe `payment_intent_id`, `transfer_id`, and `application_fee_amount` stored on `payments`

---

## Check-In System

### User-Facing (at time of booking confirmation)

- QR code in confirmation email + SMS (encodes booking ID)
- 6-digit confirmation code (fallback for no-QR)
- "Print This" button in confirmation email for non-smartphone users

### Mate-Facing App (tablet at gangway)

- Today's manifest loaded + cached offline at app open
- Large scan button → camera reads QR → green ✓ / red ✗ + passenger name
- Name search fallback (last name lookup)
- Manual override ("Check in anyway" + note field) for walk-ups
- Running count display: "34/80 checked in"
- One-tap PDF manifest print (emergency clipboard fallback)

### Check-In Tier Priority (build order)

1. PDF manifest print (day one)
2. Name search check-in (day one — replaces clipboard)
3. QR in confirmation email (ships with booking flow)
4. Mate scan UI (React Native camera screen)
5. Offline sync (manifest cache + event queue)

### Hardware per Boat (~$255 one-time)

- Samsung Galaxy Tab A9 (~$200)
- Tera HW0002 Bluetooth barcode scanner (~$30)
- Weatherproof case (~$25)
- Mate's phone hotspot (no marina WiFi dependency)

---

## Key Decisions Already Made

- ✅ Stripe Connect over PayPal/Braintree (platform fee architecture, better DX)
- ✅ React Native over separate iOS/Android codebases
- ✅ Offline-first check-in (marina WiFi is unreliable)
- ✅ $2.50 flat fee per ticket (not percentage) — aligns incentives with client
- ✅ Client owns the Stripe merchant account — developer collects only the platform fee
- ✅ PDF manifest as permanent fallback — clipboard never fully disappears
- ✅ Deploy to client's own Vercel + Railway accounts — they control infrastructure
- ✅ $20,000 upfront build fee + 12-month minimum term
- ✅ On termination: client keeps last deployed version fee-free, per-ticket fee stops

---

## Competitive Landscape

- **ticketmgmt.dev** — incumbent, opaque pricing, PayPal/Braintree stack, client has zero data portability or ownership
- **GoFish.Rocks** — $1.50/passenger flat, fishing-specific, bootstrapped side project of a Ventura CA dev shop, no infrastructure ownership for client, does have offline check-in
- **FareHarbor** — ~$4.08/ticket (~6%), largest player, 1000+ reviews, has offline check-in + manifest app, BUT they are Merchant of Record (not client), generic platform not fishing-specific, ~$32k/season at Captree volume

---

## Current Status

Steps 1–6 of the build order are complete. See `CLAUDE.md` for the authoritative current state, remaining gaps, and next steps.

**Completed:** Schema + migrations, seed data, web booking flow (calendar → cart → Stripe PaymentElement → boarding passes), Stripe webhooks, Resend confirmation email, Expo consumer app (Trips + Tickets + Checkout tabs), admin dashboard (auth, trips list, trip cancellation, manifest, per-ticket refund, revenue reporting, capacity edit).

**Next:** Mate check-in app (step 8).

---

## Incumbent API — Key Findings (from HAR analysis)

- `GET /info/{merchant_id}/boats` → 4 boats with ids, names, hex colors
- `GET /info/{merchant_id}/` → all products (trip types) with schedList, boatId, fish type, pricing ref
- `GET /info/{merchant_id}/tickets` → reusable price configs (named by pattern e.g. "68/40" = adult/child)
- `GET /info/{merchant_id}/schedule/{unix_start}/{unix_end}` → `[{stamp, qty, pid}]` — remaining seats per trip instance
- `GET /info/{merchant_id}/overrides/{date}/{date}` → cancellations + capacity overrides per instance
- `GET /info/{merchant_id}/config` → email branding, terms, notify number
- Departure time hacks: `:01`, `:02`, `:03` minute suffixes disambiguate multiple products at same hour on same boat — not needed in our materialized trips model
- `qty` in schedule response = remaining available tickets (not capacity)

## File Notes

- `captree_com.har` — full checkout flow (101 requests, PayPal order ID `1RV88413A13388009`)
- `captree-6-23.com.har` — calendar page, contains full API responses for all boats/products/schedule/overrides
