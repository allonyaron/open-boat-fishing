# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**Pre-launch.** `openboatfishing.com` runs as a test-mode demo; the first live operator is a separate deployment.

**Where the work order is:** `CODE_REVIEW.md` → "Launch Blockers" → "Blockers, in fix order". It is the only work
order. The next thing to do is the first row without a ✅; the "Before a second operator" table follows it, and the
"Fix Roadmap" holds the post-launch phases. Design detail for rows marked `AR-n` is in `ARCHITECTURE_REVIEW.md`
(architecture and security review, 2026-11-16). Earlier narratives (`docs/build-status.md`, the Steps 1–11 list,
`docs/architecture-review-findings.md`, `docs/refactoring-backlog.md`) are history, not a plan.

**Each row is one branch and one PR** (see Git Workflow). When a row lands, mark it ✅ in its row with the PR number
and what was verified, and note anything left open in that row.

**Done so far (2026-11-18):** rows 1, 2b, 3, 4, 4b, 5, 6, 7, 8 (except its CHECK, open item 1), 10, 18, 19. **Next:** row 9 (`cancelTrip`, sends its refunds through `lib/payments/commands`), then row 11 (reads the Stripe event inbox). Small rows (8's CHECK, 21–25) can go in between.

**Deployment facts that are not in the tracker:** `DEMO_MODE=true` enables the demo banner, the nightly reset cron
(`/api/cron/reset-demo-data`, not registered in `vercel.json` on Hobby) and the "Clear demo customers" button;
`vercel.json` runs only two daily crons on Hobby (expiry at 02:00, reminders at 09:00 UTC); `CRON_SECRET` must be set
in Vercel; EAS store submission is not done; SMS (Twilio) is not wired.

## Known Tech Debt (pre-launch, not blocking dev)

- **QR signing** — `tickets.qrPayload` is a bare UUID. Must be HMAC-signed with a per-operator secret before launch. Mate app must validate offline against the cached manifest.
- **Webhook fee transitions** — `earned` still never transitions. Needs the lazy sail-signal check on revenue report render. Revenue reporting is blocked until this is built.
- **Weekend/weekday pricing** — `schedule_prices` table exists (migration `0002`). Seed data not yet updated with an actual weekday/weekend price split.
- **Holiday pricing** — `holiday_dates` table exists (migration `0002`). No booking logic yet; holidays should resolve to the weekend schedule's price.

## What This Is

A platform for party fishing boat operators. Two deployment models coexist:

- **Single-deploy (enterprise/white-label):** Each operator gets their own Vercel + Neon Postgres deployment. One `operators` row per database. Set `OPERATOR_ID` env var — middleware short-circuits the DB lookup. Onboarding = fork repo + configure env vars + deploy (~2–3 hours).
- **Centralized (platform mode):** One shared Vercel + Neon deployment. Multiple operators in the same database, all queries scoped by `operator_id`. Hostname → operator resolved via `domains` table in Edge middleware. New operators created via `/platform` (gated by `PLATFORM_SECRET`). Stripe Connect Destination Charges — each operator has their own connected account.

See `docs/centralized-architecture.md` for architecture details and `docs/competitive-position.md` for market context.

## Monorepo Structure

```
open-boat-fishing/
  apps/
    web/        # Next.js 14 App Router — marketing + booking UI + admin dashboard + API routes
    mobile/     # Expo (managed) — two apps from one codebase (consumer + mate)
  packages/
    db/         # Drizzle ORM schema + migrations (shared source of truth)
    design/     # Shared design tokens (@openboat/design) — colors, typography, spacing
    types/      # Shared TypeScript types
    utils/      # QR gen, Zod validation schemas
  .github/
    workflows/  # CI: web-checks.yml, mobile-checks.yml, mobile-preview.yml, mobile-release.yml
```

**No separate API server.** All backend logic lives in Next.js API routes (`apps/web/src/app/api/`), deployed as Vercel serverless functions.

## Build Order

1. ✅ Monorepo setup → DB schema → Drizzle migrations
2. ✅ Schema additions → migration `0001_nifty_maximus.sql` applied
3. ✅ Seed script → 157 dev trips across 4 vessels, capacity 29
4. ✅ Web BookingCalendar — month grid + day list, desktop toggle, bottom sheet ticket selector, cart bar
5. ✅ `/api/bookings`, `/api/webhooks/stripe`, Stripe Connect, ticket issuance
6. ✅ Cart → checkout → post-payment delivery screen → `/boarding/[bookingId]` boarding passes
7. ✅ Expo consumer app — Trips, Tickets (offline SQLite wallet), Checkout, Account (OTP), push notifications
8. ✅ Expo mate app — PIN auth, offline manifest, QR scanner + keyboard mode, check-in queue sync
9. ✅ Admin dashboard — staff auth, trips list, cancellation, manifest, per-ticket refund, revenue, capacity edit
10. ✅ Fishing reports — captain posts after each trip (web admin + mate app). Catch summary, fish counts, Vercel Blob photos. Public list + detail pages with ISR. Consumer app Reports tab. See `docs/build-status.md` for full detail.
11. ✅ (partial) Production infra — deploy safety gates landed: `/api/health` endpoint, migration-on-build (`vercel.json` buildCommand runs migrations before `next build`), CI smoke test. Remaining: DNS migration → SEO → load test (k6) → go live

## Key Architecture Decisions

**Always scope every DB query to `operator_id`.** Never build cross-operator features.

**Seat inventory:** `FOR UPDATE SKIP LOCKED` on seat decrement — never application-level checks.

**Payments:** Stripe Connect Destination Charges. Use `/v1/payment_intents`, NOT `/v1/charges`. Platform fee = `application_fee_amount: 150` ($1.50 per ticket).

**Fee lifecycle:** `held` at charge time → `earned` after `departure + settle_grace_hrs` (default 48h) → `reversed` on any cancellation. Revenue reporting counts only `WHERE fee_status = 'earned'`. See `docs/fee-mechanism-decision.md`.

**Auth:** `customers` (email OTP) and `staff` (PIN) are separate tables with incompatible auth. Never merge into one `users` table.

**QR codes:** Must encode a cryptographically signed value (HMAC of ticket ID + per-operator secret), not a bare UUID. A guessable ID lets someone forge a pass.

**Boarding passes:** Printable web pages with `@media print` + `print-color-adjust: exact`. No Puppeteer, no server-side PDF. `window.print()` handles Save-as-PDF.

**Trip materialization:** On schedule save — write all `trips` rows for the full date range immediately. Use `(schedule_id, departure_date)` unique constraint to prevent duplicates on re-run.

**Cancellation:** a booking is cancelled in one atomic transaction (tickets out of service, fees reversed, seats back, status set), and its refunds are queued in that transaction. A trip cancel first closes the trip, then cancels its bookings one by one (see Architecture Invariants). See `docs/data-model.md` for the full status transition diagram.

**Analytics:** PostHog is wired into the booking funnel (BookingCalendar, CheckoutForm, CheckoutClient) and the `payment_intent.succeeded` webhook. `src/lib/posthog.ts` is the server-side client; `src/components/PostHogProvider.tsx` wraps the app for client-side events.

See `docs/data-model.md` for full schema, `docs/booking-requirements.md` for booking flow decisions, `docs/incumbent-system.md` for migration context.

## Architecture Invariants

Hard rules — a violation is a bug, not a style issue. Use these as a checklist when reviewing any API route or DB query.

**Operator isolation**
- Operator ID comes only from `getOperatorId(req)` / `getOperatorContext(req)` (API routes) or `getOperatorRecord()` (Server Components) — never from the request body or query string.
- Every query on a tenant table (`bookings`, `tickets`, `booking_items`, `trips`, `vessels`, `products`, `customers`, `magic_link_otps`, `schedules`, `fishing_reports`) must include `eq(table.operatorId, operatorId)`. A missing filter leaks data across operators.

**Seat inventory**
- Only `lib/inventory/seats.ts` writes `trips.seats_remaining` or `trips.capacity` (`takeSeats`, `giveBackSeats`, `giveBackSeatsForTickets`, `recountSeats`, `setTripCapacity`). Each change is SQL arithmetic under the trip lock and writes a `capacity_changes` ledger row. No read-check-write at the application level.
- Seats come back only for tickets `moveTickets` just moved (`giveBackSeatsForTickets`), never from a caller's own count, and never on a cancelled trip.

**Status transitions**
- `bookings.status` changes only through `transitionBookings` (`lib/bookings/status.ts`) and `trips.status` only through `transitionTrips` (`lib/trips/status.ts`): a transition table and one conditional UPDATE each. Act only on the ids they return.

**Payments**
- Use `stripe.paymentIntents.create()` with `transfer_data.destination` and `application_fee_amount`. Never `stripe.charges.create()`.
- Stripe PI creation lives outside the booking transaction. On PI failure, restore seats and cancel the booking in a new atomic transaction before returning an error.

**Auth and token audiences**
- Customer tokens (`aud:"customer"`) and mate tokens (`aud:"mate"`) are verified by separate functions (`verifyCustomerToken` / `verifyMateToken`). Never use one to verify the other.
- `customers` and `staff` are separate tables with separate auth paths. Never query one as a fallback for the other.
- Every auth endpoint (`/api/auth/*`, `/api/mate/auth`) must call `checkRateLimit()` as the first operation, before any DB access.

**Webhook integrity**
- The Stripe webhook handler must call `stripe.webhooks.constructEvent()` with the raw (un-parsed) request body before reading any event data.
- Guard against duplicate delivery: check current booking/ticket status before applying any state transition. An already-cancelled booking must not be re-cancelled.
- Never trust `metadata.bookingId` alone: a `payment_intent.*` event acts on a booking only if the PI id equals the booking's stored PI (and, for succeeded, amount, currency and destination match). Events carrying `event.account` are ignored.
- Every Stripe event goes through the inbox (`lib/stripe-events/inbox.ts`): saved before it is acted on, processed once, and a handler returns an outcome (handled, ignored, needs_review) or throws to be retried. Handlers find bookings by `bookings.stripe_payment_intent_id`, never by metadata.
- Every refund goes through the outbox (`lib/payments/commands.ts`): `queueRefund` / `queueFeeRefund` in the transaction that changes the tickets, `sendCommand` after commit. Nothing calls `stripe.refunds.create` or `stripe.applicationFees.createRefund` directly.

**Cron security**
- Every `/api/cron/*` route must verify `Authorization: Bearer ${CRON_SECRET}` before any business logic. Return 401 immediately if missing or wrong.

**Ticket lifecycle**
- `tickets.status` is `held → live → refunded | disputed`, or `held → voided` when never paid. Only `moveTickets` in `lib/tickets/lifecycle.ts` changes it; it also writes `voided` and reverses the fee of a ticket leaving service.
- Only `live` tickets board, count as sold or earn the fee. Readers use `isLive` / `liveTicketCount` (`lib/tickets/queries.ts`) or `isTicketLive` (`lib/tickets/status.ts`), never `voided` alone. Capacity floors count `holdsSeat` (live, held and disputed).
- `voided` is kept in step with `status` (true unless held or live) until a later release drops it; `isLive` also requires it false for refunds made by code deployed before `status`.

**Cancellation atomicity**
- Full cancellation is one DB transaction: move the booking's tickets out of service through `moveTickets` (held → voided, live → refunded), give back seats for the tickets it moved through `giveBackSeatsForTickets`, then `transitionBookings(… → 'cancelled')`. No partial cancellation path.
- Trip cancellation is `cancelTrip` (`lib/bookings/cancel-trip.ts`), in two phases. Phase 1 commits the trip's `cancelled` status on its own, which stops sales. Phase 2 settles each booking on the trip in its own transaction, locking the booking first: an unpaid booking is cancelled on every trip it covers and its PaymentIntent cancelled after commit; a paid one has this trip's live tickets refunded, for everything left on the payment if no ticket holding a seat remains (and the booking is then cancelled). Phase 2 can run again: pressing cancel again or the expiry cron (`finishCancelledTrips`) finishes a cancellation that stopped partway.
- `payment_intent.succeeded` never confirms a booking that is cancelled or that is on a cancelled trip: it cancels it and refunds the payment in full.
- `tickets.price_cents` is what the ticket paid (net of any group discount); `list_price_cents` is the fare. Refunds pay `price_cents`; display uses `list_price_cents ?? price_cents`.

**Fee lifecycle**
- Fees are inserted as `fee_status = 'held'`. Only the fee-earn cron (or lazy earn on revenue report render) may transition them to `'earned'`, and only on live tickets. Revenue queries must filter `WHERE fee_status = 'earned'` — never count `'held'` fees — and count reversals only on tickets that were paid (refunded, disputed).

**QR codes** *(pre-launch gap — tracking in Known Tech Debt)*
- `tickets.qrPayload` must be an HMAC of `ticketId + per-operator secret`, not a bare UUID. Currently bare UUIDs. Must be fixed and the mate app updated to validate signatures before go-live.

## Git Workflow

- **Never commit to `main` directly.** All work, including docs and one-line fixes, goes on its own branch, named for the work: `fix/p2-1-departed-trips`, `infra/f1-15-preview-db`, `docs/…`, `refactor/…`, `design/…`. Use one branch per piece of work. Don't pile unrelated changes onto one branch.
- Push the branch, which creates a Vercel Preview with its own URL and its own Neon branch DB. Test there, then open a PR to `main`.
- Merging the PR is the only way to deploy to production (`openboatfishing.com`). Required checks: "Typecheck & Next.js Build", "Tests" (every vitest suite against a Postgres service + the booking flow and cart Playwright specs), and "Smoke Test (Vercel Preview)". The smoke test (`.github/workflows/smoke-test.yml`) runs on Vercel's `deployment_status` event, so it starts once the preview is ready, however long Vercel takes; it shows as "Expected" until then.
- **Migrations must be backward-compatible with the currently deployed code (expand, then contract).** A production build runs migrations before `next build`, so the old code serves traffic on the new schema until the deploy switches over. Add columns and tables first. Remove or rename only in a later deploy, once nothing reads the old shape.

## Commands

```bash
# Root
pnpm install                      # install all workspaces
pnpm dev                          # run all apps in parallel (Turborepo)
pnpm build                        # build all apps
pnpm typecheck                    # tsc across all packages

# Database (packages/db)
pnpm migrate                      # run Drizzle migrations against DATABASE_URL
pnpm db:studio                    # open Drizzle Studio (requires DATABASE_URL)
pnpm --filter @openboat/db generate   # generate migration from schema changes

# Schema docs (docs/schema/, generated by tbls — CI's "Schema Docs" job fails if stale)
# After any migration: migrate a scratch DB, regenerate, commit docs/schema/.
createdb obf_tbls && DATABASE_URL=postgres://localhost:5432/obf_tbls pnpm --filter @openboat/db migrate
SCHEMA_DOCS_DSN='postgres://localhost:5432/obf_tbls?sslmode=disable' tbls doc --rm-dist
dropdb obf_tbls

# Seed scripts (packages/db/src)
DATABASE_URL=... tsx src/seed-mate.ts           # create mate@example.com / PIN 1234
DATABASE_URL=... tsx src/seed-test-trip.ts      # ensure today has a scheduled trip
DATABASE_URL=... tsx src/seed-test-customers.ts # add 10 bookings (23 tickets) to today's trip
DATABASE_URL=... tsx src/seed-demo.ts           # seed MV Open Boat demo operator
DATABASE_URL=... tsx src/seed-trips-dev.ts      # seed dev trips (4 vessels, 157 trips)
DATABASE_URL=... tsx src/seed-sailed-trip.ts    # seed a past sailed trip for revenue testing
DATABASE_URL=... tsx src/seed-admin.ts          # create admin staff account
DATABASE_URL=... tsx src/seed-fishing-reports.ts <operator-slug> [--days=30] [--voice=logbook|hype] [--dry-run]  # reports for recent past trips

# Individual apps
pnpm --filter @openboat/web dev
pnpm --filter @openboat/mobile dev    # Expo dev server (use `-- --clear` to clear Metro cache)

# Playwright screenshot tests (requires dev server running on :3000)
node_modules/.bin/playwright test
DATABASE_URL=... tsx packages/db/src/seed-test-customers.ts  # seed fixture booking first for steps 08-09
# Screenshots land in screenshots/desktop/ and screenshots/mobile/
```

## Key Env Vars (non-obvious)

| Var                       | Where                          | Purpose                                                                                                                                    |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`          | `apps/web/.env.local` + Vercel | Signs mate tokens and customer tokens (HMAC-SHA256). Must be ≥ 32 chars.                                                                   |
| `CRON_SECRET`             | `apps/web/.env.local` + Vercel | Authenticates Vercel cron calls to `/api/cron/trip-reminders` and `/api/cron/expire-pending-bookings`. Add to Vercel env before deploying. |
| `EXPO_PUBLIC_APP_VARIANT` | `apps/mobile/.env.local`       | Set to `mate` to run/build the mate check-in app. Leave unset for consumer app.                                                            |
| `EXPO_PUBLIC_API_URL`     | `apps/mobile/.env.local`       | Override API host. In dev: `http://localhost:3000`. In production: operator's domain.                                                      |

## Dependency Overrides (pnpm-workspace.yaml)

**Do not remove these without testing.** All exist to prevent pnpm's non-flat `node_modules` from bundling duplicate copies of packages that register native view managers or hold singleton state.

- `react-native-screens: ~4.11.1` — Expo SDK 53 expects this. `4.25.x` uses a `CodegenTypes` namespace not exported by `react-native@0.79.6`, causing Metro to fail with "Unknown prop type" errors.
- `react: 19.0.0` / `react-dom: 19.0.0` — `react-native@0.79.6` bundles `react-native-renderer@19.0.0`; mismatched versions cause "Incompatible React versions" at runtime.
- `react-native-safe-area-context: ~5.4.0` — without this, `@react-navigation/bottom-tabs` pulls in 5.8.x, Metro bundles both, and the app crashes with "Tried to register two views with the same name RNCSafeAreaProvider".
- `react-native-gesture-handler: ~2.24.0` — same reason.
- `react-native-reanimated: ~3.17.5` — same reason.

The overrides alone are not sufficient — `metro.config.js` also has a custom `resolveRequest` that forces singleton resolution regardless of which pnpm store entry is doing the require. Both are needed together.
