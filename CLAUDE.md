# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**Steps 1–10 complete. All testing phases (0–6) complete. Step 11 (production infra) is in progress — first target is `openboatfishing.com` as combined production sandbox + public demo.**

**Centralized architecture work (items 1–8) complete.** The codebase now supports both single-deploy (per-operator `OPERATOR_ID` env var) and centralized multi-tenant (domain → operator_id via `domains` table + Edge middleware). See `docs/centralized-architecture.md` for the full work item list and design notes.

**Refactoring backlog (items 2–5 complete):** Session factory, `OperatorContext` helper, general env-var cleanup, and booking-cancel domain extraction all landed. Remaining: item 1 (full domain modules — booking creation still inline), item 2 partial (server-component `getOperatorRecord()` helper not yet added), item 6 (middleware caching — post-launch). See `docs/refactoring-backlog.md`.

See `docs/build-status.md` for the full per-step build narrative.

**openboatfishing.com deployment (Step 11a — in progress):** Code work landed; user infra provisioning (domain, Neon, Vercel Pro, Stripe test Connect) is the next unblock. See `docs/openboatfishing-demo-deploy.md` for the full deploy checklist. Demo operator is **MV Open Boat** (3 vessels, 6 products, schedules through 2035). `DEMO_MODE=true` env flag enables the yellow banner, the nightly reset cron (`/api/cron/reset-demo-data`, wipes bookings but preserves customers + fishing reports), and the "Clear demo customers" admin button in `/admin/settings`.

**Testing status:** All phases done. Phase 6 (mobile lib unit tests) complete — 51 tests, 97.97% line coverage, committed `ffea43f`. Maestro mobile E2E and BottomSheet extraction deferred until after launch.

**Security fixes — all complete (committed `424392e`):**

- ✅ **H1 (CRITICAL — money bug):** Cron skips bookings whose PI is `succeeded`/`processing`; webhook guards against already-cancelled bookings.
- ✅ **H2/H3:** Postgres-backed fixed-window rate limiter (`src/lib/rate-limit.ts`) on all auth routes — OTP request (20/hr IP + 5/hr email), OTP verify (10/15min email), mate PIN (5/15min email), admin login (10/15min IP).
- ✅ **H4:** In-memory `rlStore` replaced with Postgres rate limiter (durable across Vercel lambda instances).
- ✅ **H5:** Trip reminders window narrowed from `[+23h, +25h]` to `[+23h, +24h)` — exclusive upper bound tiles hourly cron runs with no overlap.
- ✅ **M4:** `POST /api/bookings` — Zod schema validates cart/email/tickets; IP rate limit (20/15min) blocks seat-hold DoS.
- ✅ **M6:** Audience separation — mate tokens embed `aud:"mate"`, customer tokens `aud:"customer"`; each verify function rejects the other type.
- ✅ **M8:** Webhook handles `charge.refunded` (full refund → void tickets, cancel booking, restore seats) and `charge.dispute.created` (void tickets to block boarding).
- ✅ **M9:** Startup env validation via `src/lib/env.ts` + `src/instrumentation.ts` — missing vars throw at boot, not at request time.
- ✅ **M10:** Push notifications fire when bookings expire (cron) or PI is cancelled (webhook).

**Known gaps blocking production (original list):**

- SMS not sent (Twilio TODO in webhook)
- QR payload is bare UUID — needs HMAC signing before launch
- Weekend vs. weekday pricing not modelled (schema change needed)
- `CRON_SECRET` env var must be added to Vercel before deploying (value in `apps/web/.env.local`)
- EAS build + store submission not done (configure Apple IDs in `eas.json submit.consumer`, then `eas submit`)
- `expire-pending-bookings` cron runs every 10 minutes — requires Vercel Pro. On Hobby plan, change schedule to `0 * * * *` (hourly) and widen `STALE_MINUTES` to 90

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
    types/      # Shared TypeScript types
    utils/      # QR gen, Zod validation schemas
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
11. **Next:** Production infra → DNS migration → SEO → load test (k6) → go live

## Key Architecture Decisions

**Always scope every DB query to `operator_id`.** Never build cross-operator features.

**Seat inventory:** `FOR UPDATE SKIP LOCKED` on seat decrement — never application-level checks.

**Payments:** Stripe Connect Destination Charges. Use `/v1/payment_intents`, NOT `/v1/charges`. Platform fee = `application_fee_amount: 150` ($1.50 per ticket).

**Fee lifecycle:** `held` at charge time → `earned` after `departure + settle_grace_hrs` (default 48h) → `reversed` on any cancellation. Revenue reporting counts only `WHERE fee_status = 'earned'`. See `docs/fee-mechanism-decision.md`.

**Auth:** `customers` (email OTP) and `staff` (PIN) are separate tables with incompatible auth. Never merge into one `users` table.

**QR codes:** Must encode a cryptographically signed value (HMAC of ticket ID + per-operator secret), not a bare UUID. A guessable ID lets someone forge a pass.

**Boarding passes:** Printable web pages with `@media print` + `print-color-adjust: exact`. No Puppeteer, no server-side PDF. `window.print()` handles Save-as-PDF.

**Trip materialization:** On schedule save — write all `trips` rows for the full date range immediately. Use `(schedule_id, departure_date)` unique constraint to prevent duplicates on re-run.

**Cancellation is one atomic transaction:** refund every ticket, reverse every fee, set status, fire notifications. See `docs/data-model.md` for the full status transition diagram.

See `docs/data-model.md` for full schema, `docs/booking-requirements.md` for booking flow decisions, `docs/incumbent-system.md` for migration context.

## Architecture Invariants

Hard rules — a violation is a bug, not a style issue. Use these as a checklist when reviewing any API route or DB query.

**Operator isolation**
- Operator ID comes only from `getOperatorId(req)` / `getOperatorContext(req)` (API routes) or `getOperatorRecord()` (Server Components) — never from the request body or query string.
- Every query on a tenant table (`bookings`, `tickets`, `booking_items`, `trips`, `vessels`, `products`, `customers`, `magic_link_otps`, `schedules`, `fishing_reports`) must include `eq(table.operatorId, operatorId)`. A missing filter leaks data across operators.

**Seat inventory**
- Seat decrements must use SQL arithmetic inside a `FOR UPDATE` transaction: `sql\`${trips.seatsRemaining} - ${count}\`` after `.for("update")`. No read-check-write at the application level.
- Seat restores (cancellation, Stripe PI failure) must also use SQL arithmetic in their own transaction.

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

**Cron security**
- Every `/api/cron/*` route must verify `Authorization: Bearer ${CRON_SECRET}` before any business logic. Return 401 immediately if missing or wrong.

**Cancellation atomicity**
- Full cancellation is one DB transaction: void all tickets, set `fee_status = 'reversed'` on all fees, restore seats via SQL arithmetic, set `booking.status = 'cancelled'`. No partial cancellation path.

**Fee lifecycle**
- Fees are inserted as `fee_status = 'held'`. Only the fee-earn cron (or lazy earn on revenue report render) may transition them to `'earned'`. Revenue queries must filter `WHERE fee_status = 'earned'` — never count `'held'` fees.

**QR codes** *(pre-launch gap — tracking in Known Tech Debt)*
- `tickets.qrPayload` must be an HMAC of `ticketId + per-operator secret`, not a bare UUID. Currently bare UUIDs. Must be fixed and the mate app updated to validate signatures before go-live.

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

# Seed scripts (packages/db)
DATABASE_URL=... tsx src/seed-mate.ts           # create mate@example.com / PIN 1234
DATABASE_URL=... tsx src/seed-test-trip.ts      # ensure today has a scheduled trip
DATABASE_URL=... tsx src/seed-test-customers.ts # add 10 bookings (23 tickets) to today's trip

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
