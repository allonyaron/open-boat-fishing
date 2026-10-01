# Code Review

Review passes follow the order in `REVIEW_PLAN.md` §4. Each pass was cross-checked against
`security-audit-2026-08-05.md` and `docs/architecture-review-findings.md`. Items those documents
already track are not repeated, unless the current code contradicts their "fixed" status.

---

## Pass 1: Foundations (E + J)

**Scope:** `apps/web/src/middleware.ts`, `lib/operator.ts`, `lib/env.ts`, `instrumentation.ts`,
`lib/platform-session.ts`, `app/api/platform/*`, `app/platform/*`, `api/health`, `lib/cron-auth.ts`,
`lib/session.ts` / `session-factory.ts` (only as far as they decide the operator),
`packages/db/src/schema.ts`, `packages/db/migrations/*`, `apps/web/vercel.json`.

**Summary:** Nothing Critical is confirmed in this pass. One High is possible and needs
confirmation (F1-2: do the crons get a 404 on the Vercel host?). The tenant-resolution core is sound.
Most findings are about paths that depend on a tenant `domains` row when they shouldn't, the
platform console, and schema-level backstops that are missing.

### What's clean (verified)

- **Header overwrite.** Both the `OPERATOR_ID` branch and the domain-lookup branch set `x-operator-id`
  through `withOperatorId()`, so a client-supplied value can't survive on resolved paths
  (`middleware.ts:8-12, 30, 46`). The earlier P0 ("middleware trusts client header") really is fixed.
- **Host handling.** The hostname is lowercased and its port stripped (`middleware.ts:36`). Host-header
  spoofing gains nothing: Vercel routes by Host, so a forged Host lands on the same tenant as visiting
  that domain directly.
- **Boot checks.** `OPERATOR_ID` is checked against the DB at boot (`instrumentation.ts:11-25`). The env
  schema fails fast (`env.ts`).
- **Cron auth.** `verifyCronAuth` is length-checked and timing-safe (`cron-auth.ts`).
- **No cross-tenant cache poisoning.** Every page that reads the operator from headers is
  `force-dynamic` (the root layout, `(public)` layout, home, book, both fishing-report pages and
  status), and there is no `unstable_cache` or `fetch` cache anywhere. One tenant's render can't be
  cached and served on another tenant's domain.
- **Customer and mate tokens.** Both are bound to the resolved host operator (`customer-auth.ts:57-60`,
  `mate-auth.ts:59-60`).
- **Schema basics.** The unique keys the code relies on exist: `trips(schedule_id, departure_date)`,
  `check_ins(ticket_id)`, `bookings.stripe_payment_intent_id`, `bookings.confirmation_code` (0011),
  `payments.booking_id`, `customers(operator_id, email)`, `staff(operator_id, email)` and
  `domains.domain`. The `seats_remaining >= 0` CHECK is live in the DB (0009).

### Operator-source baseline (for later passes)

The API routes get their operator ID from four sources:

| Source | Routes |
|---|---|
| `x-operator-id` header (`getOperatorId` / `getOperatorContext`) | `bookings`, `bookings/[id]/extend-hold`, `bookings/confirmation/[code]/calendar`, `trips`, `reports`, `reports/[id]`, `auth/request`, `auth/verify`, `admin/auth/login`, `mate/auth`, `cron/reset-demo-data` |
| Token checked against the header (`requireCustomer` / `requireMate`) | `account/*`, `push/register`, `mate/*`, `reports/upload-photo`, `reports/upload` (mate branch) |
| Admin iron-session `session.operatorId`, **not** checked against the header | every `admin/**` route except login, plus `stripe/connect/*` and `reports/upload` (admin branch) |
| None / cross-tenant by design | `webhooks/stripe` (routes by PI → booking), `cron/expire-pending-bookings`, `cron/trip-reminders`, `platform/*`, `health` |

The per-query `eq(table.operatorId, …)` sweep across these ~49 routes is deferred to Passes 2–7, as
the plan says. Each pass checks the routes it owns.

### Findings

#### F1-1 · Medium · Stripe webhook availability depends on one tenant's `domains` row

- **Where:** `apps/web/src/middleware.ts:18-24` (skip list), `:42-44` (404 on unknown host).
  The webhook endpoint is registered at `https://openboatfishing.com/api/webhooks/stripe`
  (`docs/openboatfishing-demo-deploy.md:43`).
- **What's wrong:** The skip list doesn't exempt `/api/webhooks/stripe`, so in centralized mode a
  webhook call only works if its Host is a row in `domains`. The one platform-wide Connect webhook
  endpoint currently rides on the demo tenant's domain. The webhook handler never uses the resolved
  operator; it routes by `event.account` and the PI → booking lookup.
- **Why it matters:** Suppose the demo operator's domain rows are deleted, renamed or moved, or the
  platform later registers the endpoint on a platform hostname (such as `*.vercel.app` or
  `api.<platform>`). Then every operator's `payment_intent.succeeded` returns 404. Customers are
  charged but their bookings stay `pending`. Since the H1 fix, the expiry cron deliberately skips
  succeeded PIs, so those bookings stay `pending` for good: no boarding passes, a manifest that's wrong,
  and the DB out of sync with Stripe. Stripe retries for 3 days and then gives up.
- **Suggested fix:** Add `/api/webhooks/` to the middleware skip list, and delete any inbound
  `x-operator-id` on that branch (see F1-3). Add a middleware unit test asserting the webhook
  path is never 404'd.

#### F1-2 · Medium (latent; High once `OPERATOR_ID` is removed) · Crons will 404 in centralized mode

- **Where:** `middleware.ts:18-24, 36-44`; `vercel.json:3-5`; `app/api/cron/reset-demo-data/route.ts:30`.
- **Evidence (2026-09-28, manual Run of both crons on production):** Vercel Cron sends
  `Host: open-boat-fishing-fmwyyvg6k-open-boat-fishing.vercel.app` (user agent `vercel-cron/1.0`). That
  is a **per-deployment** hostname: it changes on every deploy, so it can never usefully be a row in
  `domains`. Both runs passed the middleware (trip-reminders returned 200, the middleware step for
  expire-pending-bookings returned 200). That can only happen if the `OPERATOR_ID` env var is set,
  because it skips the domain lookup. So the crons work today only because the demo runs in
  single-deploy mode. (The expire-pending-bookings row showed status `---` even though its function
  finished in 1.24s. That looks like a Vercel log-display quirk, possibly related to the route's use of
  `waitUntil`; it is not a middleware rejection.)
- **What's wrong:** `/api/cron/*` isn't exempt from tenant resolution either. Once `OPERATOR_ID` is
  removed to host a second operator, the per-deployment host won't match any `domains` row, and both
  scheduled crons will get the middleware's 404 before `verifyCronAuth` runs. `expire-pending-bookings` and `trip-reminders` don't need a tenant:
  both already iterate over every operator (`expire-pending-bookings/route.ts:41`,
  `trip-reminders/route.ts:26`).
- **Why it matters:** If this is happening, abandoned holds never release their seats, so inventory
  shows as sold out and the operator loses sales. The `rate_limits` purge also never runs, and
  reminders never go out. The failure is silent: the only sign is 404s in Vercel's cron log.
- **Suggested fix:** Exempt `/api/cron/` in the middleware, as in F1-1, **before** removing
  `OPERATOR_ID` or onboarding a second operator. **Caveat:** `reset-demo-data` reads
  `getOperatorId(req)` (`route.ts:30`), so it would lose its operator once exempt. Give it an explicit
  source, such as a `DEMO_OPERATOR_ID` env var or resolving the demo operator by slug, which also makes
  it safe on a multi-operator deployment.

#### F1-3 · Low · Client-supplied `x-operator-id` isn't stripped on skipped paths

- **Where:** `middleware.ts:18-24` returns a bare `NextResponse.next()`. The root layout
  `app/layout.tsx:44` calls `getOperatorRecord()`, and that layout renders on `/platform` pages.
- **What's wrong:** On `/platform*`, `/api/platform*` and `/api/health`, a request carrying
  `x-operator-id: <any uuid>` passes it through unchanged. The root layout then loads that operator's
  record and renders its `name` into the page chrome.
- **Why it matters:** Today the effect is cosmetic: no platform route reads the header. But
  the comment on `middleware.ts:34-35` claims the client header is "never trusted", and on these
  paths that isn't true. Any future platform code, or a newly exempted path (F1-1/F1-2), that calls
  `getOperatorId()` would trust an attacker-controlled tenant.
- **Suggested fix:** On the skip branch, build `new Headers(request.headers)`, delete
  `x-operator-id`, and pass the result to `NextResponse.next({ request: { headers } })`. Also use exact
  prefix matching (`pathname === "/platform" || pathname.startsWith("/platform/")`) so `/platformX`
  isn't swept in.

#### F1-4 · Medium · Operator provisioning isn't transactional, and unique violations surface as 500

- **Where:** `app/api/platform/operators/route.ts:63-100`.
- **What's wrong:** Three sequential inserts (operators → domains → staff) run with no transaction. The
  domain-uniqueness check (`:64-71`) is a read-then-write. `slug` is `UNIQUE` (`schema.ts:51`), but
  collisions aren't handled: "Blue Wave" and "Blue-Wave" both slugify to `blue-wave`.
- **Why it matters:** A concrete failure: the domain insert fails (a concurrent create, or a
  transient DB error) after the operator row is written. That leaves an orphan operator with no domain
  and no admin. Retrying with the same name then fails permanently on the slug unique constraint with an
  unhandled 500, until someone cleans up the DB by hand. Any slug or domain collision returns a
  500 instead of a usable error.
- **Suggested fix:** Wrap all three inserts in `db.transaction`. Catch Postgres `23505` and map it to
  409, naming the conflicting field. Drop the pre-check, or keep it only for a friendlier message.
  Consider auto-suffixing slugs on collision.

#### F1-5 · Medium · Platform console is served on every tenant hostname

- **Where:** `middleware.ts:18-20` exempts `/platform` and `/api/platform` on **any** host;
  `app/api/platform/auth/route.ts`.
- **What's wrong:** The super-admin console, which can create operators and admin accounts, is
  reachable at `https://<every-operator-domain>/platform`. It is guarded by a single static
  `PLATFORM_SECRET`, with no second factor. The rate limit is per IP (5 per 15 min), so a distributed
  attacker gets 5 guesses per IP.
- **Why it matters:** Every customer domain carries the platform's highest-privilege login surface.
  That widens both the brute-force surface and the phishing surface ("log in at captree.com/platform"),
  and it ties platform security to tenant domains the platform doesn't control.
- **Suggested fix:** Serve `/platform` and `/api/platform` only when Host matches a `PLATFORM_HOST`
  env var, and return 404 everywhere else. Longer term, add a global (not per-IP) failure counter or
  replace the static secret with real accounts plus MFA.

#### F1-6 · Low · Platform secret compare is still not timing-safe (prior fix only half landed)

- **Where:** `app/api/platform/auth/route.ts:17`.
- **What's wrong:** `docs/architecture-review-findings.md:104-107` marks this item `[x]` and asks
  for both an IP rate limit **and** `crypto.timingSafeEqual`. Only the rate limit landed; the compare is
  still `secret !== env.PLATFORM_SECRET`. Separately, `await req.json()` (`:11`) throws a 500 on a
  malformed body.
- **Why it matters:** The practical risk is low because the endpoint is rate-limited. The concern is
  that the tracker says it's done when it isn't.
- **Suggested fix:** Reuse the pattern in `lib/cron-auth.ts`: a length check plus `timingSafeEqual`,
  or compare SHA-256 digests to avoid leaking the length. Use `req.json().catch(() => ({}))`. Uncheck
  or annotate the tracker item.

#### F1-7 · Low · Temporary admin password uses `Math.random()`

- **Where:** `app/api/platform/operators/route.ts:27-30`.
- **What's wrong:** A non-CSPRNG generates the initial credential for a new operator's admin account.
- **Why it matters:** This password controls the operator's Stripe Connect linking and refunds. The
  exploitability is low (bcrypt-hashed, admin login rate-limited), but a secret should never come from
  `Math.random`.
- **Suggested fix:** Use `crypto.randomInt(chars.length)` per character, or
  `crypto.randomBytes(12).toString("base64url")`. Also consider forcing a password change on first
  login.

#### F1-8 · Low · Admin session isn't bound to the request host (invariant drift)

- **Where:** `lib/session.ts:10-14` and `lib/session-factory.ts:29-37` (`requireSession` ignores `_req`).
- **What's wrong:** All admin API routes use `session.operatorId` and never compare it with the
  resolved `x-operator-id`. The customer and mate tokens got exactly this binding in the prior
  review (`architecture-review-findings.md:109-113`); the admin session did not. I found **no leak**:
  queries stay scoped to the session's operator, every tenant shares one `SESSION_SECRET`, and cookies
  are host-only. A copied cookie replayed on operator B's domain simply shows operator A's data.
- **Why it matters:** It is defense-in-depth and consistency. The CLAUDE.md invariant says the operator
  ID comes *only* from `getOperatorId` / `getOperatorContext` / `getOperatorRecord`, and every
  session-scoped admin route breaks that as written. A future admin route that mixes
  `getOperatorContext(req)` (for example, for `stripeAccountId`) with `session.operatorId` (for the
  query) would pair tenant B's Stripe account with tenant A's data.
- **Suggested fix:** In `requireAdmin`, reject the request when `session.operatorId !==
  req.headers.get("x-operator-id")`. Or amend the invariant to name the admin session as an
  approved source. The first option is better.

#### F1-9 · Low · `/api/health` doesn't check the DB, contrary to its comment

- **Where:** `app/api/health/route.ts:1-11`.
- **What's wrong:** The comment says "each hit must re-evaluate env and DB", but the handler only
  imports `env` and returns `{ ok: true }`. There is no DB round-trip.
- **Why it matters:** The CI smoke test and any uptime monitor will report healthy while Neon is
  unreachable or migrations have failed.
- **Suggested fix:** Add `await db.execute(sql\`select 1\`)` with a short timeout, and return 503 if it
  fails.

#### F1-10 · Medium · Tenant consistency across FKs isn't enforced by the schema

- **Where:** `packages/db/src/schema.ts`, for example `bookingItems` (`:290-299`), `tickets` (`:304-317`),
  `checkIns` (`:321-334`), `trips` (`:181-207`) and `products` (`:97-110`).
- **What's wrong:** Every child table stores `operator_id`, but each FK references only the parent's
  `id`. Nothing stops a `booking_items` row with `operator_id = A` from pointing at a `trips` row owned
  by B, or a `trips` row from mixing operator A with vessel/product B.
- **Why it matters:** Operator isolation rests entirely on every query remembering `eq(operatorId)`.
  This has already failed once: the P0 "bookings lock cross-operator trips" in
  `architecture-review-findings.md:32` was exactly this class of bug, and the DB accepted the corrupt
  rows.
- **Suggested fix:** Add `UNIQUE (id, operator_id)` to the parent tables (trips, bookings,
  booking_items, vessels, products, schedules, customers). Then convert the child FKs to composite FKs,
  for example `FOREIGN KEY (trip_id, operator_id) REFERENCES trips (id, operator_id)`. Cross-tenant
  writes become impossible at the DB level. Roll out table by table; each migration is additive.

#### F1-11 · Medium · Missing indexes on hot money-path lookups

- **Where:** `schema.ts:304-317` (`tickets`: no index on `booking_id` or `booking_item_id`) and
  `:290-299` (`booking_items`: indexed on `booking_id` only, not on `trip_id`).
- **What's wrong:** There are 26 call sites filtering on `tickets.bookingId`, `tickets.bookingItemId` or
  `bookingItems.tripId`. They include the webhook handlers (void or confirm tickets by booking), trip
  cancellation (every booking item on a trip), the manifest, and the mate and admin "sold" counts
  inside `FOR UPDATE` transactions. All of these are sequential scans.
- **Why it matters:** In centralized mode these tables hold every operator's history. Seq scans
  inside transactions that hold a `FOR UPDATE` lock on a trip row lengthen the lock. That directly
  slows seat holds on popular trips, and it slows webhook processing during peak booking.
- **Suggested fix:** Add `tickets(booking_id)`, `tickets(booking_item_id)` and
  `booking_items(trip_id)`, using `CREATE INDEX CONCURRENTLY` in a hand-written migration. Drop the
  redundant `bookings_payment_intent_idx` (`schema.ts:284`); the `UNIQUE` on
  `stripe_payment_intent_id` already indexes it.

#### F1-12 · Low · `seats_remaining` CHECK lives only in a migration, and there is no upper-bound CHECK

- **Where:** `migrations/0009_seats_remaining_check.sql`. It is absent from `schema.ts:191` and from
  `migrations/meta/0013_snapshot.json`. A mechanical diff of every `ADD CONSTRAINT` / `CREATE INDEX`
  name against the latest snapshot shows this is the only drift.
- **What's wrong:** `schema.ts` claims to be the single source of truth but doesn't declare the
  oversell backstop. `drizzle-kit push`, or rebuilding the migrations from the schema, would silently
  drop it. Separately, no constraint stops `seats_remaining` from going **above** `capacity`.
- **Why it matters:** A seat-restore bug (double restore from a webhook/cron race, or a refund plus a
  cancel) inflates `seats_remaining` past `capacity`, and the next customers can buy seats that don't
  exist. Overselling from double restores is the failure mode the H1 and "PI-failure rollback" fixes
  were aimed at. Today the only DB guard is the lower bound.
- **Suggested fix:** Declare it in Drizzle with
  `check("trips_seats_remaining_non_negative", sql\`${t.seatsRemaining} >= 0\`)`, and add
  `CHECK (seats_remaining <= capacity)`. Both capacity-edit paths (`admin/trips/[tripId]/route.ts:137-139`,
  `mate/trips/[tripId]/capacity/route.ts:69-71`) update `capacity` and `seats_remaining` in the same
  statement by the same delta, so the constraint won't break them. Validate existing rows first
  (`NOT VALID` → `VALIDATE`). Related: those two paths clamp with `GREATEST(0, …)`, which would hide an
  invariant violation instead of failing. That is for Pass 7 to look at.

#### F1-13 · Low · `product_prices` has no `operator_id`

- **Where:** `schema.ts:115-123`.
- **What's wrong:** It's the only tenant-owned pricing table with no `operator_id` column (compare
  `schedule_prices`, `:149-160`). It can be scoped only by joining through `products`.
- **Why it matters:** A price lookup keyed on a client-supplied `productId` without that join could
  read another operator's price. This isn't confirmed as a bug: Pass 2 should check that
  `bookings/route.ts` resolves prices via the operator-scoped trip → product, and never from a raw
  client ID. It also can't take part in F1-10's composite-FK scheme.
- **Suggested fix:** Add `operator_id` (backfilled from `products`) plus a composite FK. Or document
  that it must always be reached via `products`.

#### F1-14 · Low · Mixed `timestamp` and `timestamptz` on expiry columns

- **Where:** `schema.ts:279` (`bookings.hold_expires_at`), `:410` (`magic_link_otps.expires_at`), and
  every `created_at`/`updated_at`. By contrast, `trips.*_time` and `rate_limits.window_start` are
  `timestamptz`.
- **What's wrong:** Expiry columns are `timestamp without time zone`. Today all comparisons against
  them happen in JS (`lt(col, new Date())`), and Drizzle round-trips them as UTC, so behavior is
  correct.
- **Why it matters:** Any future SQL-side `col < NOW()` comparison (for example, moving the expiry
  cron to a single `UPDATE`) becomes dependent on the session `TimeZone`. That is a latent source
  of holds or OTPs expiring hours early or late.
- **Suggested fix:** Migrate the expiry columns (`hold_expires_at`, `expires_at`) to `timestamptz`
  (`ALTER … TYPE timestamptz USING col AT TIME ZONE 'UTC'`). Do the rest opportunistically.

#### F1-15 · High (confirmed) · Preview builds run migrations against, and write to, the production database

- **Where:** `apps/web/vercel.json:2`: `(cd ../.. && pnpm --filter @openboat/db migrate) && next build`.
- **Evidence (2026-09-28):** In Vercel, one `DATABASE_URL` variable is scoped to **both Production and
  Preview**. `OPERATOR_ID` is scoped to Production only.
- **What's wrong:**
  1. Vercel uses the same `buildCommand` for Preview deployments, so every pushed branch applies its
     **unmerged** migrations to the production database. This has probably already happened:
     migration 0013 first shipped on `admin-console/phase-0-1` (`145fbc6`), and a follow-up fix
     (`636dd4e`, "Fix duplicate statement in migration 0013 breaking Vercel deploy") went to the same
     branch. 0013 only relaxed a NOT NULL, so no harm was done.
  2. Even without migrations, preview deployments read and write the live database, so test bookings
     made on a preview create real rows in production. (In practice most preview pages currently 404:
     without `OPERATOR_ID`, the middleware looks up the per-deployment preview hostname in `domains`
     and finds nothing. Anything exempt from the middleware, and any future webhook/cron exemption
     from F1-1/F1-2, would reach prod data from previews.)
  3. Migrations run before `next build`. If the build then fails, the schema is ahead of the code still
     serving traffic.
- **Why it matters:** An experimental migration on a branch (a dropped column, a new NOT NULL, a
  renamed table) would break the live booking path, or strand prod on a schema that `main` doesn't
  know about. That can happen just by pushing a branch, with no merge.
- **Suggested fix:**
  - Give Preview its own database. The simplest route is the Neon ↔ Vercel integration, which
    creates a Neon branch (a copy of prod) for each preview deployment automatically. Otherwise, create
    one long-lived Neon `preview` branch and scope a separate `DATABASE_URL` to Preview.
  - As a belt-and-braces measure, gate the migration step:
    `if [ "$VERCEL_ENV" = "production" ]; then (cd ../.. && pnpm --filter @openboat/db migrate); fi && next build`
    (a failed prod migration still stops the build).
    Only do this *together with* a separate preview DB, otherwise previews run new code against an old
    schema.
  - Adopt a rule that migrations must be backward-compatible with the currently deployed code
    (expand, then contract), because migrate-then-build can't be atomic.

#### F1-16 · Low · Operator record is fetched twice per page render, and the helpers duplicate each other

- **Where:** `lib/operator.ts:68-95`; `app/layout.tsx:44` plus each page that calls `getOperatorRecord()`.
- **What's wrong:** `getOperatorContext` and `getOperatorRecord` are the same query with different
  header sources. The root layout and the page each call `getOperatorRecord()`, which costs two
  identical DB round-trips per request, on top of the middleware's domain lookup.
- **Suggested fix:** Extract `fetchOperatorContext(operatorId)` and wrap the server-component
  variant in React `cache()`, so layout and page share one query per request.

---

## Pass 2: Booking write path

**Scope:** `apps/web/src/app/api/bookings/route.ts` (POST + GET), `bookings/[bookingId]/extend-hold/route.ts`,
`bookings/confirmation/[code]/calendar/route.ts`, and `lib/bookings/cancel.ts#cancelPendingBooking` as the
PI-failure compensation. To confirm consequences, I also read what consumes the rows this path writes:
`lib/webhooks/*`, `cron/expire-pending-bookings`, `admin/tickets/[ticketId]/refund`, `lib/settle-trips.ts`,
`api/trips`, web `checkout/CheckoutForm.tsx` / `CheckoutClient.tsx` and mobile `app/checkout.tsx`.

**Summary:** The concurrency core is sound. Seat locking, the SQL-arithmetic decrement and the
PI-failure compensation are all correct. The real problems are about **what gets sold and at what
recorded price**:
- The route sells trips that have already departed (P2-1).
- Tickets record the list price rather than the amount paid. Combined with the per-ticket refund path, that causes a **seat double-restore (oversell)** and over-refunds (P2-2).
- Every payment retry creates a fresh seat hold without releasing the previous one (P2-3).
- The admin's fee-bearer setting is a no-op (P2-4).

Nothing here leaks data across operators.

### What's clean (verified)

- **Seat inventory.** Trip rows are locked with `.for("update")`, scoped to the operator
  (`route.ts:115-119`). Availability is checked under the lock (`:125-138`). The decrement is
  `seats_remaining - n` in the same transaction (`:220-225`), and there's no read-check-write. The
  `trip.status` guard and duplicate-`tripId` refine from earlier audits are both in place (`:53-56`, `:126`).
- **PI outside the transaction, with idempotent compensation.** PI creation is outside the
  transaction (`:331-349`). On failure the route calls `cancelPendingBooking` (`FOR UPDATE` + status
  guard), so it can't double-restore against the expiry cron. The PI uses `transfer_data.destination` +
  `application_fee_amount`, not `charges.create`.
- **A lost `stripePaymentIntentId` write can't strand a payment.** If the update at `:351-354` fails,
  the client gets a 500 and never receives `clientSecret`, so the PI can't be paid. The webhook
  routes by `pi.metadata.bookingId` (`payment-intent-succeeded.ts:12`), not by the stored PI id, so
  a paid PI always finds its booking.
- **extend-hold.** The 2026-08-31 tracker item asked for a customer token. What landed is operator
  scope, a 90-minute lifetime cap and an IP limit (`extend-hold/route.ts:20, 33, 39-48`). That is
  acceptable for guest checkout: only the creator ever sees the pending booking's UUID.
- **F1-13 closed (safe).** `productPrices` has no `operator_id`, but the only IDs used to query it come
  from the operator-scoped, locked `tripRows` (`route.ts:140, 149`). A client can't supply a
  `productId`.
- **Email normalization, wallet rate limiting and operator-scoped wallet lookup** (earlier audit
  items) are all present (`:32`, `:383-398`, `:411`).

### Operator-scoping check (against the Pass 1 source table)

All three routes take their operator from the `x-operator-id` header (`getOperatorContext` /
`getOperatorId`), which matches the Pass 1 baseline.

| Query | Location | Scoped? |
|---|---|---|
| Lock trips `FOR UPDATE` | `route.ts:115-119` | ✅ `eq(trips.operatorId)` |
| `productPrices` by `productId` | `:149` | ✅ by derivation (IDs from scoped trips; table has no column) |
| `schedulePrices`, `vessels` | `:151, :153` | ✅ explicit |
| Seat decrement `UPDATE trips WHERE id` | `:221-224` | ⚠️ by derivation only |
| Inserts: bookings, booking_items, tickets | `:237-315` | ✅ `operatorId: operator.id` |
| Post-PI `UPDATE bookings WHERE id` | `:351-354` | ⚠️ by derivation (own booking) |
| `cancelPendingBooking` (compensation) | `cancel.ts:24-62` | ⚠️ by derivation (own booking) |
| GET: bookings | `:406-416` | ✅ explicit |
| GET: booking_items, tickets, trips, vessels, products | `:426-449` | ⚠️ by derivation |
| extend-hold select + update | `extend-hold/route.ts:25-53` | ✅ explicit |
| calendar: operators, bookings | `calendar/route.ts:22-32` | ✅ explicit |
| calendar: booking_items ⋈ trips ⋈ products | `calendar/route.ts:36-45` | ⚠️ by derivation |

No query in this pass can reach another operator's rows. The ⚠️ rows are covered by P2-10.

### Findings

#### P2-1 · High · Departed trips can be booked and paid for

- **Where:** `route.ts:125-138`: the only availability check is `status === "scheduled"` plus seats. The
  trip-status transition happens in `lib/settle-trips.ts:23-33` (`scheduled → pending_settlement` once
  `startTime < now`). That function is called **only** lazily, from `admin/today`, `admin/revenue` and
  `admin/reports/pending`. `api/trips/route.ts:22-30` lists trips by date and `status = 'scheduled'`,
  with no time filter. No client filters departed trips within today either. The web calendar and the
  mobile `DateSheet`/`DayBelt` grey out past *days* only (`MobilePanelCalendar.tsx:75`,
  `DateSheet.tsx:90`), and neither the day lists (`SailingsSection.tsx`, `BookingCalendar/TripRow.tsx`)
  nor the mobile Trips tab compare `startTime` with now. `trips.online_cutoff` (`schema.ts:200`) and
  `trips.deposit_percentage` (`:201`) exist, but nothing reads or writes either one.
- **What's wrong:** A trip stays `scheduled` after it departs until an admin happens to open one of
  those three pages. Until then it stays in today's trip list on both web and mobile, and
  `POST /api/bookings` sells it. A crafted request can do the same for a past *day's* trip on any
  operator whose admin hasn't opened the dashboard since.
- **Why it matters:** A customer is charged for a boat that has already left. The operator has to
  notice and refund by hand. If nobody does, `settleTrips` later moves the trip to `sailed` and the
  $1.50 fee is marked `earned` on a ticket that never boarded.
- **Suggested fix:** Inside the lock, reject with 409 when
  `trip.startTime <= now` (or `now >= coalesce(trip.onlineCutoff, trip.startTime - N min)`). Add
  `gt(trips.startTime, now)` to `api/trips` so departed trips aren't listed. Either use
  `online_cutoff` or drop the column.

#### P2-2 · High · Tickets store the list price, not the price paid; per-ticket refunds then double-restore seats and over-refund

- **Where:** root cause is `route.ts:305` (`priceCents: price.priceCents`, the undiscounted list price).
  The consumers are in Pass 4 / Pass 3 files. `admin/tickets/[ticketId]/refund/route.ts:48-57` refunds
  `ticket.priceCents` and `:76-85` voids the ticket and restores 1 seat. `webhooks/charge-refunded.ts:13, 48`
  treats *cumulative* `amount_refunded === amount` as a full refund. `cancel.ts:90-101`
  (`cancelConfirmedBooking`) counts **all** tickets per item, with no `voided = false` filter, and restores that
  many seats.
- **What's wrong (confirmed by tracing):**
  1. **Double restore → oversell, no discount needed.** When there's no discount, the charge amount equals
     the sum of `ticket.priceCents`. An admin refunds each ticket of a 4-ticket booking one at a time.
     Each refund restores 1 seat, for +4. The last refund makes `amount_refunded === amount`, so Stripe sends
     `charge.refunded`. The booking is still `confirmed`, because the per-ticket route never changes it, so
     `cancelConfirmedBooking` runs, counts all 4 tickets and restores another +4. The trip now has
     `seats_remaining` 4 above reality, and nothing stops it exceeding `capacity`
     (see F1-12). The next customers buy seats that don't exist.
  2. **Over-refund under a group discount.** Take 10 × $68 with 10% off, so $612 is charged. Refunding one
     ticket returns $68, but that ticket's share of the payment was $61.20. With `reverse_transfer`, the
     operator pays the difference. After 9 refunds the charge is exhausted, the full-refund webhook fires,
     and the double restore from (1) follows. Refunding the 10th ticket directly would fail at Stripe
     with a 502.
- **Why it matters:** This oversells seats and loses the operator money, through a normal admin
  action (refund each passenger in a group).
- **Suggested fix:**
  - (a) In the write path, store the net amount paid per ticket: `priceCents` after the pro-rated
    discount, plus an explicit `listPriceCents` if the list price is still needed. Allocate
    remainders so that `sum(tickets) === booking.totalCents`, which also fixes the known penny-drift
    item (`architecture-review-findings.md:282`). Refund that net amount.
  - (b) In `cancelConfirmedBooking`, count and void only `voided = false` tickets, and restore seats from
    that count. Do the same wherever else a restore counts tickets (Pass 4 should sweep the trip-cancel path).
  - (c) Add the `seats_remaining <= capacity` CHECK from F1-12 as the backstop.
  - (d) Cross-pass: Pass 3 and Pass 4 own the webhook and refund code; this finding is filed here because the stored price is set in this route.

#### P2-3 · Medium · Each payment retry creates a new booking and holds seats again; old holds persist until the cron runs

- **Where:** web `checkout/CheckoutForm.tsx:239-291`. On `payError` (card declined, 3DS failed) the form
  stays open, and the next submit POSTs `/api/bookings` again. Mobile `app/checkout.tsx:136-181`: dismissing
  the PaymentSheet (`Canceled`) or a decline returns, and "Pay" calls POST again. The server side is
  `route.ts:70-365`: no reuse of an existing pending booking, and no endpoint to release one.
- **What's wrong:** Every attempt decrements seats again under a new pending booking. The previous
  booking's PI is abandoned client-side, and its seats come back only after `holdExpiresAt` (10–60 min,
  extendable to 90) **and** a run of `expire-pending-bookings`. Per CLAUDE.md, that cron is currently
  daily on Hobby.
- **Why it matters:** A customer buying 6 seats who has one declined card and one dismissed wallet sheet
  holds 18 seats. On a 29-seat boat the trip shows sold out and real buyers are turned away. With daily
  crons, that can last most of a day. It also makes the IP booking limit (20/15 min) a weak guard,
  because ordinary retries consume it.
- **Suggested fix:** On the client, keep `{bookingId, clientSecret}` after the first POST and reuse it on
  retry while the cart is unchanged (web: call `confirmPayment` with the same secret; mobile:
  re-`initPaymentSheet` with the same secret). When the cart changes, call a new
  `POST /api/bookings/:id/release` that runs `stripe.paymentIntents.cancel`, then
  `cancelPendingBooking`, scoped by operator the same way extend-hold is.

#### P2-4 · Medium · `fee_bearer` / `fee_display` are exposed to admins but have no effect; the fee always comes out of the operator's price

- **Where:** `route.ts:217, 334-338`: `amount: totalCents` (ticket prices only) with
  `application_fee_amount: 150 × tickets`. The setting is editable at `admin/settings/operator/page.tsx:135-141`
  and `api/admin/settings/operator/route.ts:30`. It's loaded into `OperatorContext` (`operator.ts:34-35`) but never
  read. `booking-requirements.md:24` specifies the default as `passenger` / `itemized`.
- **What's wrong:** This isn't unknown code; it's a spec'd feature that was never wired in. Every operator is
  effectively `operator`-bears-fee. The schema default and the admin UI say `passenger`. No client shows a
  fee line.
- **Why it matters:** An operator who reads their settings as "passengers pay the $1.50" receives $1.50
  per ticket less than they expect, on every sale. That's a payout-reconciliation dispute waiting to
  happen. Related edge cases: `priceCents = 0` is allowed (`admin/settings/products/route.ts:91`), so a free
  child ticket still costs the operator $1.50. An all-free cart gives `amount: 0`, and Stripe rejects it
  with the misleading "Payment service unavailable" 502 (`route.ts:348`). Nothing asserts
  `amount >= 50` or `application_fee_amount <= amount`.
- **Suggested fix:** Either implement `fee_bearer` in the server's pricing: add `150 × tickets` to `amount`
  when the bearer is `passenger`, and return the breakdown so clients can show it. Or hide the control and
  change the column default to `operator` until the feature is built. Separately, validate amounts
  before calling Stripe and return a 400 with a real message.

#### P2-5 · Medium (needs confirmation) · Web checkout may accept delayed-settlement payment methods

- **Where:** `route.ts:336`: `automatic_payment_methods: { enabled: true }` with no restriction. Mobile opts
  out (`app/checkout.tsx:168` `allowsDelayedPaymentMethods: false`); the web Payment Element doesn't.
- **What's wrong:** If the platform's Stripe settings enable US bank account / ACH (or other delayed
  methods), a web booking sits in `processing` for days. No tickets are issued until `succeeded`, and the
  expiry cron deliberately skips `processing` PIs (`expire-pending-bookings/route.ts:74`). For a same-day or
  next-day trip, the customer has no boarding pass. If the debit fails after departure, the operator
  has carried an unpaid passenger.
- **Why it matters:** The customer is left with no boarding pass for a trip they paid for, and the operator
  carries the risk of an unpaid passenger. Both depend on dashboard configuration that the code doesn't
  control.
- **How to confirm:** Stripe Dashboard → Settings → Payment methods (platform and Connect defaults). Check
  whether any delayed-notification method is on.
- **Suggested fix:** Pin it at PI creation, for example `payment_method_types: ["card", "link"]`, or
  `automatic_payment_methods` with a payment-method configuration that excludes delayed methods. Don't
  depend on dashboard state. The web checkout uses deferred-intent Elements (`CheckoutClient.tsx:97-99`,
  `mode: "payment"` with no `paymentMethodTypes`), so apply the same restriction in the Elements options.
  Otherwise Elements can offer a method the PI then rejects at `confirmPayment`.

#### P2-6 · Low · Deadlock risk on multi-trip carts: lock order isn't deterministic — needs confirmation

- **Where:** `route.ts:115-119`: `WHERE id IN (...) FOR UPDATE` with no `ORDER BY`.
- **What's wrong:** Rows are locked in whatever order the executor visits them. Two concurrent carts that
  share two or more trips could take the locks in opposite orders. Postgres then aborts one with `40P01`, which
  falls through the catch at `:321-327` as an unhandled 500. With a btree scan over `= ANY(...)` the order is
  usually consistent, so this is unlikely today, but it's a plan-dependent guarantee.
- **Why it matters:** The customer gets a generic 500 in the middle of checkout and the sale is likely lost.
  This happens exactly when popular multi-trip carts are competing for seats.
- **Suggested fix:** Add `.orderBy(trips.id)` before `.for("update")`. Optionally map `40P01`/`40001` to 409 "please retry".

#### P2-7 · Low · A confirmation-code collision surfaces as an unhandled 500

- **Where:** `route.ts:66-68` (3 random bytes, so 16.7M codes) and `:241`. The constraint is global
  `UNIQUE(confirmation_code)` (migration 0011, which fixed the earlier tracker item).
- **What's wrong:** A collision raises `23505` inside the transaction, and it's rethrown as a 500. The
  failure rate grows linearly with total bookings **across all operators**: about 0.3% of checkouts at 50k
  bookings, 1.5% at 250k.
- **Why it matters:** Checkout has a random failure rate that grows with the size of the platform. Each
  failure shows the customer an unexplained error and probably loses the sale.
- **Suggested fix:** Retry the insert a few times on `23505` for that constraint, with a new code each time. Or widen to
  4–5 bytes, or scope uniqueness to `(operator_id, confirmation_code)`. The wallet and calendar lookups
  are already operator-scoped.

#### P2-8 · Low · Mobile post-payment polling can exhaust the customer's own wallet-lookup limit

- **Where:** mobile `app/checkout.tsx:188-204` polls `GET /api/bookings` up to 5 times at 1.5 s intervals.
  The GET limit is 5 per 15 min per email and per IP (`route.ts:24-25, 386-398`). It resets only the email
  bucket, and only on success (`:424`).
- **What's wrong:** If the webhook takes longer than about 7 s, all 5 polls return 404 (still `pending`). That
  uses up both the email and IP buckets. The loop gives up, so the ticket never reaches the offline wallet,
  and any manual lookup for the next 15 min gets a 429. Separately, anyone who knows a customer's email can
  lock their lookup with 5 bad codes.
- **Why it matters:** A paying customer's offline boarding pass can silently fail to download. That matters
  most on the dock, where there's no connectivity and the offline wallet is the whole point.
- **Suggested fix:** Have the post-payment fetch use a signed, short-lived token returned by POST, which
  bypasses the guess limiter. Or return 202 for a matching `pending` booking without counting it. Consider
  limiting only on the IP bucket (plus a global failure cap), not per email.

#### P2-9 · Low · Calendar endpoint: no status filter, no rate limit, and a free confirmation-code validity oracle

- **Where:** `calendar/route.ts:29-45`.
- **What's wrong:** It returns `.ics` for `pending` and `cancelled` bookings, and for cancelled trips. It
  also has no rate limit. A 200/404 reveals whether a 6-hex code exists on this operator, which takes
  away half of the wallet GET's two-factor lookup (code + email) with no throttle. Also, *needs
  confirmation*: the VEVENTs have no `DTSTAMP`, which RFC 5545 requires, so strict calendar clients may
  reject the file.
- **Why it matters:** A customer whose booking was cancelled or expired can still add a calendar event
  and turn up at the dock. The oracle weakens the wallet lookup's credential pair.
- **Suggested fix:** Filter `bookings.status = 'confirmed'` and exclude `trips.status = 'cancelled'`. Add
  an IP rate limit that shares the wallet's budget. Emit `DTSTAMP`.

#### P2-10 · Low · Several follow-up queries are scoped only by derivation, which falls short of the invariant as written

- **Where:** `route.ts:221-224` (seat decrement), `:351-354`, `:426-449` (GET children);
  `calendar/route.ts:36-45`; `cancel.ts:24-62`.
- **What's wrong:** None of these leak: every ID comes from a row that was already operator-filtered (see the
  table above). But CLAUDE.md says every tenant-table query must include `eq(table.operatorId, …)`, and
  F1-10 shows the DB won't catch a mismatched child row.
- **Why it matters:** If a future edit gets one ID derivation wrong, the result is a cross-tenant read or
  write that the DB accepts. The explicit predicate is the only backstop until F1-10 lands.
- **Suggested fix:** Add the `operatorId` predicate. It's cheap, and it makes the invariant greppable.
  `cancelPendingBooking` could take `operatorId` as a parameter, since the webhook and cron know it from
  `pi.metadata` / the row.

#### P2-11 · Low · The pricing logic is triplicated inline inside the lock-holding transaction

- **Where:** `route.ts:156-216` (subtotal + per-vessel discount), `:256-283` (the same computation
  repeated per item for pro-ration) and `:295-311`. All of them use `tripRows.find(...)` inside nested loops.
- **What's wrong:** Three copies of the same money math have to stay in sync by hand. That's the
  source of the known penny drift, and P2-2's fix needs to change all three. It's also untestable
  except through the whole route.
- **Suggested fix:** Extract a pure `priceCart(cart, trips, prices, vessels) → { lines: [{tripId, tickets: [{type, listCents, netCents}]}], subtotal, discount, total, fee }`, with remainder allocation, and unit-test it. The route then only locks, calls it and persists the result. This is refactoring-backlog item 1 (booking domain module), and it's the natural place to land P2-2, P2-4 and the penny-drift fix together.

#### P2-12 · Low · Latent: inactive fares, products and vessels are still sellable

- **Where:** `route.ts:149` (no `productPrices.active` filter), `:115-138` (no `products.active` /
  `vessels.active` check). `api/trips/route.ts:35` does filter `prices.active`.
- **What's wrong:** Nothing sets `productPrices.active = false` today, so the fare case is latent.
  `products.active` and `vessels.active` *are* admin-editable, but that doesn't stop their trips from being
  listed or sold.
- **Why it matters:** An admin who deactivates a product or vessel reasonably expects its trips to stop
  selling, and they don't. Once fares can be deactivated, a crafted request could buy a withdrawn (possibly
  cheaper) fare.
- **Suggested fix:** Filter `productPrices.active = true` in the booking query so it matches the display
  query, and decide whether an inactive product/vessel should block sales; if so, check it under the lock.

#### P2-13 · Low · Terms acceptance is recorded without any acceptance signal

- **Where:** `route.ts:250-251`.
- **What's wrong:** `termsAcceptedAt: new Date()` is written for every booking, but the request body has no
  acceptance flag. `termsVersion` stores the terms *URL* (or `"unversioned"`), not a version.
- **Why it matters:** This is the evidence the operator would submit in a chargeback. A record that
  doesn't show the customer actually accepted a specific version is weak.
- **Suggested fix:** Require `acceptedTerms: true` in the Zod schema. Store a real version or a content hash.

#### P2-14 · Low · Test gaps on the money path

- **Where:** `src/test/api/bookings.test.ts`.
- **What's missing:** Tests for:
  - the cross-operator `tripId` → 404 case (the regression test for the earlier P0);
  - non-`scheduled` trip → 409;
  - group-discount totals and per-item pro-ration;
  - schedule-price precedence over product price;
  - multi-trip carts;
  - the exact `amount` / `application_fee_amount` passed to Stripe.

  None of these are covered.
- **Why it matters:** The cross-operator case already regressed once (P0). The discount and fee math decide
  how much money moves, and nothing pins it down, so P2-2 and P2-4 went unnoticed.
- **Suggested fix:** Add them, ideally as unit tests against the extracted `priceCart` (P2-11), plus the
  two route-level scoping and status tests.

### Handoffs to later passes

- **Pass 8 (clients):** Web checkout shows and pre-authorizes `sum(product price × qty)`
  (`CheckoutClient.tsx:88-99`, `CheckoutForm.tsx:203-206, 396`). It never uses the server's `totalCents`.
  Group discounts and `schedule_prices` overrides therefore make the charged amount differ from "PAY $X".
  Today that's an undercharge relative to the display; it becomes an overcharge once weekend pricing lands.
- **Pass 3:** The expiry cron can cancel a booking whose hold `extend-hold` just pushed out, because
  `cancelPendingBooking` doesn't re-check `holdExpiresAt` under the lock. The client does handle
  `payment_intent_unexpected_state`.
- **Pass 4:** Check whether the manifest/passenger UI offers per-ticket refunds as a routine action. If it
  does, consider raising P2-2 to Critical.
- **Pass 4:** The `cancelConfirmedBooking` / trip-cancel seat math must exclude already-voided tickets (P2-2b).

---

## Pass 3: Payment lifecycle (B + D)

**Scope:** `app/api/webhooks/stripe/route.ts`, `lib/webhooks/*` (4 handlers), `lib/bookings/cancel.ts`,
`lib/bookings/get-confirmed-booking.ts`, `lib/notifications/send-confirmation-email.ts`, `app/api/cron/*`
(expire-pending-bookings, trip-reminders, reset-demo-data), `lib/cron-auth.ts`, `lib/settle-trips.ts`,
`lib/demo-reset.ts`, `app/api/admin/revenue/route.ts`. I reviewed these as one state machine
(`pending → confirmed | cancelled`, fee `held → earned | reversed`). To confirm consequences, I also read what
consumes the state they leave behind: `app/boarding/[bookingId]/page.tsx`, `api/mate/manifest`,
`api/mate/checkins`, mobile `app/(mate)/manifest/[tripId].tsx`, `lib/email.ts`, and the Stripe refund calls in
`admin/trips/[tripId]/cancel` and `admin/tickets/[ticketId]/refund`.

**Summary:** The concurrency guards are sound. Every state transition takes a `FOR UPDATE` on the booking and
re-checks status, and the H1 fix holds. The serious problems are elsewhere:
- The pending → cancelled transition leaves tickets live. Combined with no booking-status check anywhere
  downstream, **an unpaid hold yields boarding passes the scanner accepts**, and those tickets later count as
  earned fees (P3-1, **Critical**).
- The `payment_intent.succeeded` handler confirms whatever booking `metadata.bookingId` names, without binding
  it to the PI, the amount or the operator (P3-2, latent High).
- Disputes and Dashboard refunds on destination charges never recover funds from the operator (P3-3).
- Several Stripe-side failures are logged and acknowledged with a 200, so Stripe never retries them (P3-4).

### What's clean (verified)

- **Signature first.** `constructEvent` runs on the raw `req.text()` body before anything else
  (`webhooks/stripe/route.ts:17-30`). Handler exceptions propagate as a 500, so Stripe retries them.
- **Idempotent transitions.** `payment_intent.succeeded` (`payment-intent-succeeded.ts:35-81`),
  `cancelPendingBooking` (`cancel.ts:23-38`) and `cancelConfirmedBooking` (`cancel.ts:76-83`) each lock the
  booking row and re-check status. Duplicate or concurrent deliveries, and the cron racing the webhook, can't
  double-confirm or double-restore. The dispute handler is now transactional and guards on `voided = false`.
- **H1 holds.** The expiry cron skips `succeeded`/`processing` PIs (`expire-pending-bookings/route.ts:74-81`).
  The succeeded handler refuses to confirm an already-cancelled booking and refunds instead (`:56-61, 85-97`).
- **Cron auth.** All three crons call `verifyCronAuth` (length check plus `timingSafeEqual`) before doing any
  work. `reset-demo-data` is also gated on `DEMO_MODE`. `resetBookingActivity` is fully operator-scoped and
  runs in one transaction.
- **Batching.** The expiry cron has a batch limit and `maxDuration`. Trip reminders use a single join,
  de-duplicate emails, and include only `confirmed` bookings on `scheduled` trips.
- **Settlement idempotency.** `settleTrips` is idempotent (`WHERE status = …` / `fee_status = 'held'`) and
  scoped by operator on the `trips` updates.
- **Revenue counts only earned fees.** Revenue totals take only `earned` fees on non-voided tickets
  (`admin/revenue/route.ts:35-40`), which satisfies the letter of the fee invariant. (P3-1 shows the `earned`
  set itself is polluted.)

### Operator-scoping check (against the Pass 1 source table)

The webhook and the two scheduled crons are **cross-tenant by design**, so for them `eq(operatorId)` isn't the
meaningful check. What matters is whether each event is **bound to the booking's operator**, and it isn't
(P3-2). The table below covers the rest.

| Query | Location | Scoped? |
|---|---|---|
| `event.account` → operators | `webhooks/stripe/route.ts:37-46` | ✅ checked, but the result is discarded and never passed to handlers (P3-2) |
| succeeded / canceled: booking by `metadata.bookingId` | `payment-intent-succeeded.ts:36-40`, `cancel.ts:24-34` | ❌ not bound to operator, PI or amount (P3-2) |
| refunded / dispute: payment by PI id → items → tickets | `charge-refunded.ts:26-29`, `charge-dispute-created.ts:18-43` | ⚠️ by derivation (the PI id is globally unique). The tracker's "add operatorId filter" for disputes wasn't done (P3-9). |
| expiry cron stale select | `expire-pending-bookings/route.ts:35-57` | cross-tenant by design ✅ |
| trip-reminders join | `trip-reminders/route.ts:23-46` | cross-tenant by design. The push lookup uses `trips.operatorId` ✅ |
| `settleTrips` trip updates | `settle-trips.ts:24-45` | ✅ explicit |
| `settleTrips` items / tickets | `settle-trips.ts:51-74` | ⚠️ by derivation (tripIds scoped) |
| revenue join | `admin/revenue/route.ts:42-53` | ✅ `trips.operatorId`, children by derivation |
| `sendConfirmationEmail` child reads | `send-confirmation-email.ts:20-43` | ⚠️ by derivation (from the booking row) |
| `getConfirmedBooking` | `get-confirmed-booking.ts:42-76` | ✅ booking explicit, children by derivation |
| `resetBookingActivity` | `demo-reset.ts:26-37` | ✅ explicit on every table |

### Findings

#### P3-1 · Critical · Unpaid and expired holds produce boardable tickets, and their fees are later counted as earned

- **Where:**
  - Root cause: `lib/bookings/cancel.ts:22-66` (`cancelPendingBooking`). It restores seats and sets
    `status = 'cancelled'`, but never sets `tickets.voided = true` or `fee_status = 'reversed'`. Compare
    `cancelConfirmedBooking` at `:104-110`.
  - Every downstream consumer checks `voided` and nothing else. **None of them checks `bookings.status`:**
    - The boarding page renders QR codes for any booking status. Only `cancelled` is overlaid as void
      (`app/boarding/[bookingId]/page.tsx:15-46, 110-111`); `pending` isn't.
    - The mate manifest returns bookings of every status, and its `ticketsSold` counts every non-voided ticket
      (`api/mate/manifest/route.ts:34-38, 49-80`).
    - Server check-in rejects only voided tickets (`api/mate/checkins/route.ts:43-62`).
    - The mobile scanner does the same (`apps/mobile/app/(mate)/manifest/[tripId].tsx:220-223`).
    - `settleTrips` earns any `held`, non-voided ticket (`settle-trips.ts:64-74`), and the revenue query sums
      them (`admin/revenue/route.ts:35-46`). Neither joins `bookings`.
  - `POST /api/bookings` returns `bookingId` to the caller before any payment (`bookings/route.ts:357-358`).
- **What's wrong (confirmed by tracing):**
  1. **Free boarding passes.** Anyone can POST a cart with just an email, skip payment and open
     `/boarding/<bookingId>`. That shows real QR codes (bare ticket UUIDs). The tickets are in the mate's
     offline manifest as non-voided, and both the offline scanner and `POST /api/mate/checkins` accept them.
     This works while the hold is pending (10–90 min), and it **keeps working after the hold expires**,
     because expiry doesn't void the tickets. Once expired, the seats have also been returned to inventory
     and resold, so the boat is oversold by the "phantom" passengers as well.
  2. **Revenue overstated.** Every abandoned or expired checkout leaves `held`, non-voided tickets. After the
     trip sails, `settleTrips` flips them to `earned`, so the revenue and money pages report $1.50 per phantom
     ticket as platform income that was never charged. P2-3 (each payment retry creates a new pending booking)
     multiplies this.
  3. **Wrong counts.** The manifest "sold" count and the passenger list include unpaid and expired bookings,
     so mates see passengers who never paid.
- **Why it matters:** This is a free-ride exploit that needs no special skill (a browser and a throwaway
  email), and it oversells seats at the dock. It also breaks the CLAUDE.md "Cancellation atomicity"
  invariant ("void all tickets, set `fee_status = 'reversed'`…") on the one cancellation path the invariant
  didn't obviously target. Revenue reporting, which the fee lifecycle exists to support, is wrong by
  construction.
- **Suggested fix:**
  - (a) In `cancelPendingBooking`, void the tickets and set `fee_status = 'reversed'` in the same transaction,
    and backfill existing rows with a one-off migration:
    `UPDATE tickets SET voided = true, fee_status = 'reversed' FROM bookings b WHERE b.id = tickets.booking_id AND b.status = 'cancelled' AND NOT tickets.voided`.
  - (b) Treat `bookings.status = 'confirmed'` as a condition for a ticket to exist:
    - filter it in the manifest query and `ticketsSold`;
    - check it in `api/mate/checkins`;
    - show "awaiting payment" instead of QR codes on the boarding page for `pending` bookings;
    - join it in `settleTrips` step 2.
    - In the revenue query, **don't** filter on `status = 'confirmed'`. Legitimately refunded bookings end
      up `cancelled`, so that filter would drop real reversals. It's also needed because (a)'s backfill
      marks never-charged fees `reversed`, which would otherwise inflate the reversed column. The field
      that tells these cases apart is "was it ever paid": inner-join `payments`, or use `EXISTS`, since a
      `payments` row is only written on `succeeded`.
  - (c) Longer term, insert tickets at `payment_intent.succeeded` rather than at hold time, or give tickets
    their own `active` flag that only the webhook sets. Then "unpaid ticket" can't be represented at all.
  - (d) Add regression tests: after cron expiry and after `payment_intent.canceled`, tickets are voided; a
    pending booking's ticket is rejected by `mate/checkins`. Neither `cron-expire.test.ts` nor
    `webhook-payment-intent-canceled.test.ts` asserts anything about ticket state today.
  - QR signing (tracked tech debt) doesn't help here: these are genuine server-issued ticket IDs.

#### P3-2 · High (latent; exploitable once a Connect webhook endpoint is added) · `payment_intent.*` handlers trust `metadata.bookingId` without binding it to the PI, amount or operator

- **Where:** `webhooks/stripe/route.ts:37-46` (the `event.account` lookup result is thrown away);
  `payment-intent-succeeded.ts:12, 36-78`; `payment-intent-canceled.ts:10-13` → `cancel.ts:22`.
- **What's wrong:**
  - The succeeded handler confirms the booking named in `pi.metadata.bookingId`. It never checks any of:
    - `fresh.stripePaymentIntentId === pi.id`;
    - `pi.amount === fresh.totalCents`;
    - `pi.currency`;
    - `pi.transfer_data.destination` against the booking operator's `stripeAccountId`;
    - `event.account` against `fresh.operatorId`.
  - It also stores `applicationFeeCents: fresh.platformFeeCents` (the expected fee), not the fee actually
    charged.
  - Destination-charge PIs live on the platform account, so legitimate PI events never carry
    `event.account`. The `event.account` branch exists for a Connect ("events on connected accounts")
    endpoint, which `docs/centralized-architecture.md` item 6 describes as the centralized design.
  - Connect onboarding is OAuth with `scope=read_write` (`stripe/connect/start/route.ts:25-29`), which gives
    Standard accounts their own dashboards and API keys.
- **Why it matters:** Once a Connect endpoint subscribed to `payment_intent.succeeded` exists, any onboarded
  operator could do the following:
  1. Start checkout on **any** operator's site, which yields a pending `bookingId`.
  2. Create a $0.50 PI on their own Stripe account with `metadata.bookingId = <that id>` and pay it.
  3. The platform then confirms the booking, issues tickets and emails boarding passes. No money reaches the
     victim operator and no platform fee is collected.

  The same trick lets an operator confirm its own bookings off-platform to evade the $1.50 fee.
  `payment_intent.canceled` with a forged `bookingId` would cancel another customer's live hold.

  Today the documented endpoint is platform-level (`openboatfishing-demo-deploy.md:41-49`), so this isn't
  exploitable yet. The code gives no protection if that changes.
- **How to confirm:** Stripe Dashboard → Developers → Webhooks → check each endpoint's "Listening to"
  setting (Your account vs. Connected accounts).
- **Suggested fix:**
  - In the route, ignore `payment_intent.*` events that carry `event.account`. For destination charges those
    events can't be legitimate.
  - In the handler, under the lock:
    - require `fresh.stripePaymentIntentId === pi.id` (safe: the PI id is written before `clientSecret` is
      returned, as noted in Pass 2);
    - require `pi.amount === fresh.totalCents` and `pi.currency === "usd"`;
    - require `pi.transfer_data?.destination` to equal the booking operator's `stripeAccountId`.

    On a mismatch, log loudly and don't confirm. Throw only if a retry could plausibly succeed.
  - Store the actual `charge.application_fee_amount` in `payments`.
  - Apply the same PI-id check before `cancelPendingBooking` in the canceled handler.

#### P3-3 · High (Stripe behavior needs confirmation) · Disputes and Dashboard refunds on destination charges never recover funds from the operator; lost or won disputes aren't handled

- **Where:** `lib/webhooks/charge-dispute-created.ts:6-50` (header comment `:6-9`);
  `lib/webhooks/charge-refunded.ts:36-48`. `charge.dispute.closed` and `charge.dispute.funds_withdrawn` aren't
  subscribed to (`webhooks/stripe/route.ts:48-56`).
- **What's wrong:**
  1. With destination charges, Stripe debits the disputed amount plus the dispute fee from the **platform**
     balance. The platform recovers it by reversing the transfer. The dispute handler voids tickets but never
     calls `stripe.transfers.createReversal`, so the platform absorbs every chargeback in full. The platform
     keeps $1.50 per ticket; it loses the whole ticket price plus about $15 per dispute.
  2. The comment "If lost, a subsequent `charge.refunded` event will cancel the booking" is, as far as I
     know, wrong. A lost dispute doesn't create a refund, and `amount_refunded` stays 0. It results in
     `charge.dispute.closed` with `status: 'lost'`. The booking therefore stays `confirmed` for good, with
     voided tickets and seats never restored.
  3. A **won** dispute leaves the tickets voided with `fee_status = 'reversed'`. Nothing re-activates them, so
     the fee is lost from revenue even though Stripe returned the funds. The local `reversed` status is also
     wrong at the moment the dispute is created, because Stripe doesn't refund the application fee on a
     dispute.
  4. `charge.refunded` exists specifically for Dashboard-initiated refunds (`:8-9`). It refunds the
     application fee but never checks or performs the **transfer reversal**. A platform-side Dashboard refund
     that doesn't reverse the transfer means the platform pays the customer out of its own balance, and then
     `applicationFees.createRefund` hands the $1.50 to the operator as well. The platform is out the full
     charge; the operator keeps it all.
- **Why it matters:** Direct platform losses on every chargeback, and on every Dashboard refund done the
  "wrong" way. The DB also disagrees with Stripe about dispute outcomes.
- **How to confirm:** In test mode, create a dispute with test card `4000000000000259` on a destination
  charge. Check the platform balance transactions and whether any `charge.refunded` fires after closing the
  dispute as lost. Then do a Dashboard refund and inspect `refund.transfer_reversal`.
- **Suggested fix:**
  - On `charge.dispute.created`, call `stripe.transfers.createReversal(charge.transfer, { amount })` with an
    idempotency key of `dispute:<id>`. Also record the dispute on the booking, for example as a `disputed_at`
    column.
  - Handle `charge.dispute.closed`:
    - **won:** un-void the tickets and set the fee back to `held` or `earned`;
    - **lost:** cancel the booking without restoring seats if the trip has sailed, or restore them otherwise.
  - In `charge.refunded`, for each refund with no `transfer_reversal`, create the reversal before refunding
    the fee.
  - Fix the misleading comment.

#### P3-4 · Medium · Stripe-side failures are logged and acknowledged with a 200, so Stripe never retries

- **Where:** `payment-intent-succeeded.ts:23-31` (charge retrieve), `:85-96` (auto-refund on a cancelled
  booking); `charge-refunded.ts:38-46` (fee refund). The route has no try/catch, so throwing is the retry
  mechanism, and these paths deliberately don't throw.
- **What's wrong:**
  - **Auto-refund:** if `refunds.create` fails (a transient error or rate limit), the customer stays charged
    for a cancelled booking. The failure only reaches `console.error`. Nothing is written to `payments` in
    that branch, so the DB has no record the money was ever taken.
  - **Charge retrieve:** if it fails, `applicationFeeId` and `stripeTransferId` are stored as `null` for good.
    A later full refund then skips the fee reversal (`charge-refunded.ts:38`), so the platform keeps a fee on
    a refunded charge while the DB marks it `reversed`.
  - **Fee refund:** if it fails with anything other than `fee_refund_already_refunded`, the handler still
    cancels locally and returns 200.
- **Why it matters:** Each of these leaves Stripe and the DB out of sync, and nothing ever retries or flags
  it. In the first case, the customer loses money.
- **Suggested fix:**
  - Auto-refund: pass `idempotencyKey: "autorefund:" + pi.id` and **rethrow** on failure, so Stripe redelivers
    and the next attempt retries safely. Rethrow only on transient or unknown errors. Treat terminal errors
    such as `charge_already_refunded` as done; otherwise Stripe keeps redelivering for 3 days. Also insert the `payments` row (status `refunded`) so there's an
    audit trail.
  - `charge.refunded`: use `charge.application_fee` from the event payload instead of the stored
    `applicationFeeId`, and throw on non-idempotent failures (`cancelConfirmedBooking` is already idempotent).
  - Succeeded handler: use `stripe.paymentIntents.retrieve(pi.id, { expand: ["latest_charge"] })`, or throw if
    the retrieve fails.

#### P3-5 · Medium · The expiry cron can starve on its own skips, never reconciles paid-but-unconfirmed bookings, and cancels after a failed PI cancel

- **Where:** `expire-pending-bookings/route.ts:35-57` (no `ORDER BY`, `.limit(50)`), `:74-81` (skip),
  `:85-91` ("proceed with seat restoration regardless").
- **What's wrong:**
  1. **Starvation.** Rows skipped because the PI is `succeeded`/`processing` still match the WHERE clause, so
     they're selected again every run. There are a few ways to accumulate 50 of them:
     - a webhook outage (F1-1);
     - ACH-style `processing` PIs (P2-5);
     - a succeeded-handler bug that makes Stripe give up after 3 days.

     Once there are 50, the batch is full of rows that are always skipped. Every other abandoned hold then
     keeps its seats indefinitely, and with the cron currently daily, that isn't noticed quickly.
  2. **No reconciliation.** In the `succeeded` case the cron already has the PI object, but it only logs.
     The customer has paid and the booking stays `pending` with no tickets delivered, until someone
     intervenes by hand.
  3. **Cancel after a failed PI cancel.** If `paymentIntents.cancel` fails, typically because the customer
     completed payment between the retrieve and the cancel, the cron still cancels the booking and restores
     the seats. The late `succeeded` webhook then falls into the auto-refund branch (P3-4). The customer gets
     charged and refunded and loses the booking, and the refund is exactly the path that isn't retried.
- **Suggested fix:**
  - Add `.orderBy(bookings.holdExpiresAt)`.
  - When the PI has `succeeded`, call the same confirm path (`handlePaymentIntentSucceeded(pi)`) so the cron
    self-heals missed webhooks. Put `processing` rows on a back-off, for example by pushing `holdExpiresAt`
    forward, so they leave the batch.
  - If the cancel call throws, re-retrieve the PI. Unless it's `canceled`, skip the booking this run and
    don't restore seats.

#### P3-6 · Medium (centralized mode) · Confirmation emails link every operator's customers to one global host

- **Where:** `lib/notifications/send-confirmation-email.ts:94` (`appUrl: env.NEXT_PUBLIC_APP_URL ?? ""`) →
  `lib/email.ts:40`. The same pattern appears in `components/booking/ConfirmedBookingView.tsx:23`.
- **What's wrong:** The boarding-pass URL is built from one deployment-wide env var, but
  `/boarding/[bookingId]` only resolves bookings for the operator behind the request host
  (`boarding/[bookingId]/page.tsx:15-20`). In centralized mode, every operator except the one whose domain
  is in `NEXT_PUBLIC_APP_URL` sends customers a link that returns 404. If the var is unset, the link is
  relative (`/boarding/…`), which is broken in any mail client.
- **Why it matters:** The confirmation email is the web customer's only persistent route to their boarding
  pass. This breaks it silently for every tenant except one, the moment a second operator goes live.
- **Suggested fix:** Resolve the base URL per operator from `domains` where `primary = true` (load it with
  the operator row that's already fetched at `:20`). Fall back to the env var only in single-deploy mode.
  Consider making `NEXT_PUBLIC_APP_URL` required in `env.ts` for single-deploy.

#### P3-7 · Medium · Trip-reminder push shows the departure time in UTC

- **Where:** `trip-reminders/route.ts:71-75`: `toLocaleTimeString("en-US", {…})` with no `timeZone`.
- **What's wrong:** Vercel functions run in UTC, and nothing sets `TZ` (no match in `next.config`,
  `vercel.json` or the test setup). A 6:00 AM ET trip is announced as "departs tomorrow at 10:00 AM" (11:00 AM
  in winter). `cron-trip-reminders.test.ts` never asserts the rendered time, and local runs happen in the
  developer's time zone, so nothing has caught it.
- **Why it matters:** A customer who trusts the reminder arrives four or five hours after the boat has left,
  on a non-refundable ticket. (The current daily schedule means few reminders fire at all; CLAUDE.md already
  tracks that. The bug matters as soon as the cron goes hourly.)
- **Suggested fix:** Use the existing `fmtTimeET(meta.startTime)` from `lib/format.ts`. Add a test asserting
  the rendered time for a fixed UTC `startTime`, run with `TZ=UTC`.

#### P3-8 · Low · Out-of-order `charge.refunded` is dropped, and a later `succeeded` retry confirms a refunded booking

- **Where:** `charge-refunded.ts:26-34` (no `payments` row → log and return 200);
  `payment-intent-succeeded.ts:23-31` retrieves the charge but ignores its refund and dispute state.
- **What's wrong:** Suppose `payment_intent.succeeded` is failing and being retried, and meanwhile the charge
  is refunded (a Dashboard refund, or the operator reacting to a complaint). The `charge.refunded` event
  finds no `payments` row and is acknowledged. The next `succeeded` retry then confirms the booking and emails
  boarding passes for a charge that has already been refunded.
- **Suggested fix:** The succeeded handler already retrieves the charge. If `charge.refunded`,
  `amount_refunded > 0` or `charge.disputed`, don't confirm; cancel instead. In `charge.refunded`, when no
  `payments` row exists, fall back to `bookings.stripePaymentIntentId = piId` and cancel a still-pending
  booking, or throw so Stripe redelivers.

#### P3-9 · Low · Tracker drift: two "fixed" webhook items aren't implemented, and "manual review" goes only to logs

- **Where:** `docs/architecture-review-findings.md:144-147` (partial refunds: "flag the booking
  `needs_review` and alert the operator", marked `[x]`) versus `charge-refunded.ts:13-18`, which only calls
  `console.error`. There's no review state in `booking_status` (`schema.ts:23-27`) and no alert.
  `:159-162` (disputes: "add `operatorId` filter", marked `[x]`) versus `charge-dispute-created.ts:18-43`,
  which has no operator predicate. The same F1-6 pattern.
- **Why it matters:** After a partial Dashboard refund, the tickets stay valid and boardable, and their fees
  go `held → earned` at settlement. The platform then reports a fee on money it returned. Nobody learns of
  it, because "manual review required" only exists in Vercel logs. Dispute openings are likewise
  log-only.
- **Suggested fix:** Add a persisted review flag (for example `bookings.needs_review_reason`) set by both
  handlers and surfaced on the admin Money page, or notify the operator by email. Add `eq(operatorId)` to
  the dispute chain using `payments.operatorId`. Re-open or annotate both tracker items.

#### P3-10 · Low · Pass 2 handoff closed: `extend-hold` revives holds that have already lapsed

- **Where:** `bookings/[bookingId]/extend-hold/route.ts:25-53` (`base = max(holdExpiresAt, now)`), and the
  cron's cancel-before-lock order (`expire-pending-bookings/route.ts:71-97`).
- **What's wrong:** Extend-hold accepts a booking whose `holdExpiresAt` has already passed, as long as it's
  within the 90-minute cap. If the cron has already selected that booking, it cancels the PI at Stripe and
  then the booking. The customer's just-extended checkout fails with `payment_intent_unexpected_state`.
  Re-checking `holdExpiresAt` under the lock in `cancelPendingBooking` wouldn't help, because the PI is
  already cancelled by then.
- **Why it matters:** No money is lost (the client handles the error), but a customer who was just told
  they have more time loses the booking.
- **Suggested fix:** In extend-hold, refuse (409) once `holdExpiresAt <= now`. Extend only live holds.

#### P3-11 · Low · Confirmation email interpolates `customerName` into HTML without escaping

- **Where:** `lib/email.ts:84` (`Hi ${p.customerName}`), and ticket and product names at `:45-52`. The input
  is `bookings/route.ts:33` (`z.string().max(100)`, free text).
- **What's wrong:** A booker controls both the recipient (`customerEmail`) and 100 characters of raw HTML,
  such as a link or styled "refund" text. That HTML is delivered from the operator's verified sending domain.
- **Why it matters:** It's a phishing vector that carries the operator's domain reputation. The risk is
  limited because an email only goes out after a successful payment.
- **Suggested fix:** HTML-escape every interpolated value in `buildHtml` (a five-character `escapeHtml`
  helper is enough).

#### P3-12 · Low · Refactor: the two cancel paths duplicate an N+1 seat-restore loop

- **Where:** `cancel.ts:40-57` and `:85-102` are the same loop (one `count(*)` query per booking item, then
  one update). The trip-cancel route has a third variant.
- **What's wrong:** Three copies of the seat-restore arithmetic have to stay in sync. P2-2(b) (count only
  un-voided tickets) and P3-1(a) (void on pending cancel) both need to change them.
- **Suggested fix:** Extract
  `releaseBookingInventory(tx, bookingId, operatorId) → { seatsRestored }`. It would:
  - void the un-voided tickets with `RETURNING booking_item_id`;
  - group the returned rows by trip;
  - apply one `seats_remaining + n` per trip;
  - set `fee_status = 'reversed'`.

  Counting from the `RETURNING` set makes a double restore impossible by construction: an already-voided
  ticket is never counted twice. That closes P2-2's oversell in the same change. Then have
  `cancelPendingBooking`, `cancelConfirmedBooking` and trip-cancel call it, and add `operatorId` to the
  signature (P2-10).

#### P3-13 · Low · Test gaps on the payment lifecycle

- **Missing tests:**
  - ticket state after `cancelPendingBooking` (P3-1);
  - a PI id or amount mismatch in the succeeded handler (P3-2);
  - the auto-refund failure path (P3-4);
  - the expiry cron when more than `BATCH_LIMIT` rows are skippable (P3-5);
  - reminder time formatting under `TZ=UTC` (P3-7);
  - `settleTrips` not earning fees on cancelled or pending bookings;
  - any direct test of `get-confirmed-booking.ts`.
- **Suggested fix:** Add them alongside the fixes above. Most are small additions to the existing per-handler
  test files.

### Handoffs to later passes

- **Pass 4:** `charge.refunded` treats a *cumulative* full refund as a full cancellation. A multi-trip booking
  whose trips are cancelled one at a time (each a partial refund from `admin/trips/[tripId]/cancel`, with
  `reverse_transfer` and `refund_application_fee`) reaches `amount_refunded === amount` on the last one. At
  that point `cancelConfirmedBooking` re-restores seats for the earlier trips' tickets. Check what booking
  status the trip-cancel path leaves behind. Same class as P2-2; the P3-12 refactor fixes both.
- **Pass 6:** Once P3-1(b) lands, the mate offline manifest and scanner must also reject tickets whose booking
  isn't `confirmed`, for the offline case. Separately, the boarding page sends every ticket's QR payload
  (currently a bearer credential) to a third party, `api.qrserver.com`
  (`boarding/[bookingId]/page.tsx:70`). Render QR codes locally instead, which matters doubly once the payloads
  are HMAC-signed.
- **Pass 8:** `booking/confirmation/page.tsx:27-28` treats `?redirect_status=succeeded` from the query string
  as proof of payment, so any booking, including a cancelled one, can be displayed as "booked".
  `getConfirmedBooking` doesn't filter by status despite its name, so each caller has to check
  `booking.status` itself.

---

## Pass 4: Reversal paths (C)

**Scope:** `apps/web/src/lib/bookings/cancel.ts`, `app/api/admin/trips/[tripId]/cancel/route.ts`,
`app/api/admin/tickets/[ticketId]/refund/route.ts`. I checked them against the "Cancellation atomicity"
and "Fee lifecycle" invariants. To confirm consequences, I also read what calls them or runs after them:
`lib/webhooks/charge-refunded.ts`, `payment-intent-succeeded.ts`, `payment-intent-canceled.ts`,
`cron/expire-pending-bookings`, `app/boarding/[bookingId]/page.tsx`, and the admin UI that calls these routes
(`admin/page.tsx`, `admin/trips/[tripId]/page.tsx`, `admin/trips/[tripId]/passengers/page.tsx`).

**Summary:** Several findings from earlier passes already cover this area, and I cross-reference them instead
of repeating them: P2-2 (list price refunded, per-ticket plus full-refund double restore), P3-1 (pending cancel
doesn't void tickets), P3-3 / P3-4 (dispute and fee-refund gaps) and P3-12 (the duplicated seat-restore loop).
What's new here is mostly in **trip cancellation**:
- It never stops sales and never handles pending bookings, so customers can be charged for a trip that's
  already cancelled (P4-1).
- On multi-trip bookings it over-refunds tickets that were already refunded individually (P4-2).
- Its retry safety is only a 24-hour idempotency key, and the tracker marks it fixed anyway (P4-3).
- It refunds platform fees proportionally, while the DB records exact per-ticket reversals (P4-5).
- Web-only customers aren't told the trip is cancelled (P4-6).

The per-ticket refund can double-restore a seat when two admins submit at once (P4-4). Nothing in this pass
leaks data across operators.

### What's clean (verified)

- **Stripe before the DB on trip cancel, with the DB write all-or-nothing.** All refunds go out first
  (`cancel/route.ts:79-100`). If any fail, the route returns 502 before any DB write (`:102-110`). The state
  change is one transaction: trip status, void tickets plus `fee_status = 'reversed'`, cancel fully refunded
  bookings, reset seats (`:116-154`). The DB never claims a refund Stripe didn't make.
- **Seat reset uses live capacity.** `seatsRemaining = trips.capacity` is evaluated in SQL inside the
  transaction (`:150-153`), which closes the earlier "stale read" tracker item. Because it's a reset rather
  than an increment, the trip being cancelled can't be double-counted (see "Handoffs closed" below).
- **Refunds pull from the operator.** Both routes pass `reverse_transfer: true`, so the connected account
  bears the refund rather than the platform. Both routes send idempotency keys (`:93-95`; `refund/route.ts:56, 63`).
- **Per-ticket refund reverses the exact fee.** When `applicationFeeId` is known, the route refunds
  `ticket.feeAmountCents` on the fee object instead of Stripe's proportional default (`refund/route.ts:45-65`).
  That is the right design, and trip cancel should copy it (P4-5).
- **Boarding page.** It overlays "cancelled" on any ticket that is voided, or whose booking or trip is
  cancelled (`boarding/[bookingId]/page.tsx:110-111`). So the stranded bookings in P4-1 at least don't render
  as valid passes.

### Operator-scoping check (against the Pass 1 source table)

All three entry points get the operator from the **admin iron-session** (Pass 1 row 3; F1-8 covers the
missing header binding). The root lookups are explicitly scoped: the trip at `cancel/route.ts:17-20` and the
ticket at `refund/route.ts:16-27`. Every child query derives its IDs from those rows, and none can reach
another operator:
- `bookingItems` by `tripId`, and `bookings` / `bookingItems` by the derived IDs (`cancel/route.ts:33, 52-55`);
- the transaction updates (`:116-154`), the count (`:157-160`) and `tripDetail` (`:165-170`);
- the ticket and trip updates in `refund/route.ts:75-85`;
- every query in `cancel.ts`.

Push goes out under `session.operatorId` (`cancel/route.ts:173`). The by-derivation rows are the P2-10
pattern, so I don't list them again. **No cross-tenant read or write found.**

### Findings

#### P4-1 · High · Trip cancellation doesn't stop sales or cancel pending bookings, so customers get charged for a cancelled trip

- **Where:** `admin/trips/[tripId]/cancel/route.ts`:
  - `:17-20`: the trip is read with no `FOR UPDATE`, and its status isn't changed yet.
  - `:33`: the `bookingItems` snapshot is taken *before* the refund loop.
  - `:69`: pending bookings are skipped.
  - `:116-146`: status is set only at the very end.

  Also relevant: `payment-intent-succeeded.ts:35-81`, which checks only `bookings.status` and never the
  trip's status or the tickets' `voided` flag.
- **What's wrong (confirmed by tracing):** There are two ways in, and both end the same way.
  1. **Pending bookings on the trip at cancel time.**
     - The route voids their tickets, because `ticketItemIds` covers every item on the trip.
     - It does not cancel the PaymentIntent, and it leaves the booking `pending`.
     - The customer, who is still on the checkout page, completes payment. `payment_intent.succeeded` finds
       a `pending` booking, confirms it, writes a `payments` row and emails a confirmation.
     - The customer has now been charged for a cancelled trip, and no refund is issued. The boarding page
       shows the passes as cancelled.
  2. **Bookings created during the cancel.**
     - The trip stays `scheduled` from `:17` until the final transaction commits. That is the full length
       of the sequential Stripe refund loop, which is seconds for a full boat.
     - `POST /api/bookings` checks `status === 'scheduled'` under its own lock, so it keeps selling.
     - Those bookings aren't in the `:33` snapshot, so their tickets are never voided and they aren't
       refunded.
     - The customer pays and gets confirmed on a cancelled trip, and `seats_remaining` is reset to capacity
       underneath them.

  `docs/architecture-review-findings.md:89-90` describes exactly this window and is marked `[x]`. Only the
  booking-side status check landed.
- **Why it matters:** Weather cancellations happen on the morning of the trip, which is exactly when people
  are mid-checkout for it. Each case is a customer charged for a boat that isn't sailing, with no automatic
  refund and no signal to the operator. There's a knock-on effect too: when a stranded pending booking later
  expires, `cancelPendingBooking` adds its ticket count back onto the cancelled trip. That's harmless today,
  but see P4-7.
- **Suggested fix:**
  - Split the cancel into phases:
    - **Phase 1:** in a transaction, lock the trip (`FOR UPDATE`) and set `status = 'cancelled'` (or a new
      `cancelling` status). Commit immediately. This closes the booking window.
    - **Phase 2:** re-read the booking items *after* phase 1. For each `pending` booking, call
      `stripe.paymentIntents.cancel`, then `cancelPendingBooking`.
    - Then run the refunds and the finalizing transaction as today.
  - Belt and braces: in `handlePaymentIntentSucceeded`, if any of the booking's trips is `cancelled`, treat
    the booking like a cancelled one and auto-refund it. That branch already exists; P3-4 covers making it
    retry-safe.

#### P4-2 · High · Partial trip-cancel refunds ignore tickets already refunded individually, so the operator over-refunds

- **Where:** `cancel/route.ts:73-74, 90-92`: `refundCents = sum(itemsOnThisTrip.subtotalCents)`.
  `subtotalCents` is the item's net-of-discount total at booking time (`bookings/route.ts:291`), and it never
  goes down when a ticket is refunded (`refund/route.ts:75-85`).
- **What's wrong:** For a multi-trip booking (so `fullRefund = false`), the route refunds the item's
  *original* subtotal, even if some of that item's tickets were already refunded through the per-ticket
  route or a Dashboard partial refund.

  Example: trip X has 4 × $68 and trip Y has 2 × $68, for a total of $408. The admin refunds one X
  passenger ($68). Later, X is cancelled, and the route refunds another $272. X has now been refunded $340
  on $272 of value. `reverse_transfer` makes the operator pay the extra $68. If earlier refunds have left
  less than `refundCents` on the charge, Stripe rejects the refund and the whole trip cancellation 502s
  (P4-3).

  Full refunds (single-trip bookings) aren't affected, because Stripe refunds only what's left.
- **Why it matters:** This is a direct money loss for the operator through two routine admin actions. It
  isn't the list-price issue in P2-2(2): it happens with no discount at all.
- **Suggested fix:** Compute the refund from the tickets that are **still live**: the sum of their net
  price once P2-2(a) stores it. The cleanest way is to do it inside the phase-2 transaction from the void's
  `RETURNING` set (P3-12's helper). As a last guard, cap the refund at
  `charge.amount - charge.amount_refunded`.

#### P4-3 · Medium · Refund retry safety is only a 24-hour idempotency key; the "fixed" tracker items never got a ledger

- **Where:**
  - `cancel/route.ts:83-95`: the key is `refund:${bookingId}:${tripId}`, and the request params include
    `metadata.reason`, which is admin free text.
  - `refund/route.ts:47-72`: Stripe first, then the DB.
  - The tracker items marked `[x]`: `docs/architecture-review-findings.md:164-166` (per-ticket refund not
    atomic; the fix called for DB-first) and `:169-172` (trip-cancel partial failure; the fix called for a
    `refund_ledger` table).
  - What actually landed (`fea7a19`) was idempotency keys only. No `refund_ledger` table exists.
- **What's wrong:**
  1. **After a 502 from trip cancel,** the refunds that went through aren't recorded anywhere.
     - Single-trip bookings sort themselves out through `charge.refunded` → `cancelConfirmedBooking`.
     - Multi-trip (partial) refunds hit the "manual review" log-only branch (`charge-refunded.ts:13-18`).
       Those tickets stay live on a trip that is still `scheduled` and still selling.
  2. **A retry with edited reason text** sends different params under the same key. Stripe rejects that as
     an idempotency error, so the retry 502s again.
  3. **A retry after 24 hours:**
     - Keys have expired, so every partial refund that's still `confirmed` goes out **a second time**.
     - Any refund that can never succeed blocks the whole trip's cancellation: for example, a charge that was
       fully refunded in the Dashboard while the booking row went stale (P3-8), or the P4-2 overflow.
  4. **Per-ticket route:** if `refunds.create` succeeds and `applicationFees.createRefund` fails, the route
     returns 502 and the ticket stays live and boardable. The customer has already been refunded. The DB is
     only corrected if an admin retries within 24 hours; otherwise settlement later marks the fee `earned`.
- **Why it matters:** Stripe and the DB drift apart, and the only recovery path, "retry", is itself unsafe
  after a day.
- **Suggested fix:**
  - Record refund intent durably. Either add the `refund_ledger` the tracker specified, keyed by
    `(booking_id, trip_id | ticket_id)` with the Stripe refund id and status, or add `refunded_at` /
    `stripe_refund_id` columns to `tickets`. Write the row before calling Stripe and update it after.
  - On retry, skip anything already recorded as refunded. Treat `charge_already_refunded` as done.
  - Keep request params stable: move `reason` out of the Stripe params, or keep only a fixed code there.
  - Re-open both tracker items.

#### P4-4 · Medium · Per-ticket refund has no lock or conditional void, so concurrent submits restore the seat twice

- **Where:** `refund/route.ts:16-40` (an unlocked read plus a `voided` check), `:75-85` (an unconditional
  `UPDATE … SET voided = true` plus `seats_remaining + 1`).
- **What's wrong:** Two requests for the same ticket both pass the `voided = false` check. Stripe
  deduplicates the money through the shared idempotency key. Both transactions then run, restoring **+2
  seats for one ticket**.

  In a single tab the UI disables that ticket's button (`trips/[tripId]/page.tsx:490`, and `busyTicket` on
  the passengers page). So this needs two tabs, two admins (office and dock), or the legacy trip page and the
  passengers page open together. The same unlocked check also races `cancelConfirmedBooking`.
- **Why it matters:** It's a silent oversell. The CHECK constraint in F1-12 / P2-2(c) would turn it into an
  error instead.
- **Suggested fix:** Inside one transaction:
  - lock the booking (`FOR UPDATE`) and re-check `status = 'confirmed'`;
  - run `UPDATE tickets SET voided = true, fee_status = 'reversed' WHERE id = $1 AND voided = false RETURNING trip_id`;
  - restore the seat only if a row came back.

  Combined with P4-3's ledger (write intent → call Stripe → finalize), this makes the route idempotent end
  to end.

#### P4-5 · Medium · Partial trip-cancel refunds reverse the platform fee proportionally, but the DB reverses it per ticket

- **Where:** `cancel/route.ts:85`: `refund_application_fee: true` on a partial refund; `:130-133`:
  `feeStatus: 'reversed'` on exactly this trip's tickets. The per-ticket route uses the same proportional
  fallback when `applicationFeeId` is null (`refund/route.ts:45, 53`).
- **What's wrong:** Stripe's API reference says that on a partial refund with
  `refund_application_fee: true`, the application fee is refunded **in proportion to the amount refunded**.
  The DB instead marks $1.50 reversed on each cancelled ticket.
  - **Example:** trip X is 4 × $40 and trip Y is 1 × $200. The charge is $360 and the fee is $7.50.
  - **Cancel X:** Stripe refunds 750 × 16000 / 36000 = $3.33 of the fee, but the DB records $6.00
    reversed. The platform keeps $4.17 in Stripe, while revenue will show $1.50.
  - **Cancel Y instead:** Stripe refunds $4.17, but the DB records $1.50 reversed. Revenue is overstated by
    $2.67.
- **Why it matters:** Revenue reports, which the fee lifecycle exists to support, stop matching platform
  payouts on every multi-trip partial cancellation. This is the reconciliation drift the per-ticket route
  was written to avoid.
- **Suggested fix:** Handle fees the same way the per-ticket route does:
  - pass `refund_application_fee: false`;
  - call `applicationFees.createRefund(applicationFeeId, { amount: sum(live tickets' feeAmountCents) })` with
    an idempotency key;
  - fall back to `charge.application_fee` from Stripe when the stored ID is null (P3-4).

  Keep `refund_application_fee: true` only on full refunds.

#### P4-6 · Medium · Trip-cancellation notice is push-only and goes to the wrong people

- **Where:** `cancel/route.ts:162-184`.
- **What's wrong:**
  - The only notification is Expo push. Web customers (guest checkout, no app) get **no cancellation
    notice**: `lib/email.ts` has no cancellation template. The PI is created without `receipt_email`
    (`bookings/route.ts`), so unless Dashboard receipts are configured, Stripe won't send a refund receipt
    either. And even a receipt doesn't tell the customer not to come to the dock.
  - The recipient list is every `affectedBookings` email. That includes pending (unpaid) bookings, bookings
    already cancelled, and multi-trip bookings that only get a partial refund. All of them are told "A full
    refund is on the way."
  - The admin toast reports `ticketsVoided` as "N refunds are on their way" (`admin/page.tsx:107-110`).
    That count includes tickets on pending bookings and tickets refunded earlier (`:157-160` counts every
    voided ticket on the trip).
- **Why it matters:** Web customers drive to the dock for a trip that isn't running. Unpaid customers are
  promised refunds that don't exist. The operator's own confirmation toast overstates how many refunds went
  out.
- **Suggested fix:**
  - Send a cancellation email to confirmed bookings in `refundPlans`, with wording for full vs. partial
    refunds.
  - Restrict push to the same set.
  - Return `refundsIssued: refundPlans.length` and have the toast use it.

#### P4-7 · Medium · Seat restores still land on cancelled trips; adding the capacity CHECK first would break the webhook and the cron

- **Where:** `cancel.ts:45-56, 90-102`: both loops add `count(*)` of **all** tickets onto `item.tripId`, and
  never look at trip status or `voided`. The recommended `CHECK (seats_remaining <= capacity)` comes from
  F1-12 and P2-2(c).
- **What's wrong:** After a trip cancel resets `seats_remaining = capacity`, two paths still add seats back
  onto that trip:
  1. **The expiry cron,** for a pending booking stranded by P4-1.
  2. **`charge.refunded`,** when the cumulative refund on a multi-trip booking reaches the full amount
     (see "Handoffs closed" below).

  Today both leave a cancelled trip with `seats_remaining > capacity`. That's cosmetic, because the trip
  can't be sold. Once the CHECK lands, those updates **throw**:
  - The webhook returns 500 and Stripe retries it for 3 days. The booking is never cancelled.
  - The cron catches the error per booking (`expire-pending-bookings/route.ts:66-67, 121-124`), but the row matches
    again on every run. That fills the batch and makes P3-5's starvation worse.
- **Why it matters:** This is an ordering dependency between two recommended fixes. Shipping the CHECK on its
  own turns a cosmetic inconsistency into a stuck webhook.
- **Suggested fix:** The shared helper from P3-12 (`releaseBookingInventory`) should:
  - count only the tickets it actually voids (from `RETURNING`);
  - skip the seat increment for trips whose status is `cancelled`, and decide explicitly what to do for
    `sailed` / `pending_settlement`, most likely no restore.

  Land it **before or together with** the CHECK.

#### P4-8 · Low · Trip cancel derives "cancel the booking" from item counts, not live tickets

- **Where:** `cancel/route.ts:73`: `fullRefund = allItems.length === itemsOnThisTrip.length`; `:137-146`.
- **What's wrong:**
  - A multi-trip booking is never cancelled locally by trip cancel, even when this trip held its **last**
    live tickets. Two examples: the other trip was cancelled earlier, or its tickets were all refunded one
    by one.
  - The booking stays `confirmed` with every ticket voided. It only reaches `cancelled` if the cumulative
    `charge.refunded` fires. It won't fire if penny drift (`architecture-review-findings.md:282`) leaves
    `amount_refunded` a cent short. When it does fire, it runs the over-counting restore from P4-7 / P2-2.
  - The same count-based rule also picks a partial refund where a full one would be correct, so Stripe
    keeps the leftover cents.
- **Suggested fix:** After voiding, check whether any non-voided ticket remains on the booking. If none does,
  treat the booking as fully refunded: refund with no `amount` and set `status = 'cancelled'` in the same
  transaction.
- **Why it matters:** The booking stays `confirmed` with no live tickets. Its only way to reach `cancelled`
  is the over-counting webhook, and if that never fires, it stays stuck over a one-cent shortfall.

#### P4-9 · Low · Cancelling a sailed or settling trip only logs a warning

- **Where:** `cancel/route.ts:28-30`.
- **What's wrong:** A `sailed` (or `pending_settlement`) trip can be cancelled with just a `console.warn`.
  That refunds every passenger, including checked-in ones, reverses fees already `earned`, and resets seats.
  It also writes `status = 'cancelled'` over `sailed`, which drops the trip out of settlement and the
  fishing-report flows.
- **Suggested fix:** Return 409 for `sailed` / `pending_settlement`, unless the request carries an explicit
  `force: true` that the UI asks for with a separate confirmation. Post-trip refunds should go through
  per-ticket refunds.
- **Why it matters:** One mis-click after a trip refunds a boat that has already sailed, and erases earned
  revenue with no undo.

#### P4-10 · Low · Refactor: trip cancellation is ~180 lines of domain logic inline in a route

- **Where:** `cancel/route.ts:9-193`.
- **What's wrong:** Refactoring-backlog item 5 moved *booking* cancel into `lib/bookings/cancel.ts`, but trip
  cancel still mixes the following in one handler:
  - refund planning;
  - Stripe calls;
  - the state transaction;
  - notification fan-out.

  P4-1, P4-2, P4-3, P4-5 and P4-8 all change this code. Today it can only be tested through the HTTP route,
  with Stripe mocked.
- **Suggested fix:** Extract `cancelTrip(operatorId, tripId, reason)` into `lib/bookings/cancel-trip.ts`,
  built on:
  - a pure `planTripRefunds(bookings, items, liveTickets) → [{ bookingId, amount | 'full', feeCents }]`,
    which can be unit-tested;
  - P3-12's `releaseBookingInventory`.

  The route then only authenticates and calls it.
- **Why it matters:** Five findings in this pass change this handler, and none of those changes can be
  unit-tested until it's extracted.

#### P4-11 · Low · Test gaps on the reversal paths

- **Where:** `test/api/admin-cancel.test.ts` (5 cases), `admin-ticket-refund.test.ts` (4 cases).
- **What's missing:**
  - a multi-trip booking (the partial-refund amount, and that the booking stays `confirmed`);
  - a pending booking on the trip being cancelled (P4-1);
  - a trip cancel after an earlier per-ticket refund (P4-2);
  - a refund failure on the second of two bookings (a 502 with no DB change, then a safe retry);
  - the per-ticket fee-refund failure path;
  - concurrent per-ticket refunds (P4-4);
  - the `refund_application_fee` / `applicationFees.createRefund` split (P4-5).
- **Suggested fix:** Add these alongside the fixes. The `planTripRefunds` extraction (P4-10) makes most of
  them plain unit tests.
- **Why it matters:** The money-moving branches behind P4-1 to P4-5 have no regression coverage, which is
  how they went unnoticed.

### Handoffs closed

- **From Pass 2, "is per-ticket refund routine?": yes. Raise P2-2 to Critical.**
  - Every row on the passengers page has a one-click "Refund" button
    (`admin/trips/[tripId]/passengers/page.tsx:257-261, 285-287`). The success toast says "The seat is back
    on sale." (`:116`). The legacy trip page has the same button (`trips/[tripId]/page.tsx:489-493`).
  - Refunding every ticket of a party that can't make it is an ordinary admin action, and it triggers
    P2-2(1)'s double restore on a **live** trip.
  - I'm not editing P2-2 in place; treat this as the updated severity.
- **From Pass 2, P2-2(b) sweep of the trip-cancel seat math.**
  - Trip cancel resets the cancelled trip to `capacity` (`cancel/route.ts:150-153`) and doesn't count
    tickets, so it can't double-count *that* trip.
  - The double count happens later, on the booking's *other* trips, when the cumulative `charge.refunded`
    runs `cancelConfirmedBooking`. It also lands back on the cancelled trip itself (P4-7).
- **From Pass 3, "what booking status does trip cancel leave behind?": `confirmed`, for any multi-trip
  booking (P4-8).**
  - **Sequence 1:** trip X cancelled (a partial refund), then trip Y cancelled (another partial refund,
    because `allItems.length` is still 2).
    - The cumulative refund equals the charge amount, so `charge.refunded` fires and
      `cancelConfirmedBooking` runs.
    - It counts **all** tickets on X and on Y, and adds them back to both cancelled trips. Today that's
      cosmetic, and it becomes a stuck webhook once the CHECK lands (P4-7).
  - **Sequence 2:** trip X cancelled, then Y's passengers refunded one by one. The final refund triggers the
    same webhook, which re-restores Y's seats on a **live** trip. That's an oversell (P2-2 class).
  - The P3-12 helper, counting from `RETURNING` and skipping cancelled trips (P4-7), fixes both.
- **Tracker drift (same pattern as F1-6 and P3-9).** These items in
  `docs/architecture-review-findings.md` are marked `[x]` but only partly landed. Re-open or annotate all
  three:
  - `:89-90`: the trip-cancel booking window (P4-1);
  - `:164-166`: per-ticket refund atomicity (P4-3 item 4);
  - `:169-172`: the trip-cancel refund ledger (P4-3).

---

## Pass 5 Auth (F + I)

**Scope:** `apps/web/src/lib/session-factory.ts`, `session.ts`, `platform-session.ts`, `customer-auth.ts`,
`mate-auth.ts`, `rate-limit.ts`; `app/api/auth/request`, `auth/verify`, `mate/auth`, `admin/auth/{login,logout,me}`,
`platform/auth`; `app/api/stripe/connect/start` and `callback`. To confirm consequences, I also read what
consumes the credentials these issue: `account/bookings`, `push/register`, `admin/settings/staff/*`,
`reports/upload`, `mate/manifest`, the wallet GET in `bookings/route.ts:374-424`, the `iron-session@8.0.4`
source, and the webhook's event list.

**Summary:** Nothing in this pass leaks data across operators, and the three CLAUDE.md auth invariants hold
(checked below). The problems are about **how long a credential stays good and how hard it is to guess**:
- Admin and platform sessions are sealed for 14 days, not 8 h / 4 h, and are never re-checked against the
  `staff` table. A deactivated admin keeps full access, including the Stripe payout destination (P5-1).
- The dummy bcrypt hash that was meant to close the staff-enumeration timing oracle is malformed, so the fix
  does nothing (P5-2, measured).
- A 4-digit mate PIN can be brute-forced in about three weeks with no lockout and no alert (P5-3).
- Stripe Connect: the callback marks onboarding complete without asking Stripe, nothing reacts to a
  disconnected account, and a reconnect silently replaces the payout destination (P5-4, P5-5).

F1-5, F1-6, F1-8 and P2-8 are built on here and not repeated.

### What's clean (verified)

- **Token audiences (invariant).** `signCustomerToken` / `signMateToken` write `aud` *after* spreading the
  payload, so a payload field can't override it (`customer-auth.ts:20`, `mate-auth.ts:20`). Each verify
  function rejects any other audience (`:42`, `:44`), is module-private, and is reachable only through
  `requireCustomer` / `requireMate`. Both directions are unit-tested (`test/lib/customer-auth.test.ts:76`,
  `mate-auth.test.ts:77`). Signatures are compared with a length check plus `timingSafeEqual`.
- **No cross-use of sealed cookies.** The admin and platform cookies share a password, but each
  `isAuthorized` needs a field the other never has (`staffId` + `role === "admin"` vs. `authenticated`), so
  swapping cookie names gains nothing.
- **Separate customer and staff tables (invariant).** The customer path touches only `magic_link_otps` and
  `customers`. The mate and admin paths touch only `staff`. Neither falls back to the other.
  `reports/upload` tries a mate token and then an admin session, but both are staff credentials.
- **`checkRateLimit()` first (invariant).** On `auth/request`, `auth/verify`, `mate/auth`,
  `admin/auth/login` and `platform/auth`, the limiter is the first DB operation. Only body parsing and a
  header read come before it. `admin/auth/me` and `logout` have no limiter and need none: they only unseal
  a cookie.
- **Rate limiter core.** The upsert is one atomic statement, so concurrent requests can't under-count
  (`rate-limit.ts:35-50`). A blocked request increments the count but doesn't extend the window, so a
  bucket can't be held shut forever by its own 429s. A DB failure throws, so the limiter fails closed.
  `clientIp` prefers `x-real-ip` and then the rightmost `x-forwarded-for` hop, which closes the earlier P1.
  This holds only while Vercel is the first hop: put a CDN or proxy in front and every visitor shares the
  proxy's bucket.
- **OTP basics.** Codes are stored hashed, expire in 15 min, and a new request invalidates older codes for
  that operator + email (`auth/request/route.ts:40-49`).
- **Connect CSRF.** The callback requires an admin session and a `state` that matches the HMAC of an
  httpOnly nonce cookie, compared in constant time, before it reads anything else (`callback/route.ts:10-32`).
  The classic OAuth CSRF (make the victim finish the flow with the attacker's `code`) fails, because the
  attacker can't learn or set the victim's nonce. The OAuth `access_token` and `refresh_token` are
  discarded; only `stripe_user_id` is kept.
- **Admin API CSRF.** Session cookies are `httpOnly`, `sameSite=lax` and host-only, and every admin route
  that takes an instruction is non-GET. Two kinds of GET change state. The Connect callback has its own
  `state`. `admin/today`, `admin/revenue` and `admin/reports/pending` run the lazy `settleTrips`, which is
  idempotent and takes no input from the request.
- **Mobile storage.** Both apps keep their token in `expo-secure-store` (`apps/mobile/lib/customer-auth.ts`,
  `mate-auth.ts`).

### Operator-scoping check (against the Pass 1 source table)

The operator sources match the Pass 1 baseline:
- **`x-operator-id` header:** `auth/request`, `auth/verify`, `mate/auth`, `admin/auth/login`.
- **Token checked against the header:** `account/bookings`, `push/register`.
- **Admin iron-session, not checked against the header:** `stripe/connect/start` and `callback` (F1-8).
- **No tenant:** `platform/auth`. `admin/auth/me` and `logout` run no queries.

| Query / key | Location | Scoped? |
|---|---|---|
| OTP invalidate + insert | `auth/request/route.ts:40-56` | ✅ explicit (header operator) |
| OTP select | `auth/verify/route.ts:35-47` | ✅ explicit |
| OTP mark-used `WHERE id` | `auth/verify/route.ts:59` | ⚠️ by derivation (P2-10 pattern) |
| `customers` find / create | `auth/verify/route.ts:62-73` | ✅ explicit |
| `staff` lookup (mate) | `mate/auth/route.ts:36-39` | ✅ explicit (header operator) |
| `staff` lookup (admin) | `admin/auth/login/route.ts:27-30` | ✅ explicit. The session then stores `member.operatorId`, which equals the header at login time. |
| `UPDATE operators` (Connect) | `stripe/connect/callback/route.ts:82-89` | ✅ `session.operatorId` (not the header; F1-8) |
| `account/bookings`: bookings | `account/bookings/route.ts:12-18` | ✅ token operator + token email |
| `account/bookings`: items, tickets | `:24-54` | ⚠️ by derivation (P2-10 pattern) |
| `push/register` upsert / deactivate | `push/register/route.ts:31-57, 73-82` | ✅ token operator |
| Rate-limit keys: `mate-auth`, `admin-login`, `wallet-lookup` | `mate/auth:29-30`, `admin/auth/login:24`, `bookings/route.ts:383-384` | ✅ operator-prefixed |
| Rate-limit keys: `otp-request`, `otp-verify` | `auth/request:23-24`, `auth/verify:24-25` | ❌ global across operators (P5-7) |
| Rate-limit key: `platform-auth` | `platform/auth/route.ts:8` | n/a (no tenant) |

**No cross-tenant read or write found.**

### Findings

#### P5-1 · High · Admin and platform sessions are valid for 14 days and are never re-checked, so deactivating an admin doesn't remove their access

- **Where:**
  - `lib/session-factory.ts:13-22`: passes `cookieOptions.maxAge` but no `ttl`.
  - `node_modules/.pnpm/iron-session@8.0.4/node_modules/iron-session/dist/index.js:10-11`
    (`ttl: fourteenDaysInSeconds`) and `:101-117` (`getSessionConfig`). This is the installed library, not
    project code. When `maxAge` is supplied, `ttl` keeps its 14-day default. `maxAge` only tells the
    browser when to drop the cookie; the seal itself is accepted for 14 days.
  - `lib/session-factory.ts:29-37`: `requireSession` checks the cookie contents only. It never reads `staff`.
  - `admin/auth/logout/route.ts:4-7` and `platform/auth/route.ts:28-32`: `destroy()` clears the browser
    cookie. Nothing is recorded server-side.
  - `admin/settings/staff/[staffId]/route.ts:26-28, 33, 48-53`: deactivation and password reset change the
    row and nothing else.
- **What's wrong (confirmed by reading the library):**
  1. The "8 hours" (`session.ts:12`) and "4 hours" (`platform-session.ts:10`) limits exist only in the
     browser. A cookie value copied out of the browser, a proxy log or a backup works for 14 days, and it
     keeps working after logout.
  2. A deactivated admin with a live session can still call every admin route. `active` is checked only at
     login (`admin/auth/login/route.ts:45-47`). They can:
     - re-activate themselves: the guard at `[staffId]/route.ts:27` blocks only *self-deactivation*;
     - create a second admin account (`staff/route.ts:30-91`) as a way back in after the seal expires;
     - issue refunds, and open `/api/stripe/connect/start` to replace the operator's payout account (P5-5).
  3. Resetting a compromised admin's password doesn't end the attacker's session.
  4. Rotating `PLATFORM_SECRET` doesn't end platform sessions. They are sealed with `SESSION_SECRET`, and the
     session holds only `authenticated: true`.
- **Why it matters:** "Deactivate" is the operator's only tool for removing a departed office manager, and
  it doesn't work against anyone who is still logged in. The admin session controls refunds and where sales
  are paid out, so this is a direct money path. The tracker already lists revocation for customer and mate
  tokens as open (`architecture-review-findings.md:244-246`). The admin and platform sessions aren't
  mentioned there, and they are the higher-value ones.
- **Suggested fix:**
  - Pass `ttl: options.maxAge` in `makeSession`, so the seal expires when the cookie does. This only affects
    new seals: the expiry is written into the seal when it's created (`node_modules/.pnpm/iron-webcrypto@1.2.1/node_modules/iron-webcrypto/dist/index.js:233, 266-271`,
    the library iron-session uses to seal cookies), so cookies already issued stay valid for their 14 days. The staff re-check below is what
    closes those.
  - In `requireAdmin`, load the staff row (`id`, `operatorId`, `active`, `role`) and reject when it's
    missing, inactive or no longer an admin. That is one indexed read per admin request. Do it in the same
    change as F1-8's header check, since both belong in `requireAdmin`.
  - Add a `session_version` integer to `staff`, store it in the session, and bump it on password reset, PIN
    reset and deactivation. The same column closes the open tracker item for mate tokens.
  - For the platform session, store an HMAC of the current `PLATFORM_SECRET` in the session and compare it
    on each request, so rotating the secret logs everyone out.

#### P5-2 · Medium (confirmed by measurement) · The dummy bcrypt hash is malformed, so the staff-enumeration timing fix does nothing

- **Where:** `mate/auth/route.ts:41-46` and `admin/auth/login/route.ts:32-35`: the same `DUMMY_HASH` literal.
  The tracker item is `docs/architecture-review-findings.md:179-183`, marked `[x]`.
- **What's wrong:** The literal is 59 characters. A bcrypt hash is 60, and `bcryptjs` returns `false`
  straight away for any other length. Measured locally against the installed `bcryptjs`:

  | Input | Result | Time |
  |---|---|---|
  | `compare("9999", DUMMY_HASH)` | `false` | 0.16 ms |
  | `compare("9999", <real cost-12 hash>)` | `false` | 249 ms |

  An unknown email therefore answers about 250 ms faster than a known one, which is the oracle the fix was
  meant to remove. Three related gaps:
  - Even a valid literal would be cost 10, while staff hashes are cost 12 (`staff/route.ts:56, 60`, the seed
    scripts), so it would still answer about 4× faster.
  - The platform-created admin is hashed at cost 10 (`platform/operators/route.ts:75`), so that account is
    distinguishable from the rest.
  - On `mate/auth`, an admin row with no `pinHash` also takes the fast path, so the oracle separates "mate"
    from "admin or unknown".
- **Why it matters:** It turns P5-3 from a blind attack into a targeted one: an attacker can first confirm
  which email addresses are mate accounts, then spend guesses only on those. The tracker says this is
  closed. (Same drift pattern as F1-6, P3-9 and the Pass 4 list.)
- **Suggested fix:** Build the dummy once at module scope with `hashSync("not-a-real-credential", 12)` in a
  shared `lib/password.ts`, and export one `BCRYPT_COST` used by every `hash()` call, including
  `platform/operators`. Add a test that `compare(x, DUMMY_HASH)` takes a comparable time to a real compare
  (or simply that `DUMMY_HASH.length === 60` and its cost matches). Re-open the tracker item.

#### P5-3 · Medium · A 4-digit mate PIN can be brute-forced in about three weeks, with no lockout and no alert

- **Where:** `mate/auth/route.ts:23-34` (5 attempts per 15 min per email; the comment at `:23-24` does the
  same arithmetic); `admin/settings/staff/route.ts:59` and `[staffId]/route.ts:58` (`^\d{4,8}$`);
  `seed-mate.ts` (PIN `1234`).
- **What's wrong:** The per-email bucket allows 480 guesses a day against 10,000 PINs, so any 4-digit PIN
  falls within 21 days, and half of them within 11. The bucket is a fixed window that simply reopens. No
  counter persists across windows, nothing locks the account, and nobody is told. Rotating source IPs
  avoids the IP bucket and isn't even needed at this rate. P5-2 tells the attacker which emails to target.
- **Why it matters:** A mate token (24 h, renewable by logging in again once the PIN is known) gives:
  - the manifest for any trip: customer names, emails and phone numbers, plus every ticket's `qrPayload`
    (`mate/manifest/route.ts:60-80`), which is a boarding credential while it's a bare UUID;
  - check-in writes and trip-capacity edits, which change what can be sold.

  It is the weakest credential in the system and it guards customer PII and seat inventory.
- **Suggested fix:**
  - Raise the minimum to 6 digits for new PINs. 6 digits with the same limiter is about 5.7 years. This is
    the main fix.
  - Add a counter that persists across windows on the `staff` row (`failed_pin_attempts`, `locked_until`),
    with an escalating time-based lock, for example 1 hour after 10 consecutive failures. Increment it
    atomically **before** `compare`, in one statement
    (`UPDATE staff SET failed_pin_attempts = failed_pin_attempts + 1 WHERE id = $1 AND (locked_until IS NULL OR locked_until < now()) RETURNING …`),
    and reset it on success. A read-then-write around the 250 ms compare would let concurrent guesses
    through.
  - Don't lock until an admin resets the PIN. With P5-2's enumeration, that would let anyone lock every
    mate out for good with about 10 requests each, which is a worse version of P5-6.
  - Email the operator's admins when an account reaches the lock threshold.

#### P5-4 · Medium (Stripe behavior needs confirmation) · Connect callback marks onboarding complete without asking Stripe, and nothing reacts when an account is disconnected

- **Where:** `stripe/connect/callback/route.ts:82-89` (sets `stripeOnboardingComplete: true` for any
  `stripe_user_id`); `bookings/route.ts:90` (checkout is gated on `stripeAccountId` alone); `admin/money/page.tsx:121`
  and `settings/operator/page.tsx:177-190` (the UI shows "Connected"); `webhooks/stripe/route.ts:48-56` (no
  `account.updated` or `account.application.deauthorized` branch); `start/route.ts:23` (`redirect_uri` built
  from the request host).
- **What's wrong:**
  1. The callback never retrieves the account, so it doesn't know whether `charges_enabled` and
     `payouts_enabled` are true. `stripeOnboardingComplete` is therefore not a statement about Stripe, and
     the booking route doesn't read it anyway.
  2. If an operator disconnects the platform from their Stripe dashboard, or Stripe restricts the account,
     the stored `stripeAccountId` stays. Every checkout then holds seats, fails at
     `paymentIntents.create`, runs the compensation path and returns the generic 502. The operator's admin
     still shows "Connected".
  3. *Needs confirmation:* Stripe matches `redirect_uri` against a list registered on the platform's
     Connect settings. In centralized mode each tenant domain would have to be registered by hand, or the
     flow fails at Stripe for every new operator.
  4. *Needs confirmation:* this is the OAuth flow for Standard accounts, which Stripe documents as a legacy
     onboarding path. Confirm the platform account is allowed to use it in live mode before go-live.
     `docs/openboatfishing-demo-deploy.md:36-40` sets the demo account up by hand, so the OAuth path may
     never have run against a real account.
- **Why it matters:** The DB says an operator can take payments when Stripe says it can't. The result is
  lost sales with no signal to anyone, and seat holds churning on every attempt.
- **How to confirm:** In test mode, connect an account that hasn't finished activation and attempt a
  booking. Then revoke the platform's access from the connected account's dashboard and attempt another.
- **Suggested fix:**
  - In the callback, call `stripe.accounts.retrieve(accountId)` and store `charges_enabled &&
    payouts_enabled` as `stripeOnboardingComplete`.
  - Gate `POST /api/bookings` on `stripeOnboardingComplete` as well, before any seat is held, with a clear
    "online booking is temporarily unavailable" response.
  - Subscribe to `account.updated` (refresh the flag) and `account.application.deauthorized` (clear
    `stripeAccountId` and the flag). When adding these, keep P3-2's rule: accept `event.account` only for
    these account events, never for `payment_intent.*`.
  - Use one platform-host callback URL and carry the operator in a signed `state` (P5-5), so one registered
    redirect URI serves every tenant.

#### P5-5 · Medium · Reconnecting Stripe silently replaces the payout destination; `state` isn't bound to the operator

- **Where:** `stripe/connect/start/route.ts:6-45` (a plain GET link: `admin/money/page.tsx:158`,
  `settings/operator/page.tsx:187-190`); `callback/route.ts:82-89` (unconditional overwrite);
  `start/route.ts:20-21` (`state = HMAC(nonce)`); `:37-42` (nonce cookie without `secure`). The tracker item
  is `architecture-review-findings.md:36-40`, marked `[x]`, which specified HMAC of `operatorId + nonce`.
- **What's wrong:**
  1. Any admin session can replace `operators.stripe_account_id` with a different Stripe account in two
     clicks. There is no re-authentication, no confirmation that an account is already connected, no record
     of the previous value, and no notice to anyone. From that moment every new booking's
     `transfer_data.destination` is the new account (`bookings/route.ts:337`).
  2. `state` is the HMAC of the nonce alone, under the `SESSION_SECRET` that every tenant shares. A
     nonce/state pair minted on operator B's domain verifies on operator A's. I found no way to exploit
     this today: the attacker would still have to plant the nonce cookie in the victim's browser, and the
     cookies are host-only. It is the half of the tracker fix that didn't land.
  3. The nonce cookie isn't marked `secure` and isn't cleared on the failure paths. Both are minor.
- **Why it matters:** The payout destination is the most valuable setting an operator has. Combined with
  P5-1 (a deactivated admin's session still works), one person can redirect all future revenue, and the
  operator finds out when a payout doesn't arrive. Existing bookings aren't affected: refunds reverse the
  original transfer.
- **Suggested fix:**
  - Compute `state` as HMAC of `nonce + ":" + session.operatorId + ":" + session.staffId`, and verify all
    three in the callback.
  - When `stripeAccountId` is already set, require the admin's password again, or a platform-side approval,
    before overwriting it.
  - Write an audit row (who, when, old account, new account) and email the operator's `emailFrom` address on
    every change.
  - Set `secure` on the nonce cookie in production and delete it on every exit path.

#### P5-6 · Low · Rate-limit buckets count every request, and both buckets are charged even when one has already blocked

- **Where:** `auth/request/route.ts:22-25`, `auth/verify/route.ts:23-26`, `mate/auth/route.ts:28-31`,
  `bookings/route.ts:386-389`: `Promise.all` over the IP bucket and the email bucket.
  `admin/auth/login/route.ts:24`: IP bucket only.
- **What's wrong:**
  1. The email bucket is incremented even when the IP bucket has already returned "blocked". The IP limit
     therefore doesn't protect accounts from lockout. One client, already over its own limit, can keep any
     number of email buckets full: 5 requests per 15 min per mate locks every mate login for an operator,
     and 10 per 15 min locks a customer's OTP sign-in. This generalizes the wallet case in P2-8.
  2. Successful attempts count too, and only the wallet lookup resets on success. A mate who signs in on
     two devices and mistypes a few times locks themselves out.
  3. Each blocked request can still insert a new `rate_limits` row for a fresh email string. The table
     grows until the daily purge, which the tracker already lists as coupled to the expiry cron (`:248-254`).
  4. Admin login has no per-account bucket, so guesses spread over many IPs are unthrottled. The mate and
     OTP routes both have one. The practical risk is low (8-character minimum, bcrypt cost 12).
- **Why it matters:** The limiter stops guessing but hands out a cheap denial of service. The worst case is
  mates unable to sign in at the dock on a busy morning. A mate token lasts 24 h, so each working day
  starts with a login.
- **Suggested fix:** Add `checkLoginLimits(req, { scope, account })` to `rate-limit.ts` and use it on all
  four routes:
  - check the IP bucket first and return 429 before touching the account bucket;
  - keep the atomic increment on the account bucket **before** verifying the credential, so each attempt
    reserves a slot, and reset the bucket on success. Don't switch to "read first, increment on failure":
    the bcrypt compare takes about 250 ms, and concurrent guesses would all read the same count and pass;
  - cap the key length (for example, reject emails over 254 characters before the limiter).

  This removes the single-client lockout (item 1) and the self-lockout (item 2). A distributed attacker can
  still fill one account's bucket; that is the price of having a per-account limit at all.

#### P5-7 · Low · OTP rate-limit keys aren't operator-scoped; the tracker is wrong in both directions

- **Where:** `auth/request/route.ts:23-24` (`otp-request:ip:…`, `otp-request:email:…`);
  `auth/verify/route.ts:24-25` (`otp-verify:ip:…`, `otp-verify:…`). Tracker:
  `architecture-review-findings.md:139-142` (marked `[x]`, "prefix all rate-limit keys") and `:278-280`
  (still `[ ]`, although `mate-auth` and `admin-login` *are* prefixed now).
- **What's wrong:** In centralized mode these four buckets are shared by every operator. Traffic on
  operator A's domain uses up the OTP budget for the same email, or the same NAT'd IP, on operator B's.
  The limiter also runs before the operator is resolved (`request/route.ts:30`, `verify/route.ts:31`), which
  is why the prefix was missed.
- **Why it matters:** It is the cross-tenant denial of service the tracker item describes, left open on the
  customer sign-in path.
- **Suggested fix:** Read `getOperatorId(req)` (a header read, no DB) before the limiter and prefix all
  four keys, as `mate/auth` does. Tick `:278` and annotate `:139`.

#### P5-8 · Low · OTP codes come from `Math.random()`

- **Where:** `auth/request/route.ts:34`.
- **What's wrong:** Same class as F1-7, on a more exposed path. The OTP is the only credential for a
  customer account, and unlike the temporary admin password, an attacker can request as many samples as
  the limiter allows to their own addresses. V8's generator is not cryptographic, and its state can in
  principle be recovered from observed outputs within one warm function instance.
- **Why it matters:** A predicted code is a customer account takeover: booking history, contact details
  and ticket IDs for that email. The attack is not trivial, which is why this is Low.
- **Suggested fix:** `crypto.randomInt(0, 1_000_000).toString().padStart(6, "0")`. That also uses the full
  6-digit space; the current code never produces a code below 100000.

#### P5-9 · Low · OTP verify isn't atomic, wrong guesses don't burn the code, and OTP rows are never purged

- **Where:** `auth/verify/route.ts:35-59` (select, compare, then `UPDATE … WHERE id`); `:62-74` (find or
  create the customer); `auth/request/route.ts:51-56`.
- **What's wrong:**
  1. Two concurrent verifies with the same correct code both succeed, because the update isn't conditional
     on `used = false`. The code is single-use in name only. Impact is small: both callers hold the code.
  2. A concurrent first sign-in (a double tap, or two devices) races the customer insert. One request hits
     `UNIQUE(operator_id, email)` and returns an unhandled 500 *after* the code was consumed, so the
     customer has to request a new one.
  3. A code survives wrong guesses for its full 15 minutes. The only cap is the email bucket (10 per
     15 min), which P5-7 shows is shared across operators. The odds per code are still about 1 in 90,000.
  4. Nothing deletes `magic_link_otps` rows outside demo mode (`demo-reset.ts:50` is the only delete).
- **Suggested fix:** Do the verify in one transaction:
  `UPDATE magic_link_otps SET used = true WHERE id = $1 AND used = false RETURNING id`, then
  `INSERT INTO customers … ON CONFLICT (operator_id, email) DO NOTHING` followed by the select. Add an
  `attempts` column and mark the code used after 5 wrong guesses. Purge expired rows in the same cron step
  that purges `rate_limits`.
- **Why it matters:** None of these loses money. The second one is a real sign-in failure a customer can
  hit on first use.

#### P5-10 · Low · Token-to-host binding is skipped when `x-operator-id` is absent

- **Where:** `customer-auth.ts:60-63`, `mate-auth.ts:60-63`: `if (operatorIdHeader && …)`.
- **What's wrong:** The check added for `architecture-review-findings.md:109-113` only runs when the header
  exists. Today the middleware sets it on every path these helpers serve, so the gap is closed in practice.
  It reopens on any path added to the middleware skip list (F1-1 and F1-2 both recommend additions), where
  a token for operator A would be accepted with no host check. Downstream code scopes by the token's
  operator, so the result would be the original finding again, not a leak. Related: neither helper re-reads
  the `staff` / `customers` row, so a deactivated mate keeps a 24 h token (tracked, open, `:244-246`; P5-1's
  `session_version` covers it).
- **Suggested fix:** Treat a missing header as a failure: `if (payload.operatorId !== operatorIdHeader)
  return 401`. This depends on F1-3: on skipped paths the header isn't absent, it passes through from the
  client, so an attacker could send an `x-operator-id` that matches their token. The check is only
  meaningful once the middleware strips the inbound header there. Add the missing unit test for the
  mismatch case (P5-13).

#### P5-11 · Low · Small hardening gaps on the platform and admin login routes (builds on F1-5 / F1-6)

- **Where:** `lib/env.ts:19`; `platform/auth/route.ts:11, 17-23`; `admin/auth/login/route.ts:11, 30`.
- **What's wrong:**
  - `PLATFORM_SECRET` is `z.string().optional()` with no minimum length, while `SESSION_SECRET` requires 32.
    A short secret on the console that creates operators is accepted at boot. With F1-5's per-IP limit as
    the only throttle, the secret's length is the whole defense.
  - The platform session is a bare `authenticated: true`. It has no identity, so nothing can be attributed
    or revoked per person (see P5-1 item 4).
  - `admin/auth/login` has the same un-caught `await req.json()` that F1-6 notes on the platform route, and
    `email.toLowerCase()` throws on a non-string `email`. Both return 500 where the mate route returns 400.
- **Suggested fix:** `PLATFORM_SECRET: z.string().min(32).optional()`. Parse both login bodies with a small
  Zod schema, as `POST /api/bookings` does. Longer term, F1-5's "real accounts plus MFA" covers the rest.

#### P5-12 · Low · Refactor: the two token modules are copies, and one secret signs five things

- **Where:** `customer-auth.ts:13-44` and `mate-auth.ts:13-46` (the same sign/verify, differing in `aud` and
  lifetime); `session-factory.ts:15`, `stripe/connect/start/route.ts:21`. Both token modules read
  `process.env.SESSION_SECRET!` and bypass `lib/env.ts`.
- **What's wrong:** Audience separation, the invariant this code exists to enforce, is implemented twice by
  hand. A fix to one copy (P5-10, a `session_version` check, key rotation) has to be repeated in the other.
  `SESSION_SECRET` keys the admin cookie, the platform cookie, customer tokens, mate tokens and the Connect
  `state`. I found no cross-protocol confusion today (the formats don't overlap), but there is no way to
  rotate one without invalidating all five, including every customer's 90-day token.
- **Suggested fix:** Extract `makeTokenAuth<T>({ aud, ttlSec })` returning `{ sign, verify, require }`,
  next to `makeSession`, with `aud` as a required parameter and the operator binding in one place. Derive
  per-purpose keys with HKDF from `SESSION_SECRET` (`info = "customer-token"`, `"mate-token"`,
  `"connect-state"`). iron-session accepts a password map, which gives rotation without a forced logout.

#### P5-13 · Low · Test gaps on auth

- **Where:** `src/test/lib/customer-auth.test.ts`, `mate-auth.test.ts`, `test/api/rate-limit-smoke.test.ts`,
  `admin-auth*.test.ts`, `stripe-connect-callback.test.ts`.
- **What's missing:**
  - Any route test for `auth/request` and `auth/verify` beyond the 429 smoke test: a correct code, a wrong
    code, an expired code, a reused code, a code for another operator, first sign-in creating the customer.
  - The operator-mismatch 401 in `requireCustomer` / `requireMate`. The fix for tracker `:109` has no
    regression test.
  - Session lifetime (P5-1): a sealed cookie older than 8 h is rejected; a deactivated admin's session is
    rejected.
  - Dummy-hash validity (P5-2).
  - Limiter semantics: the window reset, `retryAfterSec`, and that a blocked IP doesn't charge the account
    bucket (P5-6). `rate-limit.ts` has no direct test.
  - Connect: a `state` minted for a different operator is rejected (P5-5); the callback when the operator
    already has an account.
- **Why it matters:** P5-1 and P5-2 are both "the fix is in the code but doesn't do what it says". A test
  on the behavior, not the code path, would have caught each.

### Handoffs to later passes

- **Pass 6 (mate API):** The mate token's `role` can be `admin`, and `requireMate` accepts both. Check that
  no mate route grants more on `role === "admin"`. `mate/manifest/route.ts:49` reads `booking_items` by
  `tripId` with no operator predicate (by derivation from the scoped trip; P2-10 pattern). The manifest
  returns `qrPayload` for every ticket, which makes P5-3 a boarding-pass leak until QR signing lands.
- **Pass 7 (admin API):** `admin/settings/staff/route.ts:85-89` rethrows a duplicate email as a plain
  `Error`, so it surfaces as a 500, not a 409. Any admin can reset any other admin's password with no
  current-password check (`[staffId]/route.ts:48-53`). That is reasonable for a small operator, but it
  matters more given P5-1. Fold F1-8 and P5-1's staff re-check into one `requireAdmin` change and sweep the
  admin routes once.
- **Pass 8 (clients):** `account/bookings` returns bookings of every status, including `pending`, with
  ticket IDs (P3-1). Check what the mobile wallet does with them. Check how both apps react to a 401 once
  tokens become revocable (P5-1, P5-10): the mate app must not drop its offline manifest on a 401.
- **Tracker drift (same pattern as F1-6, P3-9, Pass 4).** In `docs/architecture-review-findings.md`:
  - `:179-183` (timing oracle) is marked `[x]` and is not fixed (P5-2);
  - `:36-40` (Connect `state`) is marked `[x]` and landed without the `operatorId` binding (P5-5);
  - `:139-142` (operator-prefixed keys) is marked `[x]` and the OTP keys were missed (P5-7);
  - `:278-280` is still `[ ]` and has landed.

---

## Pass 6 Boarding / check-in (G + M)

**Scope:** `apps/web/src/app/api/mate/{manifest,checkins,trips,trips/[tripId]/capacity,trips/[tripId]/report}`,
`lib/mate-auth.ts` (operator binding only; Pass 5 covered the token itself), and the mobile mate app as the
other half of the same contract: `apps/mobile/app/(mate)/{_layout,index,login}.tsx`,
`manifest/[tripId].tsx`, `report/[tripId].tsx`, `lib/mate-store.ts`, `lib/mate-auth.ts`,
`lib/mate-auth-context.tsx`, and the lib tests. To confirm consequences, I also read the other writer of
`check_ins` (`api/admin/trips/[tripId]/checkins/route.ts`), `lib/webhooks/charge-dispute-created.ts` (for
the capacity clamp), `bookings/route.ts:308` (where `qrPayload` is set), and the `check_ins` schema.

**Runtime status:** The findings were first written from the code, then checked against the running mate
app in the iOS simulator and the dev API (2026-09-30). The method and results are in "Simulator run" at the
end of this section. Each finding below that the run touched says **(runtime-confirmed)**. The two-device
case was confirmed against the API, with the second device simulated by `curl`, not a second simulator.

**Summary:** The server half is sound. Every mate query is operator-scoped, check-in replays are idempotent
at the DB, and the capacity edit meets the seat-inventory invariant. The problems are on the client and in
the contract between client and server:
- A scan of a voided ticket shows no feedback at all (P6-1).
- The scanner also accepts the bare ticket UUID, which will defeat QR signing when it lands (P6-2).
- A second check-in of the same ticket is reported as a plain success, and the manifest screen syncs only
  on focus, so two gangways don't catch a shared QR code (P6-3).
- The device's local queue permanently overrides the server's view of who is aboard (P6-4).
- An expired token doesn't lose data, but nothing tells the mate, and the only recovery locks them out of
  the cached manifest while offline (P6-5).

P3-1 (unpaid holds give tickets that can be boarded), P5-3 (mate PIN brute force), P5-10 (token-to-host
binding) and the QR-signing tech debt are built on here and not repeated.

### What's clean (verified)

- **Check-in replays are idempotent.** `check_ins` has `UNIQUE(ticket_id)` (`schema.ts:332`). The mate route
  inserts with `onConflictDoNothing()` (`checkins/route.ts:65-77`), and the admin route does the same with an
  explicit target (`admin/trips/[tripId]/checkins/route.ts:49-59`). Replaying a batch, whether after a
  timeout, a double sync from `index.tsx` and the manifest screen, or a retry after a 401, can't create a
  second row or raise an error. On the client, `queueCheckIn` is `INSERT OR IGNORE` on `local_id`
  (`mate-store.ts:142-154`).
- **Wrong trip and wrong operator are rejected on the server.** The ticket lookup joins `booking_items` and
  requires `tickets.id`, `bookingItems.tripId` and `tickets.operatorId` to match (`checkins/route.ts:42-52`).
  A ticket from another trip or operator gets `ticket_not_found`. The client-supplied `tripId` written into
  `check_ins` is therefore always the ticket's real trip.
- **Seat-inventory invariant on the mate capacity edit.** The trip row is locked with `.for("update")` and
  scoped by operator (`capacity/route.ts:29-39`). The `sold` count runs under that lock (`:55-59`). Tickets
  are only inserted while `POST /api/bookings` holds the same trip lock, so the count can't move underneath.
  `seats_remaining` is updated with SQL arithmetic in the same transaction (`:67-75`). The JS-side
  `newCapacity - trip.capacity` delta is safe because `trip.capacity` was read under the lock. The
  certificate-capacity cap, the cancelled-trip 409 and the `capacity_changes` audit row are all in place.
  This confirms that tracker item `architecture-review-findings.md:85-87` (mate capacity read-modify-write
  race, marked `[x]`) really is fixed.
- **The queue and cached manifest survive a 401.** `syncCheckIns` only touches queue rows when the response
  is `ok` (`mate-store.ts:216-229`). Any non-2xx, 401 included, leaves every row `synced = 0`. The trips and
  manifest refreshes only overwrite the cache on `res.ok` (`index.tsx:129-145`,
  `manifest/[tripId].tsx:198-202`). Nothing on 401 clears the token, the queue or the manifests. The
  requirement in the brief holds; P6-5 covers what's missing around it.
- **No mate route grants more to `role === "admin"`.** `requireMate` accepts both roles
  (`lib/mate-auth.ts:64`), and no route under `api/mate/` reads `role` (grep). An admin's PIN login gets
  exactly a mate's powers.
- **The offline scanner rejects tickets for the wrong trip.** `processQrPayload` searches only the open
  trip's cached manifest (`manifest/[tripId].tsx:269-277`). A ticket for another trip, or another operator,
  gets "Ticket not found on this trip" offline as well as online.
- **Mate report route.** It is operator-scoped on read and write (`report/route.ts:57, 78-81`), gated on
  `sailed` / `pending_settlement`, and the upsert on `trip_id` can only hit a trip the operator owns.

### Operator-scoping check (against the Pass 1 source table)

Every mate route takes its operator from the **mate token, checked against the `x-operator-id` header**
(`requireMate`, Pass 1 row 2). P5-10 already covers the "header absent → binding skipped" gap.

| Query | Location | Scoped? |
|---|---|---|
| trips list | `trips/route.ts:44-48` | ✅ explicit |
| trips list: `ticketsSold` / `checkedIn` subqueries | `trips/route.ts:33-42` | ⚠️ by derivation (correlated on the scoped `trips.id`) |
| manifest: trip | `manifest/route.ts:40-43` | ✅ explicit |
| manifest: `ticketsSold` subquery | `:34-38` | ⚠️ by derivation |
| manifest: `booking_items` by `tripId` | `:49` | ⚠️ by derivation (the Pass 5 handoff; the trip was verified at `:43`) |
| manifest: bookings, tickets by derived IDs; `check_ins` by `tripId` | `:58-89` | ⚠️ by derivation |
| check-in: ticket lookup | `checkins/route.ts:42-52` | ✅ explicit (`tickets.operatorId`) |
| check-in: insert | `:65-77` | ✅ `operatorId: staff.operatorId` |
| capacity: trip lock | `capacity/route.ts:29-39` | ✅ explicit |
| capacity: `sold` count, `UPDATE trips WHERE id` | `:55-59, 67-75` | ⚠️ by derivation (locked, scoped trip) |
| capacity: `capacity_changes` insert | `:77-83` | ✅ explicit |
| report: select, trip lookup, insert | `report/route.ts:54-57, 78-81, 93-103` | ✅ explicit |
| report: `onConflictDoUpdate` on `trip_id` | `:104-113` | ⚠️ by derivation (trip verified at `:81`) |
| admin check-in undo: `DELETE check_ins WHERE ticket_id` | `admin/trips/[tripId]/checkins/route.ts:72` | ⚠️ by derivation (ticket verified at `:29-39`) |

**No cross-tenant read or write found.** The ⚠️ rows are the P2-10 pattern. Note one gap on the device
rather than the server in P6-8: the client queue isn't tagged with an operator.

### Findings

#### P6-1 · Medium · Scanning a voided ticket shows nothing at all; the mate gets no "rejected" signal

- **Where:** `apps/mobile/app/(mate)/manifest/[tripId].tsx:220-223` (`if (ticket.voided) return;` comes before
  any `setScanResult`), `:261-292` (`processQrPayload` matches the ticket, calls `performCheckIn`, then
  unlocks after 1.5 s).
- **What's wrong (runtime-confirmed):** For a matched but voided
  ticket, `performCheckIn` returns early without setting a scan result. The camera modal keeps showing the
  reticle (`:595-602` in the render), and in keyboard mode no overlay appears. To the mate, a refunded,
  disputed (`charge-dispute-created.ts:39-43`) or trip-cancelled ticket looks exactly like a scan that
  didn't register. "Ticket not found" gets a red overlay; "voided", the case that matters most, gets
  nothing. In the simulator, in keyboard mode, an unknown code rendered the red error overlay, and the voided
  ticket's ID rendered no overlay and left the count unchanged.
- **Why it matters:** At a busy gangway, a scan with no result usually means "try again" and then "wave
  them on". The passenger may have been refunded (P2-2, P4-1) or charged back (P3-3). Either way the
  operator carries a passenger who has their money back, and the headcount is wrong.
- **Suggested fix:** In `performCheckIn`, when `method === "qr"` and the ticket is voided, set
  `{ kind: "error", message: "VOIDED — refunded or cancelled", name }`. Move the decision into a pure
  `resolveScan(manifest, payload, localSet) → ScanResult` (see P6-10) and unit-test every branch, including
  the P3-1 "booking not confirmed" branch from "Handoffs closed" below.

#### P6-2 · Medium · The scanner also accepts the bare ticket UUID, which will defeat QR signing; the manifest ships every ticket's credential

- **Where:** `manifest/[tripId].tsx:271` (`ticket.qrPayload === cleaned || ticket.id === cleaned`);
  `bookings/route.ts:308` (`qrPayload: id`, so today the two are identical); `api/mate/manifest/route.ts:76, 104`.
- **What's wrong:** The tech-debt plan is to make `qrPayload` an HMAC of the ticket ID and have the mate app
  validate it. As written, the scanner keeps matching `ticket.id` as well. Ticket IDs are not secret: they
  are returned by `GET /api/bookings` (`route.ts:494` region), `account/bookings`, and stored in the
  consumer wallet. Anyone with a ticket ID could then render a plain-UUID QR code that the scanner accepts,
  so signing would add nothing. Separately, the manifest sends every ticket's `qrPayload` to the device.
  With matching-by-lookup, a signed payload is still a bearer credential, so P5-3's "PIN → every boarding
  pass" leak survives signing, and so does any leak of a cached `mate.db` (P6-8).
- **Why it matters:** This is a change the QR-signing work has to include, and it's easy to miss because
  it's in the client, not where the payload is generated.
- **Suggested fix:** As part of the QR-signing work:
  - drop the `ticket.id` fallback, and match only on a payload whose signature verifies;
  - have the manifest send `ticketId` plus whatever the device needs to *verify* (for example an HMAC key
    derived per operator **and per trip**, so a leaked device key is good for one trip), not the payloads
    themselves;
  - keep keyboard-wedge entry going through the same verify path.

  Add it to the "QR codes" item in CLAUDE.md's Known Tech Debt so it isn't lost.

#### P6-3 · Medium · Duplicate check-ins are reported as success, and the manifest screen never syncs while it's open, so two gangways can both board the same ticket

- **Where:**
  - Server: `checkins/route.ts:30` declares `alreadyCheckedIn` but never sets it; `:65-78` returns
    `{ ok: true }` whether the insert happened or `onConflictDoNothing` dropped it.
  - Client: `manifest/[tripId].tsx:187-216` syncs and refreshes only in `useFocusEffect`, so it runs once
    when the screen opens and again when it regains focus. There's no sync after a check-in, no timer, and
    no `AppState` or connectivity listener anywhere in `apps/mobile` (grep for `setInterval`, `NetInfo`,
    `AppState`). `mate-store.ts:216-228` ignores everything in the result except `ok` and two error codes.
- **What's wrong:** Party boats often board through two gates, or office plus dock. A QR code screenshot
  shared between two people is the classic way to get two people aboard on one ticket.
  - **Online, same trip, two devices:** each device keeps its check-ins queued locally until the mate
    leaves the screen. Device B never learns that device A just scanned the ticket, and both overlays show
    green.
  - **When B does sync:** the server drops B's row as a duplicate and answers `ok: true`. B marks it
    synced. Nobody, on either device or in the office, is told that the ticket was presented twice.
  - The duplicate is also invisible afterwards: there's one `check_ins` row, so the duplicate scan leaves
    no record.
- **Why it matters:** That's a lost fare per shared ticket and a passenger count that is short by one, on a
  vessel whose headcount has to be right for safety. The data needed to detect it (the first check-in's
  staff and time) is already on the server.
- **Suggested fix:**
  - Server: use `.onConflictDoNothing({ target: checkIns.ticketId }).returning(...)`, as the admin route does.
    When nothing comes back, select the existing row and return
    `{ ok: true, alreadyCheckedIn: true, firstCheckedInAt, firstStaffId, firstMethod }`. Log it, or store
    duplicates in a `check_in_conflicts` table so the office can see them.
  - Client: call `syncCheckIns` right after each `queueCheckIn` (it's cheap and already safe to call
    concurrently, since the server is idempotent). While the manifest screen is focused, re-fetch the manifest
    every 15–30 s. On `alreadyCheckedIn` from a *different* staff member, alert the mate who scanned second.
  - Show "manifest as of HH:MM" from `mate_manifests.cached_at` so a stale offline manifest is visible.
    Offline, a trip cancelled or a ticket refunded after the last refresh is accepted. That's inherent to
    offline use, but today the mate can't even tell how old the data is.
- **Runtime-confirmed (API level):** The device synced ticket 021, then a second "device" (`curl`, new
  `localId`) posted the same ticket and got `{"ok":true}` with no flag. One `check_ins` row exists. Also
  observed: a scan made while the server was **online** sat in the queue with `synced = 0` until the mate
  left the manifest screen, which confirms there is no sync while the screen is open. I didn't run a
  second simulator, so the two-screens-both-green part follows from the code above.

#### P6-4 · Medium · The local queue permanently overrides the server's check-in state; office "Undo" is ignored and can be resurrected

- **Where:** `mate-store.ts:235-242` (`getLocalCheckedInTickets` returns every queue row for the trip:
  synced, unsynced and server-rejected); `manifest/[tripId].tsx:83, 122-124, 224, 410-415` (all OR the local
  set with the server's `checkedIn`); `mate-store.ts:167, 185-191` (rows marked with an error keep
  `synced = 0`); `admin/trips/[tripId]/checkins/route.ts:72` (office "Undo" deletes the `check_ins` row).
- **What's wrong (confirmed in code; item 1 runtime-confirmed):**
  1. **Undo isn't visible on the device.** The office un-checks a passenger, for example someone scanned in
     who then left before departure. The server row is gone, but the mate's device still has the queue row,
     so it keeps showing ✓ CHECKED and counting them. Nothing ever removes queue rows. In the simulator,
     after deleting the synced check-in server-side (the same `DELETE` the admin Undo runs), the screen
     fetched a fresh manifest (200) and still showed ✓ CHECKED and "2/3 checked in" against one server row.
  2. **Undo can be resurrected.** If the mate's check-in was still unsynced when the office pressed Undo,
     or the office un-checks before the mate's next focus sync, the mate's queued event replays later and
     re-inserts the row. The last writer is whoever syncs last, not whoever acted last.
  3. **Rejected events are re-sent forever.** `ticket_not_found` / `ticket_voided` set `sync_error` but leave
     `synced = 0`, so `getUnsyncedCheckIns` returns them on every sync. `mate-store.test.ts:314-321`
     asserts this ("still unsynced"), so it looks intended, but nothing reads `sync_error`, the queue grows,
     and every sync re-posts dead events. Unknown errors (`server_error`, `invalid_event`) also retry forever
     without any cap.
  4. The trips list count (`trips/route.ts:39-42`) counts `check_ins` on voided tickets, while
     `ticketsSold` excludes them, so "N/M checked in" can exceed 100% after a refund at the dock.
- **Why it matters:** The captain's count of who is aboard is what this screen is for. Today the device
  can't converge to the server's state, and two staff correcting each other produce whichever answer
  synced last.
- **Suggested fix:**
  - Treat the queue as an outbox, not as state. Show a ticket as checked in when the server says so **or**
    when there is an *unsynced, un-errored* queue row. Delete or archive rows once synced, or once they get a
    terminal error.
  - Add a terminal state for rejected events (`synced = 2` or a `failed_at` column), surface them to the mate
    ("2 check-ins were rejected: ticket refunded"), and stop resending them. Update the test that pins the
    current behavior.
  - Make Undo an event instead of a delete (`check_ins.undone_at`, or an `uncheck` event in the same stream),
    and have the mate route refuse to re-insert when the server-side undo is newer than the event's
    `checkedInAt`.
  - Filter `t.voided = false` in the `checkedIn` subquery.

#### P6-5 · Medium · An expired mate token doesn't lose data, but it's silent, and the only way out locks the mate out of the cached manifest

- **Where:** `lib/mate-auth.ts` (web) `:19` (24 h token); mobile `mate-store.ts:216` (non-ok responses
  ignored), `index.tsx:129, 146-148`, `manifest/[tripId].tsx:198-205` (non-ok and errors both fall through
  silently); `index.tsx:176` (the auth guard is `token !== null`, not "token unexpired");
  `mate-auth-context.tsx:41-46` (logout clears only the token); `login.tsx:40-89` (login needs the network).
- **What's wrong (runtime-confirmed):** This answers the question in the brief and the Pass 5 → Pass 8
  handoff. Method: restart the API with a different `SESSION_SECRET`, so the device's token fails like an
  expired one.
  - **Data is safe.** After 24 h every request 401s. The queue keeps growing with `synced = 0`, and the cached
    trips and manifests stay. Because the guard checks only that a token *exists*, the mate keeps working
    from cache. That is the right outcome.
  - **But nothing tells anyone.** There's no "session expired" banner, no "N check-ins not synced" count
    anywhere in the UI, and no "last synced" time. A mate who signed in at 05:00 yesterday keeps scanning
    all morning while connected. None of it reaches the server, and the office's passenger page shows
    nobody aboard.
  - **The obvious recovery is a trap offline.** Tapping Sign Out clears the token, and the guard redirects
    to login (`index.tsx:176`), which needs the network. Offline, the mate has now lost access to the cached
    manifest until they find a signal. The queue itself survives and replays after the next login.
  - **Observed:** under the 401, a cold relaunch of the app made `trips`, `checkins` and `manifest` each
    return 401 (server log). The queue kept both rows at `synced = 0`, the cached manifest opened, and no
    banner or prompt appeared. The trips list showed "0/3 checked in" from its stale cache, while the
    manifest showed "2/3" from the local queue. After restoring the real secret and returning to the trips
    screen, both rows synced and appeared in `check_ins`. After Sign Out, the app went to the login screen
    and `mate.db` still held the queue rows and the manifest, including customer emails (P6-8).
  - **Same-device operator switch:** queue rows aren't tagged with an operator or staff member. If a mate
    from a different operator signs in on that phone, the old queue is posted under the new token, every row
    gets `ticket_not_found`, and those check-ins are stranded for good (P6-4 item 3).
- **Real 24-hour expiry vs. the test:** The run rotated `SESSION_SECRET`, which reproduces the server's
  401 but not the client's view of expiry. With a token whose `exp` really has passed, `decodeMateToken`
  returns `null`, so `staff` is null. The only place the mate screens read `staff` is the greeting
  (`index.tsx:188`, which falls back to "Hi, Mate"). The guard reads `token`, so a real expiry behaves the
  same apart from the greeting.
- **Tracker:** Server-side revocation of mate tokens is already tracked as open
  (`architecture-review-findings.md:244-246`; P5-1's `session_version`). Once revocation lands, a 401 can
  arrive at any moment, not only after 24 h, which makes this fix more urgent.
- **Why it matters:** Silent, day-long check-in loss with the device showing everything is fine. A dock
  with poor signal is exactly where this app is meant to work.
- **Suggested fix:**
  - On any 401 from a mate endpoint, set an `authExpired` flag in the context. Keep the token, queue and
    manifests, and show a persistent banner: "Signed out on server — N check-ins waiting. Sign in when
    online to sync."
  - Show the unsynced count and last-sync time on both screens.
  - Make re-login a modal over the current screen that doesn't clear anything until a new token is in hand.
    Block "Sign Out" with a confirmation while the queue has unsynced rows.
  - Read `exp` client-side (the decoder already does, `apps/mobile/lib/mate-auth.ts:37`) to warn an hour
    before expiry while the mate still has a signal.
  - Store `operator_id` (and `staff_id`) on queue rows. Sync only rows for the current token's operator.

#### P6-6 · Low · Capacity PATCH sends an absolute value computed from a possibly stale cache, so it can silently undo an office change

- **Where:** `manifest/[tripId].tsx:333-393`: `newCapacity = manifest.trip.capacity + delta` (`:336`) from the
  cached manifest, sent as `{ capacity }`. On success the response is ignored and the cache isn't updated.
  `capacity/route.ts:15, 67-71` applies whatever absolute value arrives.
- **What's wrong:** The office raises capacity from 29 to 35. The mate's manifest was cached before that and
  still says 29. The mate taps "+" for a walk-up, which sends 30. The server accepts it, and five seats
  quietly come off sale. The reverse case can put seats back on sale that the office had just withdrawn
  (down to `sold`, so no oversell). Because the success response is ignored and not cached, the device keeps
  showing its optimistic numbers until the next manifest fetch, and after a restart offline it shows the old
  capacity.
- **Why it matters:** Lost sales or an unwanted capacity change, with an audit row that looks deliberate.
- **Suggested fix:** Send `{ capacity, expectedCapacity }` and return 409 with the current values when
  `trip.capacity !== expectedCapacity` under the lock. Alternatively, send `{ delta }`. On success, apply the
  server's `capacity` / `seatsRemaining` / `ticketsSold` and `cacheManifest` the result.

#### P6-7 · Low · Check-in input isn't validated; bad events become `server_error` and retry forever

- **Where:** `checkins/route.ts:21-40` (presence checks only, no Zod), `:73-74`, `:79-80`; `trips/route.ts:14`.
- **What's wrong:**
  - `method` isn't checked against the enum, and `checkedInAt` isn't checked as a date. Either one makes the
    insert throw, which becomes `server_error`. The client treats that as transient (P6-4 item 3), so the
    event is re-posted on every sync, forever.
  - `checkedInAt` is taken from the device as-is, so a wrong device clock, or a deliberate value, back-dates
    or future-dates the record.
  - There's no cap on `events.length`. Each event costs two sequential round trips, so a large offline queue
    (a full day across several trips) runs as one long request that can hit the function timeout. A replay
    is safe, so this costs latency, not correctness.
  - `?date=` on `mate/trips` isn't validated. A malformed value reaches Postgres as a `date` and returns a 500.
  - **Runtime-confirmed:** `method: "bogus"` and `checkedInAt: "not-a-date"` each returned
    `server_error`, and `?date=garbage` returned HTTP 500.
- **Suggested fix:** Parse the body with a Zod schema: `method` enum, ISO `checkedInAt` clamped to
  `[now − 7 d, now + 5 min]`, at most 500 events, and `date` as `YYYY-MM-DD`. Return a terminal `invalid_event`
  per bad event (and handle it as terminal on the client, P6-4). Fetch all tickets for the batch in one
  `inArray` query and insert in one statement.

#### P6-8 · Low · Customer PII and boarding credentials persist on the device indefinitely

- **Where:** `mate-store.ts:63-85, 117-125` (an `expo-sqlite` database that is not encrypted); nothing ever
  deletes from `mate_manifests` or `mate_checkin_queue`; `mate-auth-context.tsx:41-46` (logout clears only the
  token).
- **What's wrong:** Every manifest ever opened stays on the phone: customer names, emails, phone numbers and
  each ticket's `qrPayload`. It survives sign-out and switching to another staff member or operator.
  `cacheTrips` replaces the trips list, but manifests are only upserted. Dock phones are often shared and
  lost.
- **Why it matters:** A lost or handed-on phone exposes months of customer contact details, plus boarding
  credentials for future trips that are still cached (P6-2).
- **Suggested fix:** Purge manifests whose trip date is more than a day or two in the past, on each
  successful refresh. On sign-out, once the queue is drained (P6-5), delete manifests and synced queue rows.
  Consider SQLCipher (`expo-sqlite` supports it via `useSQLCipher`) with a key in SecureStore.

#### P6-9 · Low · Fishing-report `photoUrls` accept any URL

- **Where:** `api/mate/trips/[tripId]/report/route.ts:32-39` (any string ≤ 2048 characters);
  `(public)/fishing-reports/[reportId]/page.tsx:70` (the first URL becomes the public page's OpenGraph image).
- **What's wrong:** A mate token (P5-3's weakest credential) can attach arbitrary external URLs to a public,
  indexed page that carries the operator's name. `next/image`'s host allow-list limits the inline images,
  but the OpenGraph tag doesn't go through it.
- **Suggested fix:** Accept only URLs on the operator's Vercel Blob host, which is what `reports/upload-photo`
  returns. Validate with `new URL()` and a host or prefix check. Apply the same rule to the admin report route
  (Pass 7).

#### P6-10 · Low · Refactor: scan, check-in and sync logic is inline in an 879-line screen; the cache prefetch is duplicated

- **Where:** `manifest/[tripId].tsx` (load, sync, scan matching, check-in, capacity and rendering in one
  component); `login.tsx:57-80` and `index.tsx:122-149` (the same "fetch trips, cache them, fetch every
  manifest" loop).
- **What's wrong:** The decisions that P3-1(b), P6-1, P6-2, P6-3 and P6-4 all change (what a scan accepts,
  what counts as checked in, when to sync) live in React callbacks with no tests. The lib tests cover only
  storage and the `syncCheckIns` happy paths.
- **Suggested fix:**
  - Extract a pure `resolveScan(manifest, payload, localState) → ScanResult` and a pure
    `isCheckedIn(ticket, queueRow?)`, both in `lib/`, and unit-test them.
  - Move the prefetch to `refreshMateCache(token)` in `mate-store.ts`. Have it return `{ unauthorized }` so P6-5
    has one place to detect a 401.
  - Wrap the queue in a `useCheckInQueue(tripId)` hook that owns syncing after each check-in and on a timer.

#### P6-11 · Low · Test gaps on the check-in contract

- **Where:** `apps/web/src/test/api/mate-checkins.test.ts` (5 cases), `mate-manifest.test.ts`,
  `apps/mobile/lib/__tests__/sync-check-ins.test.ts`.
- **What's missing:**
  - `mate/checkins`: a voided ticket (`ticket_voided`), a ticket from another trip, a ticket from another
    operator, replaying the same event twice (still one row), and a second device's event for an already
    checked-in ticket (P6-3);
  - `syncCheckIns`: a 401 response leaves every entry unsynced (the brief's requirement has no regression
    test); a terminal error stops being re-sent (P6-4);
  - the scan decision for voided, not-confirmed (P3-1) and bare-UUID (P6-2) inputs, once `resolveScan` exists;
  - capacity with a stale `expectedCapacity` (P6-6).
- **Why it matters:** The queue survives a 401 today only by accident of how `res.ok` is checked. A refactor
  that adds an auto-logout on 401 would pass every current test.

### Handoffs closed

- **From Pass 3, "the mate offline manifest and scanner must also reject tickets whose booking isn't
  `confirmed`": confirmed open, and cheap to fix on the client.**
  - The manifest already carries `booking.status` for every booking (`manifest/route.ts:66`), and the
    device caches it. Neither `processQrPayload` (`manifest/[tripId].tsx:269-283`) nor `performCheckIn`
    (`:220-257`) nor `TicketRow` (`:98`) reads it. Offline and online, a pending or expired-hold ticket gets
    a green "CHECKED IN".
    **Runtime-confirmed:** in the simulator, a ticket on a `pending` booking scanned to ✓ CHECKED. The
    API accepted it (`{"ok":true}`), and the trips card counted it ("0/3" for 2 paid + 1 unpaid live tickets).
  - The manifest's `totalTickets` and the "−" capacity guard (`:408-409, 482-485`) count those tickets too,
    as does the server `sold` check (`capacity/route.ts:55-59`). So unpaid and expired holds also stop a mate
    from lowering capacity to the real paid headcount.
  - **Fix, alongside P3-1(b):** in `resolveScan` (P6-10), treat `booking.status !== "confirmed"` as an error
    overlay ("NOT PAID"), and hide the Check In button for those bookings. Server side, add the same check to
    `checkins/route.ts:42-62` (join `bookings`), and exclude non-confirmed bookings from the manifest's
    `ticketsSold`, the trips list's count and the capacity `sold` count. Once P3-1(a) voids the tickets of
    cancelled pending bookings, only `pending` is left for the client to catch.
- **From Pass 3, the boarding page sends QR payloads to `api.qrserver.com`: still present, not mate code.**
  `app/boarding/[bookingId]/page.tsx:71` and `components/booking/ConfirmedBookingView.tsx:24` (which encodes
  the boarding *URL*, i.e. the booking ID) both use it. **Handed to Pass 8 (clients)**, together with P6-2:
  once payloads are signed, the signed value must not go to a third party.
- **From Pass 5, "check no mate route grants more on `role === "admin"`": closed, none does** (see "What's
  clean").
- **From Pass 5, `mate/manifest/route.ts:49` reads `booking_items` with no operator predicate: closed as the
  P2-10 pattern.** The trip is verified at `:43` before the `tripId` is used. There's no leak. Add
  `eq(bookingItems.operatorId, staff.operatorId)` when P2-10 is done.
- **From Pass 5, the manifest returns every ticket's `qrPayload`: confirmed, and signing alone won't fix
  it.** See P6-2.
- **From Pass 5 → Pass 8, "the mate app must not drop its offline manifest on a 401": closed here.** It
  doesn't (see "What's clean"), but the 401 is silent and there's no test pinning the behavior (P6-5,
  P6-11). Pass 8 only needs to check the consumer app.
- **From F1-12, the mate capacity clamp (`capacity/route.ts:71`, `GREATEST(0, …)`):**
  - The seat-inventory invariant holds: `FOR UPDATE` plus SQL arithmetic in one transaction.
  - When inventory is consistent (`seats_remaining = capacity − live tickets`), the `newCapacity >= sold`
    check makes the clamp unreachable.
  - It *is* reachable when inventory is already off. Example: the dispute handler voids tickets without
    restoring seats (`charge-dispute-created.ts:39-43`), so `seats_remaining` is lower than
    `capacity − live`. Lowering capacity to between `live` and `live + disputed` drives the expression below
    zero, and the clamp writes 0 instead of failing.
  - **Recommendation:** drop the `GREATEST` so the `seats_remaining >= 0` CHECK raises, and map that error to
    a 409 ("inventory out of sync, contact admin"). The admin path at `admin/trips/[tripId]/route.ts:137-139`
    has the same clamp and stays with Pass 7.

- **Tracker cross-check (`security-audit-2026-08-05.md`, `docs/architecture-review-findings.md`): no new
  drift in this area.**
  - `:85-87` (mate capacity race, `[x]`): fixed, verified above.
  - `:109-113` (token/header binding, `[x]`): landed, with the gap covered by P5-10.
  - `:244-246` (mate token revocation, `[ ]`): still open, cross-referenced from P6-5.
  - Security audit `:22-24`: the mate scoping table still matches the code.
  - Security audit `:151` (bare-UUID QR): still open, extended by P6-2.

### Handoffs to later passes

- **Pass 7 (admin API):** The office check-in "Undo" is a hard `DELETE` (`admin/trips/[tripId]/checkins/route.ts:72`).
  P6-4 proposes making it an event. Validate admin report `photoUrls` the same way as P6-9. Settle the admin
  capacity clamp with the same recommendation as above.
- **Pass 8 (clients):** `api.qrserver.com` on the boarding page and the confirmation view (see above).

### Simulator run

**When and how:** Run on 2026-09-30 on an iPhone 16 Plus simulator (iOS 18.5) with the existing dev-client
build. The mate variant was selected on the Metro command line
(`EXPO_PUBLIC_APP_VARIANT=mate EXPO_PUBLIC_API_URL=http://localhost:3000`, port 8082) and driven with
Maestro. The API was the local Next dev server against the dev Neon DB, which the user confirmed is safe to
write to.

**Fixtures:** On today's "Captree Fishing" trip I created, through SQL:
- a test mate;
- a confirmed booking with one live ticket and one voided ticket;
- a pending booking with one ticket;
- a second confirmed booking with one ticket.

I removed all of them afterwards and put `seats_remaining` back to 29/29. No source file was changed.

**Techniques:**
- **Scanning:** keyboard mode (the same `processQrPayload` path the camera uses).
- **Offline:** stopping the API server.
- **Expired token:** restarting it with a different `SESSION_SECRET`.
- **Queue state:** read directly from the app container's `mate.db`.

| Scenario | Result | Finding |
|---|---|---|
| Scan a voided ticket | No overlay, count unchanged. The control scan of an unknown code shows the red overlay. | P6-1 confirmed |
| Scan a ticket on a `pending` booking | ✓ CHECKED, accepted by the API, counted in trips | P3-1 handoff confirmed |
| Scan while online, stay on screen | Queue row stays `synced = 0` until navigating away | P6-3 confirmed |
| Scan while offline | Queued `synced = 0` (observed). Reopening the manifest while the server was down wasn't exercised; reading the cache was confirmed under 401 (next row). | Clean |
| All endpoints 401, cold relaunch | Queue and manifest intact; no banner, prompt or pending count; trips and manifest counts disagree | P6-5 confirmed |
| Token valid again, return to trips | Both queued rows synced, `check_ins` written once each | Clean (replay is idempotent) |
| Second device posts the same ticket | `{"ok":true}`, no `alreadyCheckedIn` | P6-3 confirmed (API level) |
| Office-style Undo (server `DELETE`), then refresh | Device still shows ✓ CHECKED after a fresh 200 manifest | P6-4 confirmed |
| Sign Out | Goes to the login screen; `mate.db` keeps the queue and the PII-bearing manifest | P6-5 / P6-8 confirmed |
| Bad `method`, bad `checkedInAt`, `?date=garbage` | `server_error`, `server_error`, HTTP 500 | P6-7 confirmed |

**Side observation (simulator only):** In keyboard mode, `ScanResultOverlay` renders under the on-screen
keyboard, so it's hidden whenever the soft keyboard is up. With a Bluetooth scanner paired, iOS normally
hides the soft keyboard, so this probably doesn't affect the dock. It's worth checking on the real Tera
scanner before relying on it.

---

## Pass 7 Admin API (H)

**Scope:** `apps/web/src/app/api/admin/**`, excluding the routes owned by other passes: `auth/*` (Pass 5), `revenue`
(Pass 3), and `trips/[tripId]/cancel` and `tickets/[ticketId]/refund` (Pass 4). That leaves 24 handlers in
`today`, `trips`, `trips/[tripId]`, `trips/[tripId]/{checkins,report}`, `reports/pending`,
`demo/clear-customers` and `settings/{operator,staff,staff/[staffId],vessels,vessels/[vesselId],products,products/[productId],schedules,schedules/[scheduleId]}`,
plus `lib/trip-materialization.ts`. To confirm consequences, I also read `lib/session.ts`, `lib/session-factory.ts`,
`lib/date-et.ts` (`etWallClockToUTC` only), `lib/demo-reset.ts`, `lib/email.ts`, `auth/request/route.ts`,
the group-discount block in `bookings/route.ts`, the mate capacity and report routes (for parity), the admin
schedule page and `ScheduleDialog.tsx`, the FK DDL in `packages/db/migrations`, `docs/fee-mechanism-decision.md`,
and the 18 `admin-*.test.ts` files. No runtime checks were run: the two High findings follow from code and DDL whose
behavior is deterministic.

**Summary:** Operator scoping is sound. Every handler calls `requireAdmin` first, takes the operator only from
`session.operatorId`, and checks every foreign ID it accepts against that operator. Nothing leaks across
tenants. The problems are in **what an edit actually changes**:
- Editing a weekly pattern's time, capacity or product changes the pattern row and new dates only. Every trip
  already on the calendar keeps the old values, and the UI says "Schedule updated." (P7-1).
- Pausing or narrowing a pattern fails with an FK violation as soon as any affected trip has ever had a booking
  that was later refunded. That's routine, because per-ticket refund is a one-click action (Pass 4). The schedule
  row has already been committed as paused by then, so the trips stay on sale (P7-2).
- The admin capacity paths skip the Coast Guard certificate cap and the audit row that the mate path enforces
  (P7-3).
- Operator settings accept unvalidated values on fields that decide whether customers can sign in at all
  (P7-4).

### What's clean (verified)

- **Tenant sweep.** All 27 admin handlers (24 here, plus revenue, cancel and refund) call `await requireAdmin(req)`
  as their first statement. None reads `x-operator-id` or calls `getOperatorContext`, so F1-8 + P5-1 can be fixed
  in one place (see "Handoffs closed").
- **Foreign IDs are checked against the session operator before any write.** `productId` is checked in
  `schedules/route.ts:91-96`, `schedules/[scheduleId]/route.ts:76-81` and `trips/route.ts:92-97`. `vesselId` is
  checked in `products/route.ts:61-66`, `staff/route.ts:62-69` and `staff/[staffId]/route.ts:39-45`. The ticket
  must be on the given trip *and* belong to the operator (`checkins/route.ts:29-39`). The trip is checked before a
  report is upserted (`report/route.ts:80-87`).
- **Staff roles can't be escalated.** `role` is settable only at creation. The PATCH allow-list
  (`staff/[staffId]/route.ts:32-60`) never touches it, so a mate can't be promoted and an admin can't be demoted
  into a stale session. `requireAdmin` rejects mate-role sessions (`session.ts:13`). An admin can't deactivate
  themselves (`:27-28`). That is the only lockout guard; the "last active admin" case is open (P7-6 item 5).
- **No delete routes.** No handler under `api/admin` exports `DELETE`. Vessels, products, staff and patterns can
  only be deactivated or paused, so P7-2 is the whole answer to "what happens to sold trips when a pattern is
  removed". Deactivating a product or vessel doesn't stop its trips selling (P2-12, not repeated here).
- **Money-affecting operator fields.** `stripeAccountId` and `stripeOnboardingComplete` aren't in the operator
  PATCH allow-list (`operator/route.ts:28-32`). Only `stripe/connect/*` writes them, and any admin can start that
  flow (P5-5). `feeBearer` / `feeDisplay` are editable by any admin but have no effect (P2-4).
- **Product edits can't move a product to a different vessel.** `vesselId` isn't in the PATCH allow-list
  (`products/[productId]/route.ts:25`), so existing trips can't drift away from their product's boat.
- **Price edits don't reach existing bookings.** The PI amount and `tickets.priceCents` are fixed at booking
  time. A price change affects new carts only (P2-2's list-price issue is separate).
- **Admin capacity race (tracker `:80-83`, `[x]`) really is fixed.** The trip is locked `FOR UPDATE` and scoped
  (`trips/[tripId]/route.ts:113-117`). `sold` is counted under the lock (`:123-127`). `seats_remaining` moves by
  SQL arithmetic in the same statement as `capacity` (`:135-143`). The JS-side delta uses `trip.capacity` read
  under the lock.
- **Re-saving a pattern can't duplicate trips.** Both materialization inserts use `onConflictDoNothing` on
  `UNIQUE (schedule_id, departure_date)` (`schedules/route.ts:136`, `[scheduleId]/route.ts:154`). Two concurrent
  "resume" clicks converge on the same calendar.
- **Materialization timezone.** `datesInRange` walks dates at noon UTC (`trip-materialization.ts:12-19`), so DST
  can't skip or repeat a calendar day. Times are converted with `etWallClockToUTC` using the offset of that date.
  Overnight returns roll the date forward (`:45-48`). A test pins the ET interpretation
  (`admin-trips.test.ts:176`). There is one DST edge case, handed to Pass 9.
- **Booked trips survive pause and narrowing.** Only trips that are `scheduled` with zero live tickets are
  removed (`[scheduleId]/route.ts:127-129`). Cancelled trips are never re-created on resume, because their date
  still counts as covered (`:125, 134`).
- **PII endpoints are admin-only and scoped.** `GET trips/[tripId]` returns names, emails, phones, notes and PI IDs
  only after the operator-scoped trip lookup (`:32-36`). `GET settings/staff` is scoped (`:24`) and omits hashes.
  `GET settings/operator` returns only the caller's own row (`:15`).
- **`settleGraceHrs` being operator-editable is by design.** `fee-mechanism-decision.md:163` makes the grace
  window per-operator ("size it to how late the captain actually is"). The value is validated as a non-negative
  integer (`operator/route.ts:56-61`).
- **Auth invariants (CLAUDE.md).** This pass has no auth endpoint; admin login was verified in Pass 5. No route
  here verifies a customer or mate token. Staff and customer tables aren't mixed anywhere: `demo/clear-customers`
  touches only `customers` and its children; staff CRUD touches only `staff`. The `checkRateLimit()`-first rule
  doesn't apply to session-gated CRUD.

### Operator-scoping check (against the Pass 1 source table)

Source: admin iron-session `session.operatorId` (row 3), not checked against the header (F1-8).

| Route | Scoped explicitly | Scoped only by derivation (P2-10 pattern) |
|---|---|---|
| `today` GET | trips `:68`, bookings `:92`, schedules `:105`, reports-owed `:123`, `settleTrips(operatorId)` `:34` | correlated `tickets`/`booking_items` subqueries `:50-61` |
| `trips` GET / POST | `:55`; product `:95`; insert `:107` | subquery `:43-48` |
| `trips/[tripId]` GET | trip `:32` | `booking_items` by `tripId` `:38`; `bookings`, `tickets` by derived IDs `:47-56`; `check_ins` by `tripId` `:57` |
| `trips/[tripId]` PATCH | lock `:116` | `sold` count `:123-127`; `UPDATE … WHERE id` `:142` |
| `checkins` POST | ticket `:37`; insert `:54` | Undo `DELETE … WHERE ticket_id` `:72` |
| `report` GET / POST | `:58`; trip `:83`; insert `:98` | upsert conflict on `trip_id` `:106-115` (the trip is already verified) |
| `reports/pending` GET | `:44` | — |
| `demo/clear-customers` POST | every delete in `demo-reset.ts:26-53` | — |
| `settings/operator` GET / PATCH | `:15`, `:67` | — |
| `settings/staff` GET / POST / PATCH | `:24`; vessel `:66`; insert `:46`; select `:22`, vessel `:42`, **update `:66`** | — |
| `settings/vessels` GET / POST / PATCH | `:19`; insert `:46`; select `:21` | `UPDATE … WHERE id` `[vesselId]/route.ts:48` |
| `settings/products` GET / POST / PATCH | `:28`; vessel `:64`; select `:21` | prices by `productId` `:33`, `:100-103`, `[productId]:45-62` (F1-13: no `operator_id` column); `UPDATE … WHERE id` `[productId]:35` |
| `settings/schedules` GET / POST / PATCH | `:52`; product `:94`; inserts `:104, 122`; select `[scheduleId]:45`; product `:79`; insert `:138` | `UPDATE … WHERE id` `[scheduleId]:105`; trips by `scheduleId` `:123`; `DELETE … WHERE id IN` `:151` |

Every derivation-only statement follows an operator-scoped lookup of the same ID in the same handler, so there's no
leak. Fold them into the P2-10 sweep. Under F1-10 the DB wouldn't stop a mismatch either, so the explicit predicate
is the only backstop.

### Findings

#### P7-1 · High · Editing a weekly pattern's time, capacity or product silently skips every trip already on the calendar

- **Where:**
  - `settings/schedules/[scheduleId]/route.ts:50-57`: the body merges `departureTime`, `returnTime`, `capacity`
    and `productId`.
  - `:92-106`: those values are written to the `schedules` row.
  - `:134-148`: they are applied **only** to `datesToAdd`, the dates with no trip yet.
  - `:110-132`: existing trips are only ever kept or deleted, never updated.
  - UI: the "Change" dialog pre-fills and edits all of these fields (`app/admin/schedule/page.tsx:147-149`,
    `ScheduleDialog.tsx:136-158`). On success it shows "Schedule updated." (`page.tsx:118-120`). Nothing says
    the change applies to new dates only.
  - `schema.ts:179` refers to an "admin re-materialize action" that doesn't exist; this PATCH is the only path.
- **What's wrong (confirmed in code):** The materialization step is a set diff on *dates*. A date that already has
  a trip is "covered" (`:125`) and is skipped, whatever its time, capacity or product. So when an office manager
  moves the 7:00 AM pattern to 6:00 AM for the rest of the season:
  1. The pattern list shows 6:00 (`page.tsx:216`).
  2. Every trip already materialized, which is normally the whole season because POST materializes the full range
     up front, still departs at 7:00 on the public calendar, the boarding passes, the reminder emails and the mate
     manifest. Only dates added later get 6:00.
  3. The same applies to capacity (lower it from 40 to 30 for a smaller crew: existing trips keep selling 40) and
     to product (re-point the pattern at another boat's product: existing trips stay on the old vessel).
- **Why it matters:** Customers turn up an hour late for a boat that has left, or the operator sells seats they
  meant to withdraw. It isn't a DB-level oversell: `seats_remaining` stays consistent with each trip's own
  `capacity`. Combined with P7-3, though, nothing on the admin side stops a trip's capacity from exceeding the
  vessel's certificate limit. The operator sees a success message and has no way to spot the drift except by
  opening individual trips.
- **Suggested fix:** Make the PATCH reconcile existing future trips, not just dates, inside one transaction (see
  P7-2):
  - **Unbooked trips** (`scheduled`, no `booking_items`): update `start_time`, `end_time`, `product_id`,
    `vessel_id`, `capacity` and `seats_remaining` in place.
  - **Booked trips:** don't move them silently. Either return 409 with the list ("12 trips have bookings: change
    them individually or confirm"), or add an explicit "apply to booked trips and notify passengers" step.
    Capacity changes on those trips must go through the locked capacity helper from P7-3, so the `sold` check
    and the certificate cap apply.
  - Return `tripsUpdated` / `tripsSkippedBooked`, and show them in the toast.
  - Until this lands, disable the time, capacity and product fields in "Change" for existing patterns, and say
    "affects new dates only".

#### P7-2 · High · Pausing or narrowing a pattern fails with an FK violation once any affected trip has booking history, after the pattern is already saved as paused

- **Where:** `settings/schedules/[scheduleId]/route.ts:92-106` (the `UPDATE schedules` commits on its own),
  `:115-128` (the delete candidates are trips with `ticketsSold === 0`, counting only **non-voided** tickets),
  `:150-155` (`DELETE` then `INSERT`, as separate statements with no transaction). The FKs from other tables to
  `trips` are all `ON DELETE no action`: `booking_items` (`0000_safe_kingpin.sql:210`), `check_ins` (`:215`),
  `trip_overrides` (`:232`), `fishing_reports` (`0007_sticky_king_bedlam.sql:16`), `capacity_changes`
  (`0006_capacity_expansion.sql:4`).
- **What's wrong (confirmed from code and DDL; the failure is deterministic):**
  1. A future trip whose only booking was fully refunded has `booking_items` rows but zero live tickets. Per-ticket
     refund is a one-click action (Pass 4 handoff), so this is routine. The same applies to a trip with a mate
     capacity change (`capacity_changes` row) and no sales yet. These trips pass the `ticketsSold === 0` filter.
  2. The single `DELETE … WHERE id IN (…)` (`:151`) hits the FK and throws. **Every** trip in the batch survives,
     not just the one with history.
  3. The `schedules` row was already committed (`:92-106`), so the pattern now reads `active = false` (or has the
     narrowed range), while every trip it should have removed is still `scheduled` and on sale. The `INSERT` for
     new dates (`:153-155`) never runs.
  4. The client calls `res.json()` on Next's 500 page (`page.tsx:85`), which throws, so no toast appears. After a
     reload the pattern shows **Paused**.
  5. Related: because of P3-1, trips that hold only expired, unpaid holds count as "booked" (their tickets are
     never voided). They are kept and reported as `tripsKeptBooked` even though nobody paid.
- **Why it matters:** "Pause" is how an operator takes a pattern off sale: end of season, boat in the yard, captain
  unavailable. Here it reports success on the pattern and leaves the trips bookable. Customers then pay for
  departures the operator believes don't exist, which is the same outcome as P4-1 (rated High).
- **Suggested fix:**
  - Wrap the whole PATCH in one transaction, and lock the pattern's future trips `FOR UPDATE` before computing the
    diff, so a booking can't land between the count and the delete.
  - Pick the delete set with `NOT EXISTS (select 1 from booking_items where trip_id = trips.id)` (and the same for
    `check_ins`, `capacity_changes` and `trip_overrides`).
  - Trips that have history but no live tickets: set a distinct `withdrawn` status instead of deleting them. The
    booking route already refuses non-`scheduled` trips. Don't reuse `cancelled`: `coveredDates` counts every
    status (`:110-125`), so a cancelled trip would block its date on resume forever. Resume must flip `withdrawn`
    back to `scheduled`, re-applying the pattern's current time and capacity (P7-1).
  - Compute "today" with `todayET()`, not the UTC date (`:87`). From 8 PM ET onwards, the UTC date is already
    tomorrow.
  - Add a test: refund the only ticket on a future trip, pause, and expect 200 with the trip off sale.

#### P7-3 · Medium · Admin capacity paths skip the certificate cap and the audit row that the mate path enforces; the `GREATEST` clamp hides inventory drift

- **Where:** `trips/[tripId]/route.ts:96-154` (admin capacity PATCH), compared with
  `mate/trips/[tripId]/capacity/route.ts:44-51` (certificate cap) and `:77` (`capacity_changes` insert). The other
  admin writes that set capacity check no cap either: `settings/schedules/route.ts:86-88`,
  `[scheduleId]/route.ts:73-74`, one-off `trips/route.ts:88-90`, and vessel `capacity` / `certificateCapacity` in
  `settings/vessels/[vesselId]/route.ts:25-40`.
- **What's wrong:**
  1. `vessels.certificate_capacity` is described as the "legal max" (`schema.ts:80`). The mate can't exceed it.
     The office can set any trip, pattern or one-off departure to any positive integer, and lowering a vessel's
     `certificateCapacity` doesn't check its existing patterns.
  2. Admin capacity edits write no `capacity_changes` row, so the audit log only shows the mate's side. Together
     with P6-6 (the mate sends absolute values), a disputed capacity change can't be reconstructed.
  3. The clamp at `:139` (`GREATEST(0, seats_remaining + delta)`) behaves exactly as Pass 6 found for the mate
     route. It can't be reached while inventory is consistent, because `newCapacity >= sold` holds. It *can* be
     reached once `seats_remaining` has drifted below `capacity − live` (the dispute handler voids without
     restoring; P4-7). In that case it silently writes 0 instead of failing.
  4. Capacity can be edited on `sailed` / `pending_settlement` trips (only `cancelled` is refused, `:120`).
     That's harmless for sales, but it rewrites the historical capacity used in reports.
  5. `sold` counts tickets on pending and expired-unpaid bookings (P3-1 / Pass 6 handoff), so the office can't
     lower capacity to the real paid headcount either.
- **Why it matters:** Carrying more passengers than the certificate allows is a Coast Guard violation for the
  operator. Today the only enforcement is in the app the deckhand uses, not in the office tools that set capacity
  for the whole season.
- **Suggested fix:**
  - Extract `setTripCapacity(tx, { tripId, operatorId, staffId, newCapacity })` into `lib/trips/capacity.ts`. It
    locks the trip, counts `sold` under the lock (confirmed bookings only, once P3-1 lands), enforces
    `certificateCapacity`, refuses non-`scheduled` trips, updates with SQL arithmetic and **no** `GREATEST`, maps
    the `seats_remaining >= 0` CHECK violation to 409 "inventory out of sync", and writes `capacity_changes`.
  - Call it from both capacity routes and from P7-1's reconcile step.
  - Validate `capacity <= certificateCapacity` on schedule and one-off POST/PATCH.
  - Refuse a vessel `certificateCapacity` lower than any active future pattern's capacity on that vessel.

#### P7-4 · Medium · Operator settings accept unvalidated values on fields that gate customer sign-in and email

- **Where:** `settings/operator/route.ts:28-37` (an allow-list copied straight from the body) and `:63-68`
  (`.set(patch as any)`). Only `arriveMinutesBefore`, `cancelWindowHrs` and `settleGraceHrs` are validated
  (`:39-61`). Compare the Zod schema on the platform's create route (`platform/operators/route.ts:14-15`).
  Consumers: `auth/request/route.ts:59-68` and `send-confirmation-email.ts:93` (`from: operator.emailFrom`);
  `email.ts:5` (one `RESEND_API_KEY` for every tenant); `email.ts:147` (`operatorName` interpolated raw into HTML).
  The "Booking email" field auto-saves (`SettingsClient.tsx:454`).
- **What's wrong:**
  1. **Confirmed:** `emailFrom: ""` or a malformed address is stored. Resend then rejects every send, so **every
     customer's OTP sign-in returns 500 "Failed to send code"** (`auth/request/route.ts:65-67`), and every
     confirmation email fails, logged only (`payment-intent-succeeded.ts:102`). The auto-save field sends any
     changed, non-empty value on blur (`SettingsClient.tsx:506-509`), so a typo such as `office@` is saved and
     takes effect immediately. Clearing the field sends `null`, which hits NOT NULL and returns a 500, as does
     `null` for `name` or `emailDomain`. An out-of-enum `feeBearer` / `feeDisplay` returns a 500.
  2. **Needs confirmation:** cross-tenant sender impersonation. All tenants send through one Resend account, and
     nothing ties `emailFrom` to the tenant's own `emailDomain` or `domains` rows. If another operator's domain,
     or the platform's, is verified on that account, tenant A's admin can send A's OTP and confirmation emails as
     `billing@operator-b.com` or `security@openboatfishing.com`. The code can't tell whether this works; it
     depends on which domains are verified in Resend.
  3. `name` is interpolated unescaped into the OTP email (`email.ts:147`), the same class as P3-11.
  4. `termsUrl` / `dockMapsUrl` accept any scheme and are rendered as `href`
     (`ConfirmedBookingView.tsx:140`, `boarding/[bookingId]/page.tsx:234`). This only affects the tenant's own site.
  5. `cancelWindowHrs` is validated and stored but nothing reads it. It's a dead setting in the same way as
     P2-4's `fee_bearer`.
- **Why it matters:** One mistyped save on a text field locks every customer of that operator out of their account and
  silently stops confirmation emails. In centralized mode, item 2 would let one tenant phish with another's
  identity.
- **Suggested fix:**
  - Parse the PATCH with a Zod schema:
    - `emailFrom: z.string().email()`, with its domain required to equal `emailDomain`;
    - `emailDomain` in the operator's verified `domains`, or editable only from `/platform`;
    - enums for `feeBearer` / `feeDisplay`;
    - `z.string().url()` restricted to `https:` for the URLs;
    - non-empty `name`.
  - Escape `operatorName` in `email.ts`.
  - Hide `cancelWindowHrs` until something reads it.

#### P7-5 · Low · Vessel group-discount fields are stored unvalidated, and they feed the charge amount directly

- **Where:** `settings/vessels/route.ts:58-61` and `[vesselId]/route.ts:25-33` (raw `Number(...)` / raw body);
  consumed at `bookings/route.ts:195-216` and `:276-283`.
- **What's wrong:** `groupDiscountPct` can be any number. At `150`, `totalCents` goes negative. At a value high
  enough that `amount < 150 × tickets` (about 98% on a $68 fare), Stripe rejects the PI because the application
  fee is larger than the amount. Either way, every qualifying group booking fails with the generic 502 after its
  seats were held. A negative value is a silent surcharge. `"15.5"` or `NaN` returns a 500 on save. A threshold of
  `0` or below is accepted.
- **Why it matters:** The failure only shows up for groups, the highest-value carts, and only at payment time.
  It's the same "nothing asserts `application_fee_amount <= amount`" gap as P2-4, reached through a different
  setting.
- **Suggested fix:** Validate `groupDiscountPct` as an integer from 1 to 50 (or a product-chosen ceiling) and
  `groupDiscountThreshold` as an integer ≥ 2, both set or both null. Add P2-4's pre-Stripe amount assertion.

#### P7-6 · Low · Staff CRUD: a duplicate email returns 500, passwords are trimmed on write but not at login, the last admin can be deactivated, and credential changes don't end sessions

- **Where:** `settings/staff/route.ts:85-89`; `:54, 58` and `[staffId]/route.ts:50, 57` (`.trim()`);
  `admin/auth/login/route.ts:11, 35` (no trim); `[staffId]/route.ts:33, 48-60`. The same rethrow pattern is in
  `settings/vessels/route.ts:68-71` (duplicate slug).
- **What's wrong:**
  1. **Duplicate email (Pass 5 handoff, confirmed):** the `.catch` rethrows an `Error` tagged `code: "CONFLICT"`,
     but nothing maps that tag to a response, so the request becomes an unhandled 500. A duplicate vessel name or
     slug fails the same way.
  2. **Trim mismatch:** an admin password of `"  harbor-2026 "` is hashed as `"harbor-2026"`, while login compares
     the untrimmed input. That account can never sign in with the password the creator typed. It's an edge case,
     but the failure looks like a wrong password, with no hint why.
  3. **Silent no-ops:** `password` sent for a mate and `pin` sent for an admin are ignored, and the response is
     still 200 (`:49, 56`). `Boolean("false")` is `true` (`:33`), so a string `"false"` re-activates an account.
  4. **Re-auth and revocation (Pass 5 handoff):** any admin can reset any other admin's password, including
     their own, with no current-password check. Deactivation, password reset and PIN reset don't invalidate
     existing admin sessions (P5-1) or mate tokens (tracker `:244-246`). For a small operator, the missing
     re-auth on *other* admins is acceptable. The real gap is that a reset doesn't evict the person it was
     meant to evict, which is P5-1.
  5. **Last-admin lockout:** the guard at `:27-28` only blocks *self*-deactivation. Two admins deactivating each
     other at the same time both pass it. So does a deactivated admin whose session is still live (P5-1)
     deactivating the last active one. Either way the operator ends up with zero active admins, and only the
     platform or a DB edit can recover.
  6. **PIN length:** the 4-digit minimum (`staff/route.ts:59`, `[staffId]/route.ts:58`) is what P5-3
     brute-forces. Raising it to 6 here is the cheapest P5-3 mitigation.
- **Why it matters:** These are the operator's only tools for managing who can touch refunds and payouts. A 500
  on a duplicate email, a password that silently never works, and a deactivation that leaves the person signed in
  all fail in ways the office can't diagnose. The last-admin case needs outside help to undo.
- **Suggested fix:**
  - Catch Postgres `23505` and return 409 in both routes.
  - Stop trimming passwords. Keep the trim for PINs only, and reject PINs with whitespace instead of silently
    trimming them.
  - Return 400 for a credential that doesn't match the role, and require `typeof body.active === "boolean"`.
  - Require the current password when an admin changes their *own* password.
  - Bump P5-1's `session_version` on deactivate, password reset and PIN reset, in this route.
  - Deactivate with a conditional update that refuses to leave zero active admins, e.g.
    `UPDATE staff SET active = false WHERE id = $1 AND operator_id = $2 AND (role <> 'admin' OR (SELECT count(*)
    FROM staff WHERE operator_id = $2 AND role = 'admin' AND active AND id <> $1) > 0)`, under a per-operator
    advisory lock so two concurrent requests can't both pass.
  - Raise the PIN minimum to 6 digits.

#### P7-7 · Low · Office check-in accepts unpaid bookings, and Undo is a hard delete

- **Where:** `trips/[tripId]/checkins/route.ts:29-48` (checks `voided` only), `:72` (Undo).
- **What's wrong:**
  - The ticket lookup doesn't join `bookings`, so the office "Aboard" button checks in tickets on `pending` or
    expired-unpaid bookings. This is the same gap Pass 6 found on the mate route (P3-1 handoff), but here on the
    second writer of `check_ins`. Trip status isn't checked either. Trip cancel voids the tickets it refunds, so
    the `voided` check catches most of a cancelled trip's passengers, but pending bookings left unvoided on a
    cancelled trip (P4-1) can still be marked aboard.
  - Undo deletes the `check_ins` row (**Pass 6 handoff, confirmed**), which is P6-4's root cause: the device
    can't learn about it, and a queued mate event resurrects it. The delete is also scoped only by `ticket_id`.
- **Why it matters:** The office and the gangway must agree on who is aboard. Today the office can board someone
  who never paid, and its corrections are invisible to the mate's device and can be undone by it.
- **Suggested fix:**
  - Add `eq(bookings.status, "confirmed")` and `trips.status = 'scheduled'` to the lookup. Return 409 "Not paid"
    and 409 "Trip cancelled" respectively.
  - Implement P6-4's event model here: set `undone_at` / `undone_by` instead of deleting, and have both writers
    respect it.
  - Add `eq(checkIns.operatorId, session.operatorId)` to the delete or update.

#### P7-8 · Low · Admin report `photoUrls` accept any URL; the validator is a copy of the mate route's

- **Where:** `trips/[tripId]/report/route.ts:9-45` (the same `parseBody` as `mate/trips/[tripId]/report/route.ts:9-45`),
  `:32-39` (any string up to 2,048 characters).
- **What's wrong:** This is P6-9 on the admin side (**Pass 6 handoff, confirmed**). Any URL becomes the public
  report's OpenGraph image. The admin session is a stronger credential than the mate PIN, so the risk is lower
  here, but the two copies will drift as soon as one is fixed.
- **Why it matters:** The public report page is indexed and carries the operator's name. If P6-9 is fixed in
  only one copy, the other route is still open.
- **Suggested fix:** Move `parseBody` to `lib/fishing-reports/validate.ts`, add the Blob-host check from P6-9
  once, and import it from both routes.

#### P7-9 · Low · Settings and calendar writes trust the body beyond their allow-lists

- **Where:**
  - `settings/products/[productId]/route.ts:25-29` and `settings/vessels/[vesselId]/route.ts:25-33`: allow-list
    plus `.set(patch as any)`, with no per-field types.
  - `settings/schedules/route.ts:68-75, 101-138` and `[scheduleId]/route.ts:57, 59-64`.
  - `trips/route.ts:15-17, 79-81, 104-117`.
- **What's wrong:**
  - Wrong-typed fields reach Postgres and come back as 500s. Examples: `whatToBring: "x"`, `active: "no"`,
    `capacity: "abc"` on a product, `name: null`.
  - Dates pass a format regex, not a calendar check. `2026-02-30` passes and the `schedules` / `trips` insert
    rejects it with a 500 instead of a 400.
  - There's no upper bound on a pattern's range. *Needs confirmation:* a daily pattern of about 20 years
    (`7,300 rows × 9 params`) would exceed Postgres's 65,535 bind-parameter limit in the single multi-row trip
    insert (`:136`). Because the `schedules` row is committed first (`:101-113`; no transaction), that would leave
    an orphan pattern with no trips.
  - Patterns and one-off departures can be created with past dates. Together with P2-1 (departed trips are
    bookable), that's sellable inventory in the past.
  - One-off departures have `schedule_id = NULL`, so the unique key doesn't apply. A double-submit creates two
    identical trips.
  - `Boolean(body.active)` on the schedule PATCH turns `"false"` into `true` (`[scheduleId]/route.ts:57`).
  - `GET trips` with `limit=abc` passes `NaN` to `.limit()`, and `from` / `to` aren't validated.
- **Why it matters:** Each item is small, but together they mean the API's real contract is "whatever the current
  UI happens to send". Mistakes surface as 500s with no message, and the past-date and duplicate-departure cases
  put sellable inventory on the calendar that the operator never meant to create.
- **Suggested fix:**
  - One Zod schema per route, like `POST /api/bookings`.
  - Calendar-valid dates (`!isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d)`), with
    `startDate >= todayET()` on create and a maximum range (for example, 3 years).
  - Wrap schedule POST in one transaction, and chunk the trip insert.
  - Dedupe one-off departures on `(operator_id, product_id, start_time)`, via a partial unique index where
    `schedule_id IS NULL`.

#### P7-10 · Low · "Clear demo customers" is gated by a deployment-wide flag, not by the operator, and deletes paid bookings without touching Stripe

- **Where:** `demo/clear-customers/route.ts:18-29`; `demo-reset.ts:26-37` (deletes `payments`, `tickets`,
  `booking_items` and `bookings`).
- **What's wrong:** `DEMO_MODE` is an env var for the whole deployment. `openboatfishing.com` is planned as a
  "production sandbox + public demo" that can also host operators provisioned through `/platform`. Any admin of
  *any* operator on that deployment can wipe all of their own operator's bookings and payment rows. Pending PIs
  aren't cancelled and succeeded charges aren't refunded, so later `charge.refunded` / dispute webhooks can't find
  their booking. Tracker `:291-293` records this for the nightly cron (`[ ]`); the manual button has the same gap,
  and its blast radius is now decided by the session, not by the env var.
- **Why it matters:** It's harmless while the demo uses Stripe test keys and has a single operator. It becomes a
  DB/Stripe divergence on real money as soon as a real tenant is onboarded onto a `DEMO_MODE` deployment.
- **Suggested fix:** Gate on the operator as well: an `operators.is_demo` column, or `session.operatorId ===
  env.DEMO_OPERATOR_ID`. Cancel open PIs before deleting, as the tracker item says for the cron.

#### P7-11 · Low · Refactor: trip-row building is copied into three routes, and capacity logic into two

- **Where:**
  - Trip rows: `settings/schedules/route.ts:115-132`, `[scheduleId]/route.ts:83-148` and `trips/route.ts:99-117`
    each build the same `{ startTime: etWallClockToUTC(...), endTime: …tripEndDate…, capacity, seatsRemaining }`
    row.
  - `lib/trip-materialization.ts` holds only the date and time helpers. `tripEndDate`'s `returnTime` parameter is
    unused (`:45`).
  - Capacity: `trips/[tripId]/route.ts:96-154` and `mate/trips/[tripId]/capacity/route.ts`.
  - The comment at `schedules/route.ts:115` points at a seed script as the reference implementation.
- **Why it matters:** P7-1, P7-2 and P7-3 each need a change in every copy. The capacity copies have already
  drifted (P7-3).
- **Suggested fix:**
  - Move `buildTripRow(...)` and `reconcileSchedule(tx, schedule, { today })` into `lib/trip-materialization.ts`,
    so POST and PATCH share the diff-and-reconcile logic and it can be unit-tested without HTTP.
  - Move capacity into P7-3's `setTripCapacity`.
  - Drop the unused parameter.

#### P7-12 · Low · Test gaps on the admin API

- **Where:** `src/test/api/admin-schedules-patch.test.ts`, `admin-settings-schedules-post.test.ts`,
  `admin-trips.test.ts`, `admin-settings-staff.test.ts`, `admin-settings-operator.test.ts`,
  `admin-settings-vessels.test.ts`, `admin-checkins.test.ts`.
- **What's missing:**
  - Schedule PATCH that changes `departureTime` / `capacity` / `productId`, and asserts what happens to existing
    trips (P7-1).
  - Pause with a future trip whose only ticket was refunded (P7-2).
  - Admin capacity above `certificateCapacity`, and the `capacity_changes` row (P7-3).
  - Duplicate staff email returning 409, an admin password with surrounding spaces, and deactivating the last active admin (P7-6).
  - Clearing `emailFrom`, and an invalid `feeBearer` (P7-4).
  - Out-of-range `groupDiscountPct` (P7-5).
  - Office check-in of a `pending` booking's ticket (P7-7).
  - A mate-role session hitting any admin route. `requireAdmin`'s role check has no route-level test.
  - `lib/trip-materialization.ts` has no unit test. `datesInRange` across a DST weekend and `isOvernight` at
    equal times are both one-liners to pin down.
- **Why it matters:** The existing suites cover 401 / 404 / cross-tenant thoroughly. Every gap above is about
  what a *successful* edit does to trips and money, which is where this pass's findings are.

### Handoffs closed

- **From F1-8 + P5-1, "fold the header check and the staff re-check into one `requireAdmin` change and sweep the
  admin routes once": swept, and one change is enough.**
  - All 27 admin handlers call `await requireAdmin(req)` first. All of them read the operator only from
    `session.operatorId`, and none mixes in `getOperatorContext`. So F1-8's "mixed sources" hazard doesn't exist
    yet, and a fix inside `requireAdmin` covers every route without per-route edits.
  - One constraint: `makeSession`'s `isAuthorized` is synchronous (`session-factory.ts:9, 33`). The staff-row
    re-check needs an async hook, for example `isAuthorized: (s, req) => Promise<boolean>`, or a
    `requireAdmin` wrapper around `requireSession`.
  - `session.staffId` is written into `check_ins.staff_id` (`checkins/route.ts:55`) and `fishing_reports.staff_id`
    (`report/route.ts:101, 112`). Until P5-1 lands, a deactivated admin's actions are still recorded under their
    own ID.
- **From F1-12 / Pass 6, the admin capacity `GREATEST` clamp: settled, same conclusion as the mate route.** The
  invariant holds (`FOR UPDATE` plus SQL arithmetic). The clamp is unreachable while inventory is consistent, and
  it masks drift when inventory isn't. Drop it and map the CHECK violation to 409. That change lives in P7-3's
  shared helper, so both routes get it at once. The F1-12 upper-bound CHECK (`seats_remaining <= capacity`) is
  safe with this route, because it moves both columns by the same delta in one statement.
- **From Pass 5, staff duplicate email → 500: confirmed** (P7-6 item 1), with the same bug in vessel slugs.
- **From Pass 5, password reset with no current-password check: confirmed, and scoped down.** Resetting *another*
  admin's password is a reasonable small-operator workflow. The gaps that matter are the self-change with no
  re-auth, and that no reset ends the target's session (P5-1). Both are in P7-6 item 4.
- **From Pass 6, office check-in Undo is a hard `DELETE`: confirmed** (P7-7). The office route also lacks the
  booking-status check Pass 6 proposed for the mate route. Add `admin/trips/[tripId]/checkins/route.ts:29-39` to
  the P3-1(b) fix list.
- **From Pass 6 (P6-9), validate admin report `photoUrls`: confirmed** (P7-8). Fix it once in a shared validator.
- **From `docs/architecture-review-findings.md:299-302`, staff `UPDATE` without `operatorId`: fixed in code,
  tracker not updated.** `staff/[staffId]/route.ts:66` now has `and(eq(staff.id, staffId), eq(staff.operatorId,
  session.operatorId))`. Mark it `[x]`.
- **Tracker drift (same pattern as earlier passes):**
  - `:274-276` (normalize `staff.email` on write) is still `[ ]` but has landed. `staff/route.ts:38` and
    `platform/operators/route.ts:96` both lowercase and trim, and the staff PATCH can't change the email. Mark it
    `[x]`.
  - `:80-83` (admin capacity race, `[x]`) is verified fixed (see "What's clean").
  - `:291-293` (`reset-demo-data` doesn't cancel PIs, `[ ]`) is still open, and it applies to the manual button
    too (P7-10).
  - Security audit `:16-21` (admin scoping table) still matches the code. The `settings/*`, `today`, `checkins`,
    `report` and `demo` routes postdate it and aren't listed; the table above covers them.

### Handoffs to later passes

- **Pass 9 (`date-et`):** `etWallClockToUTC` takes the UTC offset at noon UTC on the date (`date-et.ts:39-47`). A
  departure between midnight and 2 AM ET on a DST-change date gets the post-change offset and lands an hour off.
  That matters only for night trips on two dates a year, but those are the trips with 1–2 AM boardings.
- **Pass 9 (admin UI):** `app/admin/schedule/page.tsx:85, 113` call `res.json()` without guarding a non-JSON 500,
  so server errors produce no toast (seen in P7-2). Check the other merchant pages for the same pattern.
- **Schema (no action, recorded to avoid re-checking):** `capacity_changes.trip_id` does have an FK. It's declared
  inline in `0006_capacity_expansion.sql:4`, not as a separate `ADD CONSTRAINT`, so it doesn't show up when
  grepping for `REFERENCES "public"."trips"`. There's no schema drift there.

---

## Pass 8 Clients (N, K)

**Scope:**
- **K (web):** `components/BookingCalendar/*` (including `useCart.ts`, `CartRail`, `MobileCartBar`, `TripRow`, `format.ts`),
  `components/SailingsSection.tsx`, `app/cart/*`, `app/checkout/*` (`page`, `CheckoutClient`, `CheckoutForm`),
  `app/boarding/[bookingId]/*`, `app/booking/confirmation/page.tsx`, `app/booking/delivery/page.tsx`,
  `components/booking/{ConfirmedBookingView,ProcessingScreen}.tsx`, `components/ClearPendingPayment.tsx`,
  `app/(public)/page.tsx` and `app/(public)/book/page.tsx`.
- **N (mobile, consumer only):** `app/(tabs)/*`, `app/checkout.tsx`, `app/cart.tsx`, `app/boarding/[ticketId].tsx`,
  `app/_layout.tsx`, `app/index.tsx`, `lib/{api,wallet,customer-auth,customer-auth-context,trip-helpers}.ts(x)`,
  `components/TripSheet.tsx`, and `eas.json` / `app.json` for the API host.
- **Read only to confirm the contract:** `api/bookings/route.ts` (POST response and GET filter), `api/trips`,
  `api/account/bookings`, `api/push/register`, `lib/bookings/get-confirmed-booking.ts`, `middleware.ts`,
  `PostHogProvider.tsx`, the mate scanner's `processQrPayload` (for what a QR must contain), `@openboat/utils`
  `dollars`, and `e2e/booking-flow.spec.ts`.

**Runtime checks:** I made one read-only Stripe test-mode call
(`GET /v1/payment_method_configurations`) to settle part of P2-5. No other runtime checks were run, and no
fixtures were created. Every finding below follows from code paths that don't depend on data.

**Summary:** Nothing Critical is new. The server-side money and isolation core holds up under the clients:
- every server component that renders a booking is operator-scoped;
- a booking or ticket ID from another operator 404s;
- the mobile app sends its customer token only to its one build-time host.

The problems are in what the clients *tell* the customer and who can reach the pages:

- **The confirmation and delivery pages are a code-only, unthrottled lookup (P8-1).** They hand out the booking ID,
  and the booking ID opens every boarding pass on the booking. This reopens the brute-force finding that made the
  wallet GET require email *and* code (`security-audit-2026-08-05.md:47`). With `?redirect_status=succeeded`, any
  booking also renders as "SEATS CONFIRMED" (Pass 3 handoff).
- **`/book` loads its first month of trips through a server-side HTTP call to `NEXT_PUBLIC_BASE_URL` (P8-2).** That
  variable is in neither `env.ts` nor the deploy checklist. On Vercel it falls back to `localhost` and the page 500s.
  When it is set, centralized mode shows the base host's operator's trips on every tenant.
- **Web checkout's "PAY $X" and the Stripe Elements amount come from stale, client-side list prices (P8-3).** That
  covers the Pass 2 handoff, plus whole-dollar rounding and prices persisted in `localStorage`.
- **On mobile:**
  - the resume bar can pay for a stale cart (P8-4);
  - the wallet shows only the first ticket of every trip (P8-5);
  - wallet refresh never learns that a booking was cancelled (P8-6).

### What's clean (verified)

- **Server-component scoping.** All of these take the operator from `getOperatorRecord()` (header, Pass 1 row 1):
  - `boarding/[bookingId]/page.tsx:15-18` filters `bookings.id` *and* `operatorId`;
  - `getConfirmedBooking` filters `confirmationCode` *and* `operatorId` (`get-confirmed-booking.ts:45`);
  - the homepage queries filter `operatorId` (`(public)/page.tsx:70, 90, 98, 103`).

  A booking ID or code from operator B on A's host returns `notFound()`. Follow-up queries are scoped by derivation
  from the verified booking (P2-10 pattern, no leak). `force-dynamic` / header reads keep these pages out of any
  shared cache (Pass 1).
- **Mobile API host and token destination.**
  - Every consumer `fetch` is `${API_URL}/…`. `getApiUrl()` throws in a production build if
    `EXPO_PUBLIC_API_URL` is unset (`lib/api.ts:9`), and in dev it uses Metro's LAN host.
  - The customer token is attached only to `api/account/bookings` and `api/push/register`
    (`account.tsx:223, 285, 305`). Report photos and maps links are fetched or opened without it.
  - There's one gap at the configuration level, see P8-12.
- **Token audiences on mobile.**
  - The consumer app stores only `customer_token` (`customer-auth.ts:3`), in SecureStore. The mate app uses a
    separate key (`mate-auth.ts:3`).
  - No consumer screen calls a mate or staff endpoint, and there's no fallback between the two.
  - OTP request and verify are one-shot button actions with no retry loop or auto-resend (`account.tsx:99-145`), so
    the client doesn't defeat `checkRateLimit()` on the auth endpoints. The one client pattern that does burn a
    limiter is on the wallet GET (P2-8, extended in P8-6).
  - One caveat: the consumer binary still contains the `(mate)` routes, see "Auth invariants" below.
- **Mobile proof of payment.**
  - "You're booked" appears only after `presentPaymentSheet()` resolves without error (`checkout.tsx:176-187`), and
    `allowsDelayedPaymentMethods: false` (`:168`). So a PaymentSheet success means the PI succeeded.
  - The PaymentSheet itself shows the **PI's** amount, which limits the damage from P8-3 on mobile.
  - The wallet stores only what `GET /api/bookings` returns, and that route filters `status = 'confirmed'`
    (`bookings/route.ts:415`). So a pending booking never reaches the offline wallet.
- **Mobile boarding pass rendering.**
  - QR codes are rendered on the device (`react-native-qrcode-svg`), with no third-party request.
  - Voided tickets and cancelled trips swap the QR for a ✕ (`boarding/[ticketId].tsx:106, 166-170`).
  - Brightness is restored on blur and unmount.
- **Web double-submit.** The pay button is disabled while `submitting`, and `handleSubmit` returns early on
  `submitting` (`CheckoutForm.tsx:212, 380`). `payment_intent_unexpected_state` gets its own message (`:287-288`).
  Retries still create new bookings (P2-3, not repeated).
- **3DS / `requires_action`.** Both clients hand confirmation to Stripe's SDK (`confirmPayment` with a `return_url`;
  PaymentSheet with `urlScheme` set in `_layout.tsx:63-66`), which runs the challenge and the redirect itself. No
  client code reads `requires_action`.
- **Extend-hold.** Web calls it fire-and-forget, once per payment attempt, right before `confirmPayment`
  (`CheckoutForm.tsx:269`). Mobile never calls it, so a PaymentSheet left open past a 10-minute near-full hold fails
  as `payment_intent_unexpected_state`. Mobile then shows Stripe's raw message (`checkout.tsx:178-181`), with no
  "seats released" copy like the web's. That's minor and worth aligning. The server caps holds at 90 minutes and
  rate-limits the call (`extend-hold/route.ts:9, 20`).
- **Web seat stepper.** Steppers cap at `seatsRemaining − other types` with functional updates (`useCart.ts:162-173`).
  The mobile `TripSheet` does the same (`TripSheet.tsx:77`). The server's `FOR UPDATE` is still the real guard.
- **Print CSS.** `@media print` hides the toolbar, applies `print-color-adjust: exact`, and puts one ticket per page
  (`boarding/[bookingId]/page.tsx:255-287`). This matches the CLAUDE.md boarding-pass decision.
- **Cart across operators.** Web carts live in per-origin `localStorage`, so two tenant domains can't share one. The
  mobile cart is in memory, and each build talks to one host. A trip ID from the wrong operator only gets into a
  cart through P8-2.

### Operator-scoping check (against the Pass 1 source table)

Source: `x-operator-id` header through `getOperatorRecord()` (row 1) for every web server component. The mobile app
has no operator concept of its own: the host it calls decides the operator, and its token is bound to that host
(`customer-auth.ts:57-63`, gap P5-10).

| Page / client call | Scoped explicitly | Scoped only by derivation | Cross-operator ID renders? |
|---|---|---|---|
| `boarding/[bookingId]` | booking `:18` | tickets/items/trips/vessels/products by `booking.id` `:40-45` | No (404) |
| `booking/confirmation`, `booking/delivery` | `getConfirmedBooking` `:45` | items/tickets by `booking.id` `:60-76` | No (404), but see P8-1 for the same operator |
| `(public)/page.tsx` | all four queries `:70, 90, 98, 103` | — | n/a |
| `(public)/book/page.tsx` | **No: the operator comes from the `NEXT_PUBLIC_BASE_URL` host, not the request** (P8-2) | — | **Yes**, in centralized mode |
| `checkout/page`, `cart/page` | operator name and contact only | — | n/a |
| Mobile → `/api/trips`, `/api/bookings`, `/api/account/bookings`, `/api/reports` | server-side (Passes 2, 5) | — | n/a (one host per build) |

### Findings

#### P8-1 · High · Confirmation and delivery pages accept a confirmation code alone, with no throttle; the response leads to every boarding pass on the booking, and `redirect_status` is trusted as proof of payment

- **Where:**
  - `booking/confirmation/page.tsx:13-28`: `code` comes from the query string, with no email and no rate limit.
    `paymentSucceeded = redirect_status === "succeeded" || booking.status === "confirmed"`.
  - `booking/delivery/page.tsx:15-31`: renders `ConfirmedBookingView` for any booking status when
    `redirect_status=succeeded`.
  - `get-confirmed-booking.ts:42-45`: no status filter.
  - `ConfirmedBookingView.tsx:23-24, 65`: the page embeds `/boarding/<bookingId>`, as the QR `data=` and therefore in
    the HTML.
  - `boarding/[bookingId]/page.tsx:144, 213`: that page renders every ticket's `qrPayload` and the purchaser's name.
  - Codes are `randomBytes(3)`, i.e. 6 hex characters (`bookings/route.ts:66-68`).
- **What's wrong (confirmed in code):**
  1. **Enumeration.** The wallet GET was changed to require email + code, and it was rate-limited, because "code alone
     is guessable" (`bookings/route.ts:368`; `security-audit-2026-08-05.md:47`). These pages accept the code
     alone with no limit. An operator with 10k bookings has about 1 valid code per 1,700 guesses. Each hit yields:
     - the booking ID (from the QR URL in the HTML);
     - through `/boarding/<id>`, the purchaser's name and **every ticket's QR payload**.

     Today those payloads are the bare ticket UUIDs that the mate scanner accepts (P6-2). An attacker can print
     another customer's *paid* passes.
     - **QR signing does not close this.** The boarding page renders whatever `qrPayload` holds, signed or not, so a
       signed payload is copied just as easily. The fix has to restrict who can reach the page.
     - **At the gangway, whoever scans first boards.** The real customer is then either flagged as already checked in
       or, with two gangways or devices, also gets a green result (P6-3's runtime row was a second device getting
       `ok:true`). Either way, one paid seat carries two people, or the paying customer is turned away.
     - P3-1 is a different exploit: it needs the attacker's own unpaid hold. This one takes a paying victim's seat and
       name. P2-9 (the calendar `.ics` endpoint) is a weaker oracle on the same code; this page is the one that pays
       out.
  2. **Payment proof from the query string (Pass 3 handoff).** `?redirect_status=succeeded` renders "SEATS CONFIRMED
     … This screen alone is enough to board" for `pending` and `cancelled` bookings too. That includes a booking whose
     payment failed, an expired hold and a refunded booking. Email and phone aren't on these pages, so the PII leaked
     is the name only.
- **Why it matters:** This reopens a fixed audit finding through a side door. The harm is customer-to-customer:
  someone else boards on your ticket, and the system can't tell the two apart.
- **Why High and not Critical like P3-1:** P3-1 needs only a browser and one booking. This one needs scripted
  guessing (about 1,700 requests per hit at 10k bookings, and fewer as the operator grows), and the victim usually
  surfaces at the dock, so the fraud is noticed. It's the same class of free boarding, so treat it as launch-blocking
  alongside P3-1.
- **Suggested fix:**
  - Stop using `redirect_status`. Stripe appends `payment_intent` and `payment_intent_client_secret` to the
    `return_url`. On the delivery page, retrieve that PI server-side and require:
    - `pi.id === booking.stripePaymentIntentId`;
    - `pi.status === "succeeded"` (or `processing`, shown as such).

    The client secret binds the visit to the payer. With no PI params, show the confirmed view only when
    `booking.status === "confirmed"`, and otherwise show a "look up your booking" form that asks for email + code.
    That form goes through the same rate limiter as the wallet GET.
  - Make the confirmation page require email + code (or a short-lived signed token returned by POST and stored in
    `openboat_pending_payment`), not the code alone.
  - Don't put the booking ID in a page reachable by code. Have the boarding page take a signed, expiring token, or
    render the passes inline after the PI check.
  - Filter `getConfirmedBooking` by `status` (or rename it), as Pass 3 asked.

#### P8-2 · High (confirmed in code; impact depends on deploy env) · `/book` fetches its first month of trips over HTTP from `NEXT_PUBLIC_BASE_URL`, which defaults to localhost and ignores the request's tenant

- **Where:** `(public)/book/page.tsx:19-24`: `fetch(\`${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/trips?month=…\`)`.
  - The variable isn't in `lib/env.ts` (only `NEXT_PUBLIC_APP_URL` is, `:26`).
  - It isn't in the deploy env table (`docs/openboatfishing-demo-deploy.md:66-77`).
  - It's set only in the git-ignored `apps/web/.env.local` (`http://localhost:3000`).
  - `middleware.ts:36-46` resolves the operator from the **Host of that inner request**.
- **What's wrong:**
  1. **On a Vercel deploy that follows the checklist,** the lambda fetches `http://localhost:3000` and gets
     connection refused. `res.json()` throws, and **`/book` returns 500**. Every "BOOK" button on the homepage links
     there (`SailingsSection.tsx:241, 380, 397`; `(public)/page.tsx:256, 306, 486`). Boot validation doesn't catch
     it, because the variable isn't in `env.ts`.
  2. **If it is set** (for example to `https://openboatfishing.com`), then in centralized mode every tenant's `/book`
     renders **the base host's operator's trips and prices** under the tenant's own name, for the first month only.
     Month navigation then calls `/api/trips` same-origin from the browser (`BookingCalendar/index.tsx:81`) and is
     correct, so the bug looks intermittent. A cart built from those foreign trip IDs fails at
     `POST /api/bookings`, because the server scopes the trip lookup to the request's operator.
  3. Even in single-deploy mode, each page render makes an extra public HTTP round-trip through middleware.
- **Why it matters:** The booking page either doesn't load in production, or shows one operator's schedule on another
  operator's site. Both are found on day one, but neither is caught by CI. `npm run build` doesn't render this page,
  and the smoke test checks `/api/health` only (Pass 1).
- **Suggested fix:** Move the `/api/trips` query into a shared `getTripsForMonth(operatorId, month)`, and call it
  directly from the page with `operator.id`, as the homepage already does. Have the route call the same function.
  Then delete the `NEXT_PUBLIC_BASE_URL` fallback. Add a Playwright check that `/book` renders with the variable
  unset.

#### P8-3 · Medium (amount-mismatch behavior needs confirmation) · Web checkout displays and pre-authorizes client-side list prices; the server charges a different `totalCents`

- **Where:**
  - `CheckoutClient.tsx:88-99`: `Elements` `amount` is the sum of `localStorage` prices.
  - `CheckoutForm.tsx:203-206, 396`: "PAY $X". The POST response's `totalCents` / `groupDiscountCents` are returned
    (`bookings/route.ts:356-364`) but not even typed or read (`CheckoutForm.tsx:231-237`).
  - `format.ts:40-42`, `CheckoutForm.tsx:11-13`, `CartClient.tsx:15-17` and mobile `trip-helpers.ts:28-30` all
    format with `Math.round(cents / 100)`.
  - `useCart.ts:46-50, 128`: prices and `seatsRemaining` are persisted in `localStorage` with no expiry and never
    re-fetched.
  - `api/trips/route.ts:30-38` and the homepage (`(public)/page.tsx:63-66`) read product prices only; the server
    also applies `schedule_prices` (`bookings/route.ts:157-166`).
- **What's wrong:** The amount the customer agrees to and the amount charged come from different sources:
  1. **Group discount (Pass 2 handoff, confirmed).** A cart that meets a vessel's threshold shows and authorizes the
     full price, and Stripe charges the discounted PI. The confirmation page then shows the discounted subtotals
     (`get-confirmed-booking.ts:91`), and no screen explains the gap.
  2. **`schedule_prices`.** Once weekday/weekend rows are seeded (tracked tech debt), the server charges the override
     and the client shows the product price. A weekend surcharge becomes an **overcharge** relative to
     "PAY $X · BOOK MY SEATS".
  3. **Stale persisted cart.** A cart restored days later still carries the old prices. An admin price change lands
     on the charge but not the display.
  4. **Rounding.** A $49.50 fare shows as "$50"; 3 × $49.40 = $148.20 shows as "$148". The display can be **below**
     the charge by up to $0.49. `@openboat/utils` `dollars` (used on the confirmation page) prints cents, so the
     checkout and confirmation pages disagree for the same booking.
  5. **Elements `amount`.** Stripe documents this as "the amount to charge the customer, shown in Apple Pay, Google
     Pay, or BNPL UIs" (deferred-intent guide). The test PMC has Apple Pay, Klarna, Affirm, Cash App and Amazon Pay
     enabled, so wallet and BNPL sheets show the client amount while the PI charges the server amount. **Needs
     confirmation:** whether Stripe.js rejects `confirmPayment` when the PI amount differs from the Elements
     amount. If it does, every discounted web booking fails at payment **after** its seats are held (P2-3).

     To confirm: give a dev vessel `groupDiscountThreshold = 2`, `groupDiscountPct = 10`; run
     `booking-flow.spec.ts` with 2 seats and card 4242; then reset the vessel. `seed-demo.ts` sets no group
     discount, so the demo deploy doesn't hit this until an admin configures one. Run the check before launch
     anyway.
  - Mobile is partly mitigated: its "PAY $X" (`checkout.tsx:100, 330`) has the same problem, but the PaymentSheet
    shows the PI's real amount before the customer confirms.
- **Why it matters:** "The amount shown differs from the amount charged" is the client-side money bug to avoid. Today
  it mostly errs in the customer's favour. It flips to an overcharge the day weekend pricing lands, and the rounding
  already shows less than the charge on non-whole-dollar fares.
- **Suggested fix:**
  - Make the server the only source of the total. Add a side-effect-free `POST /api/bookings/quote` (cart in →
    per-line prices, discount, total), or reuse P2-11's extracted `priceCart`.
  - Call it when the checkout page loads and whenever the cart changes. Show its line items, including a "Group
    discount −$X" line, and pass its total to `Elements`.
  - After `POST /api/bookings`, assert `data.totalCents === quotedTotal`. If they differ, call
    `elements.update({ amount })`, show the new total and require a second tap.
  - On mobile, display `data.totalCents` from the POST response.
  - Replace the four whole-dollar formatters with the cents-aware `@openboat/utils` `dollars`.
  - Have `/api/trips` resolve `schedule_prices`.
  - Re-validate a restored cart against `/api/trips` (prices, status, seats) on load, and drop the stored copy after a
    day.

#### P8-4 · Medium · Mobile resume bar opens a stale cart, and a multi-month cart silently drops trips

- **Where:**
  - `(tabs)/trips.tsx:249-259`: the "N SEATS · $X · REVIEW →" bar does `router.push("/cart")` **without** writing
    `pending_checkout`.
  - `cart.tsx:23-31` and `checkout.tsx:74-83` read only that MMKV key.
  - `trips.tsx:139-141`: `handleHold` writes `cartTrips = trips.filter(…)` from the **currently loaded month only**.
  - `trips.tsx:152-157`: the bar's total also sums only the current month's trips, while `cartTotalQty` counts all.
  - `checkout.tsx:91-92`: lines whose trip isn't in `cartTrips` are skipped.
- **What's wrong (confirmed in code):**
  1. Take a customer who opens checkout for trip A (written to MMKV), backs out, removes A and adds trip B. The bar
     reads "2 SEATS · $B". Tapping it shows **trip A** from the stale MMKV entry, and "CHECKOUT" pays for A. If no
     earlier hold exists, the cart screen says "No seats selected" despite the bar.
  2. Take a customer who adds Oct 30 and then swipes the week into November. `trips` reloads to November only.
     Tapping HOLD on a November trip writes `cartTrips` with the November trip only. Two trip IDs route through
     `/cart` (`cartTripIds.size > 1`), which lists only November. October's seats are dropped without a message, and
     after paying, the result screen says "You're booked."
- **Why it matters:** The customer pays for a different set of trips than the one they last saw, or believes they
  booked a trip they didn't.
- **Suggested fix:** Keep the cart (with trip snapshots) in one place, either a small context or MMKV written on every
  `handleAdjust`, so the bar, the cart screen and checkout read the same state. Store the trip objects when they're
  added, not by filtering the current month. Clear `pending_checkout` when the cart empties.

#### P8-5 · Medium · Mobile wallet shows only the first ticket of every trip; a party of four gets one boarding pass

- **Where:** `(tabs)/tickets.tsx:216, 218` navigate with `ticketId: g.item.tickets[0]?.id`, and `:264` renders
  `tickets[0]`'s QR. `boarding/[ticketId].tsx` renders the one ticket it was given and has no pager. The mate
  scanner checks in exactly one ticket per scan (`(mate)/manifest/[tripId].tsx:269-283`).
- **What's wrong (confirmed in code):**
  - For a booking of four seats on one trip, the phone shows one QR. The other three passengers have no scannable
    pass on the device that claims "Your boarding pass is saved on this phone" (`checkout.tsx:45`).
  - If `tickets[0]` was refunded individually (`voided`), the screen says **"TICKET CANCELLED"** with a ✕, and the
    still-valid tickets can't be reached at all.
  - The web boarding page does show all tickets, but that needs connectivity, which the offline wallet exists to
    avoid.
- **Why it matters:** This affects most party-boat bookings, which have more than one seat. It creates gangway queues
  for manual check-in. In the voided-first case, customers may believe the whole booking is cancelled and not turn up.
- **Suggested fix:** Route to the booking item, not one ticket. Page through `item.tickets` (for example "PASS 2 OF 4")
  with each ticket's own QR and type. Mark voided tickets individually, and show the count of live tickets on the
  card.

#### P8-6 · Medium · Mobile wallet refresh never learns of cancellations, and refreshing N bookings spends N wallet-limit requests

- **Where:**
  - `(tabs)/tickets.tsx:150-166`: `fetch(...).then(r => r.json()).then(upsertBooking)` with **no `r.ok` check**. On
    rejection it falls back to the cached record.
  - `bookings/route.ts:405-415`: GET returns 404 for any booking that is no longer `confirmed`. It counts every
    request against a 5-per-15-minute bucket per email and per IP, and resets only the email bucket on success
    (`:386-398, 424`).
  - `wallet.ts:80-87`: `confirmation_code NOT NULL`.
- **What's wrong:**
  1. A booking that was cancelled or fully refunded (trip cancel, `charge.refunded`) now 404s. The 404 body
     `{error}` goes to `upsertBooking`, the `NOT NULL` insert throws, and the code falls back to `stored[i]`. **The
     wallet keeps the old "confirmed" record with live QR codes forever.** A trip-level cancel is caught only if the
     server still returns the booking. A full-booking cancel never is.
  2. The same applies to a 429, so a throttled refresh is indistinguishable from "nothing changed".
  3. Building on P2-8: pull-to-refresh with 3 stored bookings spends 3 IP-bucket requests. A second pull, or a 6th
     booking, returns 429 for all of them and locks the manual "+ ADD" lookup for 15 minutes. That happens on the dock,
     where customers refresh.
- **Why it matters:** A customer whose trip was cancelled and refunded still sees a valid-looking pass. The mate's
  offline manifest (P6-1) also gives no rejection signal, so the dock has no clear answer. The refresh path is also
  what pushes ordinary customers into the limiter.
- **Suggested fix:**
  - Check `r.ok`. On 404, mark the cached booking `status: "cancelled"` (render ✕ and keep it under PAST) rather than
    keeping it as live. On 429, keep the cache and show "couldn't refresh".
  - Give the GET a status-aware response for an authenticated owner. For example, a signed-in customer refreshes
    through `api/account/bookings` with the token (no guess limiter), or GET returns `{status:"cancelled"}` for a
    matching email + code instead of 404.
  - Batch the refresh into one request.

#### P8-7 · Medium · The confirmation page's QR can't be scanned at the gangway, despite "This screen alone is enough to board"

- **Where:** `ConfirmedBookingView.tsx:23-24` encodes `${NEXT_PUBLIC_APP_URL ?? ""}/boarding/<bookingId>`. `:54-56`
  says "This screen alone is enough to board — show the code at the gangway." The mate scanner matches only
  `ticket.qrPayload` or `ticket.id` (`(mate)/manifest/[tripId].tsx:271`).
- **What's wrong (confirmed in code):**
  - A booking URL never matches, so a customer who shows this screen gets "Ticket not found on this trip".
  - If `NEXT_PUBLIC_APP_URL` is unset, the QR encodes a relative path that a phone camera can't even open.
  - In centralized mode it encodes one global host, and the operator-scoped boarding page 404s there (the P3-6
    class).
  - The image comes from `api.qrserver.com` (Pass 6 handoff, see below).
- **Why it matters:** The page tells customers not to bother with anything else, and then the gangway scan fails.
- **Suggested fix:**
  - Either render each ticket's QR inline here (generated locally), or change the copy to "Open your boarding passes"
    with a link, and drop the QR.
  - Build the link from the request host, not `NEXT_PUBLIC_APP_URL`.
  - Remove the dead "Text me the pass" `<span>` (`:150-154`), which looks like a button and does nothing.

#### P8-8 · Medium · Failed or abandoned payments land on a "PAYMENT PROCESSING" screen that never ends

- **Where:**
  - `delivery/page.tsx:15-17` sends any non-`succeeded` return to `/booking/confirmation?…&redirect_status=<x>`.
  - `confirmation/page.tsx:17-19, 28-41`: if the booking isn't `confirmed`, it renders `ProcessingScreen`, whatever
    `redirect_status` (`failed`) or `booking.status` (`cancelled`) is.
  - `ProcessingScreen.tsx:12-18`: polls `router.refresh()` every 3 s, forever, with "Your bank is confirming the
    charge."
  - `CheckoutForm.tsx:264-265`: the cart is removed and `openboat_pending_payment` is set **before**
    `confirmPayment`.
  - `CheckoutClient.tsx:53-58`: with no cart but a pending marker, the page redirects to confirmation.
- **What's wrong (confirmed in code):**
  1. Redirect-based methods are enabled (the test PMC has Klarna, Affirm, Cash App and Amazon Pay). One that is
     declined or cancelled returns with `redirect_status=failed` and lands on "ALMOST THERE" forever. The booking
     later expires to `cancelled`, and the screen keeps spinning.
  2. Take a card that is declined inline. The form shows the error, but the cart is already gone. A reload, or
     visiting `/checkout` again, redirects to the confirmation page of that **unpaid** booking, with the same endless
     spinner. The customer's cart is lost.
- **Why it matters:** The customer is told the payment is going through when it has failed, and can't get back to the
  cart. They may assume they're booked, or abandon the sale.
- **Suggested fix:**
  - Show a terminal state for `redirect_status === "failed"` or `booking.status === "cancelled"` ("Payment didn't go
    through — your seats were released"), with a "Try again" link that restores the cart.
  - Stop polling after about 2 minutes.
  - Keep `openboat_cart` until the delivery page has verified success (P8-1), and clear it there alongside
    `openboat_pending_payment`.

#### P8-9 · Medium · Customer email and phone (and the PI client secret) go into the `return_url` and from there to PostHog

- **Where:**
  - `CheckoutForm.tsx:275`: `return_url: …/booking/delivery?code=…&email=…&phone=…`. Stripe appends
    `payment_intent`, `payment_intent_client_secret` and `redirect_status`.
  - `delivery/page.tsx:11` never reads `email` or `phone`.
  - `PostHogProvider.tsx:10-15`: `capture_pageleave: true`, and autocapture is left at its default (on). Both events
    carry `$current_url`.
  - The provider wraps the whole app (`app/layout.tsx:57`).
- **What's wrong:** Every web booking sends the customer's email, phone and the PI client secret to PostHog on the
  first click or page-leave on the delivery page. They also end up in browser history and in Vercel request logs. The
  values have no use on that page. The same `$current_url` capture sends `/boarding/<bookingId>`, a bearer URL
  (P8-1), to PostHog from the boarding page.
- **Why it matters:** This is systematic PII disclosure to an analytics vendor, with no product reason. The boarding
  URLs in analytics are credentials.
- **Suggested fix:**
  - Drop `email` and `phone` from the `return_url`.
  - Configure PostHog with a `sanitize_properties` / `before_send` hook that strips the query string from
    `$current_url` and `$referrer` on `/booking/*` and `/boarding/*`, or disable capture on those routes.
  - Consider `autocapture: false`, given the admin concern handed to Pass 9.

#### P8-10 · Low · Web cart shows a "SEATS HELD" countdown before any seat is held

- **Where:** `useCart.ts:109-117, 215-223` start a 10-minute client timer on the first "+". `CartRail.tsx:77-85` and
  `MobileCartBar.tsx:26-27, 127` show "SEATS HELD 9:59", then "HOLD EXPIRED — SEATS RELEASED". Checkout stays enabled
  throughout.
- **What's wrong:** Nothing is held until `POST /api/bookings`, and the server hold is 10 *or* 60 minutes
  (`bookings/route.ts:234`). The timer is decorative. Customers are told their seats are safe when they aren't, and
  "expired" carts still check out normally. The mobile app gets this right ("SEATS AREN'T HELD UNTIL YOU PAY",
  `TripSheet.tsx:117`), and so does the web empty state ("Nothing is charged until you pay").
- **Why it matters:** A customer who sees "SEATS HELD" takes their time and may then lose the seats to a 409 at
  checkout. "HOLD EXPIRED" scares off customers whose cart would still have gone through.
- **Suggested fix:** Remove the pre-checkout timer. Show the real `holdExpiresAt` only after the POST, which
  `HoldBanner` already does (`CheckoutForm.tsx:157-183, 312`).

#### P8-11 · Low · Sign-out leaves the offline wallet, the PII and the push registration on the device

- **Where:** `customer-auth-context.tsx:38-41` (`logout` clears only the token). `wallet.ts` has no clear-all, and
  `wallet.db` is unencrypted `expo-sqlite`. `api/push/register` has a `DELETE` (`route.ts:62-85`) that the app never
  calls.
- **What's wrong:**
  - The wallet isn't tied to the signed-in account: anything looked up by code + email stays after sign-out. That
    includes names, emails, phones and every ticket's `qrPayload`.
  - The Expo push token stays active for the signed-out customer. A different person signing in on the same phone
    re-points it (the upsert on `(operatorId, expoToken)`). Signing out alone doesn't, so the device keeps receiving
    that customer's reminders and cancellation notices.
  - This mirrors P6-8, on a phone that is personal rather than shared, so it's lower risk.
- **Why it matters:** A lost, sold or handed-down phone exposes past customers' contact details and still-valid
  boarding passes. A signed-out customer keeps getting notifications about trips that aren't theirs to manage.
- **Suggested fix:**
  - On sign-out, call `DELETE /api/push/register?token=…` before clearing the token.
  - Offer "Remove tickets from this phone" (or clear the wallet when the customer confirms).
  - Purge wallet bookings whose last trip is more than 7 days past on each load.

#### P8-12 · Low · Unconfigured store builds would send customer tokens to a placeholder host; no `https` check

- **Where:** `lib/api.ts:4` accepts any `EXPO_PUBLIC_API_URL`. `eas.json:9` sets the base profile (inherited by
  `consumer`, `preview` and `mate`) to `"https://your-domain.com"`.
- **What's wrong:** The "throw if unset" guard (`api.ts:9`) never fires for EAS builds, because the placeholder counts
  as set. A store build made before the value is replaced would POST customer names, emails, OTP codes and bearer
  tokens to `your-domain.com`, a real third-party domain. Nothing rejects an `http://` URL in a release build either.
- **Why it matters:** This is the one way the customer token could leave the operator's host. It's a single
  configuration slip on the "configure EAS + submit" step that CLAUDE.md lists as still open.
- **Suggested fix:**
  - Fail at startup in non-`__DEV__` builds when the URL is not `https:` or contains `your-domain` / `REPLACE_`.
  - Leave `EXPO_PUBLIC_API_URL` out of the base profile so the guard can fire.

#### P8-13 · Low · Unvalidated operator URLs reach `href` on web and `Linking.openURL` on mobile (P7-4 item 4, client half)

- **Where:** `ConfirmedBookingView.tsx:140` (`dockMapsUrl`, `target="_blank"`); `boarding/[bookingId]/page.tsx:197`
  (`dockMapsUrl`) and `:234` (`termsUrl`); mobile `boarding/[ticketId].tsx:122-126`
  (`Linking.openURL(operator.dockMapsUrl)`, value from the wallet GET).
- **What's wrong:** React escapes attribute values but doesn't block `javascript:` hrefs (React 18 only warns). A
  `javascript:` `termsUrl` set by a tenant admin runs on that tenant's own boarding page. That page has no
  session-bearing cookies for customers, so the impact is limited to the tenant's own site, as P7-4 said. On mobile,
  `Linking.openURL` will open any scheme the OS handles (`tel:`, `sms:`, other apps' deep links) from a tap labeled
  "Directions to the dock". *Needs confirmation for web:* the vendored React in Next 14.2.30 is 18.2.0, which only
  warns. If the App Router build blocks `javascript:` URLs, only the mobile half stands. The fix is the same either way.
- **Why it matters:** A typo or a malicious admin turns the customer's "Directions" or "policy" tap into script or an
  arbitrary app launch, on pages customers are told to trust at the dock.
- **Suggested fix:** Fix it at the source (P7-4: `https:`-only Zod). Also add a small `safeHttpUrl()` guard at render
  time on both clients, for rows written before validation landed.

#### P8-14 · Low · Customer-facing cancellation and refund promises are hard-coded

- **Where:** `CheckoutForm.tsx:402-403` ("FREE CANCELLATION TO 24H BEFORE SAILING", "WEATHER CANCELLATION = AUTOMATIC
  REFUND"); `CartRail.tsx:229`; `BookingCalendar/index.tsx:255`; `ConfirmedBookingView.tsx:179`.
- **What's wrong:**
  - There's no customer cancellation path (no customer-facing cancel endpoint exists).
  - `cancelWindowHrs` is stored but read by nothing (P7-4 item 5).
  - Trip cancellation refunds automatically only through admin action (Pass 4).

  Every tenant's checkout makes the same 24-hour promise, whatever the operator's actual policy.
- **Why it matters:** In centralized mode the platform puts a refund commitment in each operator's mouth at the point
  of sale. Chargebacks cite exactly this kind of copy.
- **Suggested fix:** Render the policy from operator settings (`cancelWindowHrs` plus a `termsUrl` link), or remove the
  claims until a self-service cancel exists.

#### P8-15 · Low · Confirmation and boarding page correctness nits

- `get-confirmed-booking.ts:66-76`: the ticket breakdown has no `voided` filter. Refunded tickets still appear as
  "2 × Adult". It also prints `tickets.priceCents` (the list price, P2-2) next to the discounted item subtotal, so a
  group booking shows lines that don't add up to the subtotal shown.
- `boarding/[bookingId]/page.tsx:15-18`: `params.bookingId` isn't checked as a UUID, so any malformed path is a
  Postgres `22P02` and a 500 rather than a 404. `.ticket-page { width: 8.5in }` (`:263`) forces sideways scrolling
  on phones, which is where customers open it at the dock.
- `(public)/page.tsx:93-99`: the third `Promise.all` query result is discarded (`[weekTripRows, latestReportRows, ,
  categoryRows]`), which is dead work on every homepage render. The week-trips query `.limit(50)` is applied to the
  trip × price join, so busy weeks truncate trips, not prices.
- `SailingsSection.tsx:397`: `/book?trip=<id>` with no `date`, so a trip in next month (the 7-day strip can cross
  a month boundary) isn't found in `initialTrips`, and the pre-add silently does nothing.
- **Why it matters:** Each one is small, but customers read the confirmation and boarding pages at the dock, where a
  wrong line or a sideways-scrolling pass slows boarding.
- **Suggested fixes, in order:**
  - Add `eq(tickets.voided, false)` to the breakdown, and print the item subtotal's per-ticket share, or the
    discount line from P8-3.
  - Validate the param with `z.string().uuid()` and call `notFound()` on failure. Make the page `max-width: 8.5in;
    width: 100%` on screen, and keep the fixed width under `@media print`.
  - Drop the unused query, and dedupe trips before limiting (limit the trips subquery, then join prices).
  - Always include `date=` in the homepage "BOOK" links.

#### P8-16 · Low · Refactor: client pricing and cart state are implemented four times

- **Where:**
  - Web `useCart` holds three parallel copies of the cart (`cart`, `cartPrices`, `cartItems`) that must be kept in
    step. `CartClient` keeps a fourth, separate persisted copy with its own stepper.
  - `CheckoutClient` and `CheckoutForm` each recompute the total.
  - Mobile recomputes it in `trips.tsx`, `cart.tsx` and `checkout.tsx`.
  - There are four whole-dollar formatters, plus `toFixed(2)` in `account.tsx:52` and the cents-aware
    `@openboat/utils` `dollars`.
- **Payoff:** P8-3 and P8-4 are both "two copies disagree" bugs. A single cart store per client (keyed by trip,
  holding trip snapshots) plus the server quote as the only total removes the class. Use the shared `dollars`
  everywhere.

#### P8-17 · Low · Test gaps on the clients

- Nothing tests `useCart` (restore + pre-add, the caps, persistence), `CheckoutForm`'s error branches, or the mobile
  screens.
- `booking-flow.spec.ts` has two tests, the happy path and the post-payment screens. It doesn't cover:
  - a group-discount cart (P8-3);
  - a declined card followed by a retry (P2-3, P8-8);
  - a code-only confirmation URL with `redirect_status=succeeded` on a pending booking (P8-1);
  - `/book` with `NEXT_PUBLIC_BASE_URL` unset (P8-2).
- `lib/__tests__` cover `wallet` and `customer-auth`, but not the refresh-on-404 behavior (P8-6).
- **Why it matters:** P8-1 to P8-6 all sit on paths that no test touches. The one Playwright spec exercises only
  the path where the display and the charge happen to agree.
- **Suggested fix:** Add those four Playwright cases, plus a mobile unit test for the refresh-response handling. Use
  Maestro for the multi-ticket pass (P8-5) once Maestro E2E resumes.

### Handoffs closed

- **From Pass 2 (`:619`), web checkout shows and pre-authorizes `sum(price × qty)`, not `totalCents`: confirmed and
  widened** (P8-3). Group discount and `schedule_prices` both apply. So do rounding and stale `localStorage` prices.
  The POST response's `totalCents` is discarded. Whether Stripe.js rejects the Elements/PI mismatch needs
  confirmation; the procedure is in P8-3.
- **From Pass 3 (`:1012`), `booking/confirmation` trusts `?redirect_status=succeeded` and `getConfirmedBooking`
  doesn't filter by status: confirmed, on both the confirmation and delivery pages, and worse than handed off**,
  because those pages are also an unthrottled code-only lookup (P8-1). The fix is to verify the PI from the
  `payment_intent` query param that Stripe appends.
- **From Pass 5 (`:1778`), `account/bookings` returns pending bookings with ticket IDs: closed, harmless on mobile.**
  - The Account tab (`account.tsx:43-89`) renders only the code, status (a pending booking shows grey "PENDING"),
    items and total. It never renders or stores tickets or QR codes.
  - The offline wallet is filled only from the confirmed-only `GET /api/bookings`.
  - So a pending booking never becomes an offline pass on the consumer app.
  - The ticket IDs in that response still matter for P6-2 (the scanner accepts a bare ID), which is already
    tracked.
- **From Pass 5, how the consumer app reacts to a 401 once tokens are revocable (P5-1, P5-10): silently.**
  - `fetchBookings` ignores any non-OK response (`account.tsx:286`). On 401 the Account tab stays "signed in" with
    an empty list: no sign-out, no prompt.
  - Push preference saves fire and forget (`:221`).
  - The token's `exp` is checked only at app start (`customer-auth-context.tsx:31`), and tokens last 90 days
    (`customer-auth.ts:19`).
  - The wallet is unaffected by a 401, which is the right outcome. It doesn't use the token.
  - **Fix:** on 401 from any token-bearing call, `logout()` and show the sign-in form with "Session expired".
  - The mate half was closed in Pass 6.
- **From Pass 6 (`:2157`, `:2194`), `api.qrserver.com` receives QR data: confirmed in both places, and the boarding
  page is the one that matters.**
  - `boarding/[bookingId]/page.tsx:71, 144` sends every ticket's `qrPayload` (today a bearer credential, P6-2) in
    the `data=` query.
  - `ConfirmedBookingView.tsx:24` sends the boarding URL, which carries the booking ID (P8-1).
  - The default `Referrer-Policy` sends only the origin, so the page URL itself doesn't leak by Referer.
  - **Fix:** render the codes server-side as inline SVG with a QR library (for example `qrcode`, which has no
    network dependency) before the HMAC payloads land. Mobile already renders locally.
- **P7-4 item 4 (scheme check on `termsUrl` / `dockMapsUrl`): confirmed on web, and also present on mobile** (P8-13).
- **P2-4 (no client shows the $1.50 fee line): closed for the clients.**
  - No web or mobile screen shows a fee line, and none adds the fee to a displayed total.
  - That matches what is charged: the PI `amount` is ticket prices minus discount, with the fee taken out of the
    operator's share.
  - So the display is consistent with the charge. The inconsistency P2-4 describes is between the admin
    `fee_bearer = passenger` setting and both, and it's server-side.
  - When `fee_bearer = passenger` is implemented, the server quote from P8-3 must return the fee line, so the
    clients show it before the charge.
- **P2-5 (delayed-settlement methods on web): partly settled, still needs confirmation for live mode.**
  - The client doesn't restrict anything: `Elements` gets `mode: "payment"` with no `paymentMethodTypes` or
    `paymentMethodConfiguration` (`CheckoutClient.tsx:97-100`). So the web checkout offers whatever the platform's
    default PMC enables.
  - **Test mode, checked through the API:** the default PMC `pmc_1TpKMVQ2…` has `affirm, amazon_pay, apple_pay,
    bancontact, blik, card, cashapp, eps, kakao_pay, klarna, link, mb_way, naver_pay, payco, pix, promptpay,
    samsung_pay, satispay` on. That's no `us_bank_account` or other USD delayed-notification method, so P2-5 doesn't
    reproduce in test.
  - It does enable several **redirect** methods, which is what makes P8-8 reachable.
  - BLIK is on, but Stripe's deferred-intent guide says that flow doesn't support it. It's PLN-only, so USD checkout
    won't show it.
  - **Live-mode** configuration still has to be checked in the Dashboard before launch. The fix stands: pin the
    allowed types on both the PI and `Elements`.

- **Tracker cross-check (`security-audit-2026-08-05.md`, `docs/architecture-review-findings.md`):**
  - `:57-60` ("boarding, confirmation and delivery pages have no operator scope", `[x]`): verified fixed (see the
    scoping table).
  - `:43-46` (`extend-hold` takes any `bookingId`, `[x]`): verified that the fix landed. It has an operator scope,
    an IP limit and a 90-minute cap (`extend-hold/route.ts:9, 20, 40`). It still has no customer token. That matters
    more now that P8-1 makes booking IDs obtainable from a code, but the 90-minute cap bounds the damage.
  - Security audit `:47` (code-only brute force of the wallet lookup, fixed by requiring email): **reopened in
    substance** by P8-1, on a different surface.
  - `:185-188` (wallet IP-bucket reset, `[x]`): verified that only the email bucket resets (`bookings/route.ts:424`).
    That's exactly why P8-6's refresh fan-out exhausts the IP bucket.

### Handoffs to later passes

- **Pass 9 (admin UI / PostHog):** PostHog autocapture is on for the whole app, admin included
  (`app/layout.tsx:57`). Autocapture records the text of clicked elements, so clicking a passenger row in the
  manifest or today views probably sends names to PostHog. Confirm on the merchant pages, and apply the same
  `before_send` / route opt-out as P8-9.
- **Pass 9 (`date-et`):**
  - Mobile `boarding/[ticketId].tsx:113-116` computes the boarding countdown with device-local `setHours`, so it's
    wrong on any phone not set to ET.
  - The web `fmtDayLabel` (`BookingCalendar/format.ts:26-27`), the mobile `trips.tsx:34-36` and `tickets.tsx:38-39`
    compute "TODAY" / "TOMORROW" from the UTC date, so they're a day ahead after 8 PM EDT.
  - `book/page.tsx:6-9` picks the current month in server-local time (UTC on Vercel).
- **Pass 9 (CI / deploy):**
  - Add a page-render smoke test for `/book` (P8-2).
  - Separate the mate and consumer bundle IDs and schemes (see "Auth invariants").
  - Remove the `eas.json` placeholder URL (P8-12).

### Auth invariants (consumer app)

- **Only customer tokens:** confirmed (see "What's clean"). No consumer screen calls a staff path, and there's no
  fallback between the two.
- **Caveat: the consumer binary ships the mate app.** `app/_layout.tsx:29` declares the `(mate)` stack in both
  variants. `app.json` gives both variants one `bundleIdentifier` (`com.openboat.fishing`) and one scheme
  (`openboatfishing`). So `openboatfishing://login` opens the mate PIN screen in the consumer app, which would then
  store a `mate_token` there. It isn't exploitable on its own (it still needs a valid PIN, and P5-3 already covers
  brute force). But it means "the consumer app never holds mate tokens" is true by convention, not by construction.
  The shared bundle ID also means installing the internal mate build over the consumer app keeps the consumer's
  `wallet.db` and SecureStore.
  - **Suggested fix:** Give the mate variant its own bundle ID and scheme, through `app.config.ts` keyed on
    `EXPO_PUBLIC_APP_VARIANT`. Have `(mate)/_layout.tsx` redirect out when `!IS_MATE`, and the reverse for
    `(tabs)`. Pass 9 (CI/deploy) can pick up the config part.
- **Rate limits:** the clients don't loop on `/api/auth/*`. The only limiter-defeating patterns are on the wallet GET
  (P2-8 polling, P8-6 refresh fan-out).
