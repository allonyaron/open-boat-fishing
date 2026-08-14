# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

**Steps 1–9 complete. Step 10 (fishing reports) is next.**

See `docs/build-status.md` for the full per-step build narrative.

**Known gaps blocking production:**
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

A **multi-tenant codebase, single-tenant deployment** platform for party fishing boat operators. Each client gets their own dedicated Vercel + Neon Postgres deployment. Their database has exactly one row in `operators`.

**Onboarding a new operator = fork repo + configure env vars + deploy. ~2-3 hours. No shared infrastructure.**

See `docs/competitive-position.md` for market context.

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
10. **Next:** Fishing reports — captain posts after each trip (web admin + mate app). Fields: date/vessel/trip auto-populated, catch summary, photos, structured fish counts. Displayed publicly on marketing site + consumer app.
11. Production infra → DNS migration → SEO → load test (k6) → go live

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

| Var | Where | Purpose |
|-----|-------|---------|
| `SESSION_SECRET` | `apps/web/.env.local` + Vercel | Signs mate tokens and customer tokens (HMAC-SHA256). Must be ≥ 32 chars. |
| `CRON_SECRET` | `apps/web/.env.local` + Vercel | Authenticates Vercel cron calls to `/api/cron/trip-reminders` and `/api/cron/expire-pending-bookings`. Add to Vercel env before deploying. |
| `EXPO_PUBLIC_APP_VARIANT` | `apps/mobile/.env.local` | Set to `mate` to run/build the mate check-in app. Leave unset for consumer app. |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/.env.local` | Override API host. In dev: `http://localhost:3000`. In production: operator's domain. |

## Dependency Overrides (pnpm-workspace.yaml)

**Do not remove these without testing.** All exist to prevent pnpm's non-flat `node_modules` from bundling duplicate copies of packages that register native view managers or hold singleton state.

- `react-native-screens: ~4.11.1` — Expo SDK 53 expects this. `4.25.x` uses a `CodegenTypes` namespace not exported by `react-native@0.79.6`, causing Metro to fail with "Unknown prop type" errors.
- `react: 19.0.0` / `react-dom: 19.0.0` — `react-native@0.79.6` bundles `react-native-renderer@19.0.0`; mismatched versions cause "Incompatible React versions" at runtime.
- `react-native-safe-area-context: ~5.4.0` — without this, `@react-navigation/bottom-tabs` pulls in 5.8.x, Metro bundles both, and the app crashes with "Tried to register two views with the same name RNCSafeAreaProvider".
- `react-native-gesture-handler: ~2.24.0` — same reason.
- `react-native-reanimated: ~3.17.5` — same reason.

The overrides alone are not sufficient — `metro.config.js` also has a custom `resolveRequest` that forces singleton resolution regardless of which pnpm store entry is doing the require. Both are needed together.
