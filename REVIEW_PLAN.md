# REVIEW_PLAN.md

## 1. Repo at a glance
- About 37.6k lines of tracked TS/TSX, including about 8k lines of tests.
- pnpm + Turborepo monorepo. Next.js 14 on Vercel serverless, Neon Postgres, Drizzle ORM, Stripe Connect, and Expo for the mobile apps.
- Two deploy modes share one codebase. In single-deploy mode the `OPERATOR_ID` env var sets the operator. In centralized mode, Edge middleware looks the hostname up in the `domains` table.
- Out of scope: `docs/`, `screenshots/`, `.har`/`.dump` files, `jscpd-report/`, notes files, and generated `packages/db/migrations/schema.ts` / `relations.ts`.

## 2. Areas

| # | Area | Path(s) | Size | What it does | Test coverage |
|---|------|---------|------|--------------|---------------|
| A | **Booking creation** | `apps/web/src/app/api/bookings/route.ts` (513), `bookings/[bookingId]/extend-hold`, `bookings/confirmation/[code]/calendar` | ~640 | Validates the cart (Zod), holds seats with `FOR UPDATE`, creates the booking, items and tickets, and creates the Stripe PI outside the transaction. If PI creation fails, it compensates. All of this is inline, not yet a domain module. | Integration: `bookings.test.ts` (511), extend-hold, confirmation-calendar |
| B | **Stripe webhook + handlers** | `api/webhooks/stripe/route.ts`, `lib/webhooks/*` (4 handlers), `lib/bookings/get-confirmed-booking.ts`, `lib/notifications/send-confirmation-email.ts` | ~540 | Verifies the signature, then handles PI succeeded/canceled, charge refunded and dispute created. Each handler has idempotency guards and restores seats. | Per-event integration tests. `get-confirmed-booking` has no direct test. |
| C | **Cancellation & refunds** | `lib/bookings/cancel.ts`, `admin/trips/[tripId]/cancel`, `admin/tickets/[ticketId]/refund` | ~400 | Trip cancellation in one atomic transaction (void tickets, reverse fees, restore seats) plus per-ticket refunds. | Route tests. `cancel.ts` is only exercised through routes. |
| D | **Crons & fee lifecycle** | `api/cron/*` (3), `lib/cron-auth.ts`, `lib/settle-trips.ts`, `lib/demo-reset.ts`, `admin/revenue` | ~440 | Expires pending holds, sends trip reminders, resets demo data, and moves fees from held to earned. `vercel.json` currently runs these daily (Hobby plan). | Tests for expire, reminders and reset-demo. `settle-trips` has a unit test. |
| E | **Tenant resolution & operator isolation** | `middleware.ts` (51), `lib/operator.ts` (95), `lib/env.ts`, `instrumentation.ts`, `platform/*` routes + `lib/platform-session.ts` | ~350 + every query | Maps host to `x-operator-id`, and `getOperatorContext` reads it. The `/platform` and `/api/platform` paths skip resolution. Isolation also depends on every tenant query using `eq(operatorId)`, across ~49 routes. | **No tests for middleware or operator.ts.** Route tests inject the header directly. |
| F | **Auth (3 audiences + platform)** | `lib/session-factory.ts`, `session.ts`, `customer-auth.ts`, `mate-auth.ts`, `rate-limit.ts`, `api/auth/*`, `api/mate/auth`, `api/admin/auth/*`, `api/platform/auth` | ~620 | Customer email OTP, mate PIN, admin staff session and platform secret. HMAC tokens carry an `aud` claim. Rate limiting is backed by Postgres. | Unit tests for customer and mate auth, route tests, rate-limit smoke test. `session-factory` and `rate-limit` are only covered indirectly. |
| G | **Mate/check-in API** | `api/mate/*` (manifest, checkins, trips, capacity, report) | ~540 | Serves the offline manifest, syncs check-in batches, edits capacity and posts reports from the boat. | Route tests for each endpoint |
| H | **Admin API (settings/trips/schedules)** | `api/admin/**` excluding C, and `lib/trip-materialization.ts` | ~1,500 | CRUD for vessels, products, staff, schedules and operator settings, plus trip lists, today view and check-ins. Saving a schedule materializes trips. | Route tests for most endpoints. `trip-materialization` is indirect only. |
| I | **Stripe Connect onboarding** | `api/stripe/connect/start`, `callback` | ~140 | OAuth/account-link flow that stores `stripeAccountId`. | Route tests |
| J | **DB schema & migrations** | `packages/db/src/schema.ts` (578), `migrations/*.sql` (0000–0013), seeds (~1.7k) | ~2.3k src | Single source of truth for the schema: constraints, indexes, enums and unique keys such as `(schedule_id, departure_date)`. | vitest config exists. Mostly exercised through web integration tests. |
| K | **Web booking UI** | `components/BookingCalendar/*` (useCart 270), `SailingsSection`, `cart/`, `checkout/` (CheckoutForm 408, CheckoutClient), `boarding/[bookingId]`, `booking/confirmation`, `(public)/page.tsx` | ~3k | Calendar, cart state, Stripe Elements checkout, confirmation page and printable boarding passes. | Playwright `booking-flow.spec.ts` only |
| L | **Admin UI** | `app/admin/**` pages, `components/admin/merchant/*` | ~5k | Merchant-style dashboard, settings wizard, manifest, revenue and money pages. Recently redesigned. | Playwright `admin.spec.ts` |
| M | **Mobile – mate app** | `apps/mobile/app/(mate)/*` (manifest 879), `lib/mate-store.ts`, `mate-auth*` | ~2k | Offline SQLite manifest, QR/keyboard check-in, queued sync, report posting. | Lib unit tests only (mate-store, sync-check-ins, mate-auth). Screens have no tests. |
| N | **Mobile – consumer app** | `(tabs)/*`, `checkout.tsx` (508), `cart.tsx`, `boarding/[ticketId]`, `lib/wallet.ts`, `customer-auth*`, components | ~3.5k | Trip browsing, native checkout, offline ticket wallet, OTP account, push. | Lib unit tests (wallet, customer-auth). Screens have no tests. |
| O | **Notifications & misc lib** | `lib/email.ts` (173), `push.ts`, `posthog.ts`, `date-et.ts`, `format.ts`, reports API + Blob upload | ~550 | Transactional email, Expo push, analytics, ET date math, and fishing reports with photo upload. | Report route tests. `date-et` and `format` have no unit tests. |
| P | **Shared packages & CI** | `packages/utils` (32), `types` (3), `design` (119), `.github/workflows/*`, `vercel.json`, `pnpm-workspace.yaml` | small | Validation schemas, tokens, CI gates, the migrate-on-build step and dependency overrides. | utils has tests |

## 3. Risk assessment

Risk is scored on three factors: **money/data impact**, **centrality** (how many paths depend on it) and **test gap**.

| Rank | Area | Why |
|------|------|-----|
| 1 | **A. Booking creation** | This is the biggest and most-changed API file (15 commits since August). The seat-locking transaction, the PI created outside the transaction, the compensation path and fee calculation all sit inline in one route. Any bug here oversells seats or loses money. |
| 2 | **E. Tenant isolation** | This is the most central area because every query depends on it, and it has **zero direct tests**. Route tests set `x-operator-id` by hand, so the middleware path itself is never exercised. Specific things to verify: whether a client-supplied `x-operator-id` is stripped on the skipped `/platform` / `/api/platform` paths, host-header trust, and that every tenant query across ~49 routes filters by operator. |
| 3 | **B. Stripe webhook** | Money-critical and asynchronous. Duplicate or out-of-order delivery interacts with the cron (the earlier H1 bug came from exactly this). `get-confirmed-booking` has no direct test. |
| 4 | **C. Cancellation/refunds** | Atomicity invariant, Stripe refunds combined with DB state, partial-refund edge cases. `cancel.ts` was extracted recently. |
| 5 | **D. Crons & fee lifecycle** | Races with the webhook, and the fee `earned` transition is a known unfinished gap. Revenue correctness depends on it. Schedules are currently daily only. |
| 6 | **F. Auth** | Four auth schemes, token audience separation and rate limits. Mostly tested, but `session-factory` and `rate-limit` edge cases (window boundaries, IP sourcing on Vercel) are only covered indirectly. |
| 7 | **M. Mate app offline sync** | Complex client state (879-line manifest screen), offline queue, idempotency of check-in replays, and the planned QR HMAC gap. Screens are untested. |
| 8 | **G. Mate API** | Needs to be reviewed together with M, because the sync contract spans server and client. |
| 9 | **J. Schema/migrations** | Correctness of constraints and indexes backs up invariants that code relies on, and migrations run at build time. |
| 10 | **H. Admin API** | Large but mostly CRUD. Watch operator scoping and trip materialization (duplicates, date ranges, timezone). |
| 11 | **N. Consumer mobile** | Checkout and wallet. Mostly display logic over already-reviewed APIs. |
| 12 | **I. Stripe Connect** | Small, but an OAuth state/CSRF problem would let someone attach the wrong account. Quick review. |
| 13 | **K. Web booking UI** | Cart state (`useCart`) is high-churn. Money shown to users must match the server. |
| 14 | **O. Notifications/misc** | `date-et` timezone math feeds reminders and trip dates, so give it a focused look. The rest is low risk. |
| 15 | **L. Admin UI**, **P. Packages/CI** | Presentation, or small in size. CI and `vercel.json` get a quick pass for deploy safety. |

## 4. Proposed review order
Each pass follows one money or data flow from end to end, instead of going directory by directory.

1. **Foundations (E + J):** middleware, `operator.ts`, env and instrumentation, then `schema.ts` constraints. This sets the baseline for checking operator scoping in every later pass.
2. **Booking write path (A):** `bookings/route.ts`, extend-hold, confirmation.
3. **Payment lifecycle (B + D):** webhook and handlers, then the expire/reminder/settle crons, reviewed as one state machine. Race analysis goes here.
4. **Reversal paths (C):** `cancel.ts`, trip cancel, ticket refund, checked against the cancellation-atomicity invariant.
5. **Auth (F + I):** session factory, the three token audiences, rate limiter, platform auth, Stripe Connect OAuth.
6. **Boarding / check-in (G + M):** mate API and the mobile mate store and sync, reviewed as one contract, including the QR signing gap.
7. **Admin API (H):** settings CRUD and trip materialization, with a sweep for operator scoping.
8. **Clients (N, K):** consumer app checkout and wallet, then the web cart/checkout, confirming displayed money matches the server.
9. **Remainder (O, L, P):** `date-et`, email/push, admin UI, CI/deploy config.

For each pass, use the "Architecture Invariants" checklist in `CLAUDE.md`. Also cross-check `security-audit-2026-08-05.md` and `docs/architecture-review-findings.md` so issues that are already known and fixed aren't re-reported.

