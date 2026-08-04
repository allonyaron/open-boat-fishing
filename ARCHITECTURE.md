# Fishing Boat Platform — Architecture & Project Plan

> **Historical planning document.** The task checklists and build order below reflect the original plan and are no longer maintained. See `CLAUDE.md` for current project status, build order, and architectural decisions. Factual corrections to the most important divergences are noted inline.

> **MVP target:** Captree / Blue Wave fleet (your-domain.com + your-domain.com)  
> **Platform goal:** Any fishing boat operator can use the same system. Adding a new customer = fork the repo, configure env vars, deploy to their own Vercel + Neon, point their domain. Same code, fresh database, ~2-3 hours of setup. No new code written.

---

## Operator & Vessel Model

```
operators                    ← one row per fishing boat business
  └── vessels                ← the boats owned by that operator
        └── products         ← trip types per vessel (Fluke, Night Stripers, etc.)
              └── schedules  ← recurring patterns (date range, days, time, capacity)
                    └── trips ← materialized individual departures
                          └── bookings ← customer purchases
                                └── tickets ← one per passenger
```

**Multi-vessel operators** get a combined fleet calendar (color-coded by boat, same as current your-domain.com) plus individual boat pages:
```
your-domain.com/calendar              ← all 4 boats, color-coded
your-domain.com/boats/blue-wave       ← single boat view + booking
your-domain.com/boats/blue-wave-express
```
**Single-vessel operators** just see a single schedule — no fleet calendar shown.

**Multi-domain per operator:** your-domain.com and your-domain.com are the same operator (same 4-boat fleet). Both domains route to the same operator record. Handled via domain → operator_id mapping in the platform config.

---

## Domain / URL Strategy

**Decided: Custom domain per operator.** Each operator's domain (e.g. `your-domain.com`) points directly at their own Vercel deployment. No platform subdomain. Each client owns their domain and DNS.

---

## Monorepo Structure (Turborepo)

```
open-boat-fishing/
  apps/
    web/        # Next.js 14 — marketing site + booking UI + admin dashboard + API routes
    mobile/     # Expo (React Native) — consumer app + mate check-in app
  packages/
    db/         # Drizzle ORM schema + migrations (shared source of truth)
    types/      # Shared TypeScript types (Trip, Booking, Ticket, etc.)
    utils/      # Shared logic (QR gen, Zod validation schemas)
```

> **No separate API server.** All backend logic lives in Next.js API routes deployed as Vercel serverless functions. Boarding passes are printable web pages (`/boarding/[ticketId]`) — no Puppeteer or PDF generation needed.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Web frontend | Next.js 14 (App Router) | SSG marketing, SSR schedule, CSR booking flow. One deploy covers marketing + booking + admin. |
| Styling | Tailwind CSS + shadcn/ui | Fast, polished, accessible, responsive |
| Mobile app | Expo (managed) + Expo Router | iOS, Android, optionally web from one codebase. Camera API for QR scan. |
| Offline storage | expo-sqlite + MMKV | Manifest cached at app open; check-in events queued when offline |
| Backend API | Next.js API routes (serverless) | Booking, Stripe webhooks, schedule queries — all Vercel serverless functions |
| Database | PostgreSQL | Relational integrity for bookings/tickets/payments |
| ORM | Drizzle ORM | Lightweight, type-safe, migrations-first. Schema in `packages/db`. |
| Payments | Stripe Connect (Destination Charges) | `application_fee_amount: 150` per ticket ($1.50). Client is Merchant of Record. |
| Email | Resend | Transactional email, React email templates |
| SMS | Twilio | QR + confirmation code at booking confirmation |
| QR codes | `qrcode` npm package | Encodes booking ID, generated server-side |
| Boarding passes | Printable web page (`/boarding/[ticketId]`) | CSS `@media print`, one ticket per page. Browser "Save as PDF" for downloads. |
| Hosting — web | Vercel | Next.js native, zero-config. Each client has their own Vercel project on their account. |
| Hosting — DB | Neon | Managed PostgreSQL (Postgres 18). Each client has their own Neon project on their account. Railway was the original plan; migrated to Neon. |
| DNS/CDN | Cloudflare | DNS migration, CDN, DDoS protection. Client owns their domain + DNS. |

---

## Feature Sections & Tasks

### Section 1 — Marketing Website
*New your-domain.com — replaces current static site*

- [ ] Hero section (boat photos, CTA "Book a Trip")
- [ ] Trip types overview (Half Day, 3/4 Day, Full Day, Night Fishing, Fluke)
- [ ] Fleet page (vessel details, capacity, amenities, photo gallery)
- [ ] Rates / pricing table
- [ ] Directions + parking map (Google Maps embed)
- [ ] FAQ
- [ ] Contact form
- [ ] SEO metadata + Open Graph tags
- [ ] Analytics (Google Analytics or Plausible)

### Section 2 — Booking Flow (Consumer Web)
*Core revenue-generating flow*

- [ ] Trip schedule / calendar view (loads from API)
- [ ] Trip detail page (date, time, available seats, price breakdown)
- [ ] Ticket quantity + type selector (Adult $68, Child, Senior)
- [ ] Contact info form (name, email, phone)
- [ ] Cart review with line items + $2.00 platform fee visible
- [ ] Stripe Elements (embedded payment form — no redirect)
- [ ] Booking confirmation page (QR code + 6-digit code displayed)
- [ ] Confirmation email (Resend) — QR code + "Print This" link
- [ ] Confirmation SMS (Twilio) — booking code + trip details

### Section 3 — Ticketing Backend
*Most complex section — drives everything else*

- [ ] PostgreSQL schema (`trips`, `vessels`, `products`, `schedules`, `bookings`, `tickets`, `payments`, `check_ins`, `users`)
- [ ] Schedule/availability API (`GET /schedule?start=&end=` → trips with seat counts)
- [ ] Booking creation API (validate availability, create pending booking, return PaymentIntent client secret)
- [ ] Stripe webhook handler (`payment_intent.succeeded` → confirm booking, issue tickets, trigger email/SMS)
- [ ] QR code generation per ticket (booking ID encoded)
- [ ] PDF manifest generation (Puppeteer → PDF, stored on S3/R2)
- [ ] Seat inventory management (atomic decrement on payment confirm, release on timeout/cancel)
- [ ] Refund API (Stripe refund + ticket void + booking status update)
- [ ] Schedule override API (cancel trip, capacity changes)
- [ ] Stripe Connect onboarding flow

### Section 4 — Mate Check-In App (React Native / Expo)
*Tablet-first, offline-first*

- [ ] PIN login screen
- [ ] Today's manifest screen (auto-loads + caches at app open)
- [ ] QR scanner screen (expo-camera + Bluetooth barcode scanner compatible)
- [ ] Scan result overlay: green ✓ / red ✗ + passenger name + booking details
- [ ] Name search fallback (last name lookup from cached manifest)
- [ ] Manual check-in override (note field for walk-ups, comps)
- [ ] Running count display ("34 / 80 checked in")
- [ ] One-tap PDF manifest print (AirPrint / share sheet)
- [ ] Offline event queue (check-in events stored locally, sync when back online)
- [ ] Sync indicator (offline mode + last sync time)

### Section 5 — Admin Dashboard
*Protected routes in Next.js web app (`/admin`)*

- [ ] Auth guard (admin-only JWT role)
- [ ] Trip management (create, edit, cancel trips)
- [ ] Schedule/capacity management (adjust seat limits, override exceptions)
- [ ] Booking list (search by name, date, confirmation code)
- [ ] Booking detail view (passenger info, tickets, payment, check-in status)
- [ ] Manifest viewer + print per trip
- [ ] Revenue overview (daily/weekly/monthly, platform fee collected)
- [ ] Payout tracking (Stripe Connect payouts to client)
- [ ] Refund initiation UI
- [ ] Waitlist management (optional)

### Section 6 — Infrastructure & DevOps

- [ ] Turborepo monorepo init + workspace configuration
- [ ] CI/CD pipeline (GitHub Actions → Vercel + Railway auto-deploy)
- [ ] Environment management (dev / staging / production)
- [ ] Drizzle migrations strategy
- [ ] Cloudflare DNS setup + your-domain.com migration
- [ ] Stripe webhook registration (prod + dev via Stripe CLI)
- [ ] Sentry error tracking (web + API + mobile)
- [ ] Rate limiting on booking API (prevent seat sniping)
- [ ] Load testing (k6) before launch

---

## Build Order

```
Phase 1 — Foundation
  Monorepo setup → DB schema → Drizzle migrations → Fastify scaffold → Auth

Phase 2 — Payments & Booking Core
  Stripe Connect onboarding → PaymentIntent API → Webhook handler
  → Ticket issuance → QR gen → Email/SMS confirmation

Phase 3 — Consumer Web
  Marketing pages → Trip schedule UI → Booking flow → Confirmation page

Phase 4 — Mate App
  Expo setup → Manifest screen + offline cache → QR scanner → Name search
  → Manual override → Offline sync

Phase 5 — Admin Dashboard
  Trip CRUD → Booking management → Manifest/PDF → Revenue reporting → Refunds

Phase 6 — Launch
  DNS migration → SEO → Perf audit → Load test → Go live
```

---

## Key Risks

1. ~~**Puppeteer on Railway**~~ — Not applicable. Boarding passes are printable web pages with CSS `@media print`. No Puppeteer, no Railway.
2. **Expo camera + Bluetooth scanner** — Most BT barcode scanners emulate keyboard input. Test early with Tera HW0002 to confirm it feeds a TextInput correctly.
3. **Stripe Connect onboarding** — Client must complete Stripe KYC themselves. Build a clear onboarding page; it's the one step you can't do for them.
4. **Seat inventory race conditions** — Solved: PostgreSQL `FOR UPDATE SKIP LOCKED` row lock on seat decrement inside a transaction. No application-level checks needed.

---

## Reference

- See `CONTEXT.md` for full business model, incumbent stack details, Stripe architecture decisions, and check-in tier priority.
- HAR file of full ticketmgmt.dev checkout flow: `captree_com.har`
- Incumbent merchant ID: `DSLVFD8QBSNR8`
- Adult ticket price: $68.00 | Platform fee: $2.00/ticket
