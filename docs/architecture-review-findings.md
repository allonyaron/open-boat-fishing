# Architecture Review Findings

> Generated 2026-08-31. Seven Opus agents reviewed: Auth, Stripe/Webhook, Seat Inventory, Multi-tenant Middleware, Cron Jobs, Rate Limiting, Booking Flow.

---

## P0 — Critical (fix before any production deployment)

These are exploitable on a live centralized deployment with no authentication required.

- [ ] **Middleware trusts client-supplied `x-operator-id` header**
  Middleware short-circuits if the header is already present, so any unauthenticated caller can impersonate any operator. Defeats every tenant boundary in the codebase.
  `apps/web/src/middleware.ts:23-26`
  Fix: always strip and overwrite the header from the resolved operator, never pass it through from the client.

- [ ] **`vercel.json` crons array is empty — no crons are actually running**
  `expire-pending-bookings`, `trip-reminders`, and `reset-demo-data` are unregistered. Abandoned bookings never release seats; trip reminder pushes never fire.
  `apps/web/vercel.json`
  Fix: add all three cron entries. Use `*/10 * * * *` for expiry (Pro) or `0 * * * *` (Hobby), `0 * * * *` for reminders, and a nightly schedule for demo reset.

- [ ] **Demo reset has no operator scoping — wipes all operators' data**
  `resetBookingActivity()` deletes `checkIns`, `bookings`, `tickets`, etc. with no `WHERE operator_id = ...`. In centralized mode this wipes every operator's data.
  `apps/web/src/lib/demo-reset.ts:22-46`
  Fix: introduce a `DEMO_OPERATOR_ID` env var and scope every delete to it.

- [ ] **`clientIp()` reads the leftmost (attacker-controlled) `x-forwarded-for` value**
  Every IP-keyed rate limit is bypassable by spoofing the header. An attacker rotating `X-Forwarded-For` values bypasses booking-create DoS protection, admin-login brute-force guard, OTP flooding limit, and wallet-lookup limit.
  `apps/web/src/lib/rate-limit.ts:6-8`
  Fix: use `x-real-ip` (Vercel sets this) or the rightmost `x-forwarded-for` entry.

- [ ] **Cross-operator trip booking via unsanitized cart `tripId`**
  `POST /api/bookings` locks and decrements seats with `inArray(trips.id, tripIds)` and no `operatorId` filter. A caller on operator A's domain can drain operator B's inventory and route payment to A's Stripe account.
  `apps/web/src/app/api/bookings/route.ts:107-111`
  Fix: add `eq(trips.operatorId, operator.id)` to the `FOR UPDATE` query. Apply the same filter to the price and vessel lookups at lines 132–134.

- [ ] **Stripe Connect OAuth has no `state` parameter (CSRF)**
  The Connect authorize URL is built without a `state` param and the callback never validates one. An attacker can trick an authenticated admin into linking the platform to the attacker's Stripe account, routing all future bookings to it.
  `apps/web/src/app/api/stripe/connect/start/route.ts:18-23`
  `apps/web/src/app/api/stripe/connect/callback/route.ts:22-27`
  Fix: generate a signed `state` (HMAC of `operatorId + nonce` with `SESSION_SECRET`) in `start`, store in a short-lived signed cookie, and validate in `callback` before writing `stripeAccountId`.

- [ ] **`extend-hold` has no auth, no operator scope, no extension cap**
  Anyone with a `bookingId` (obtainable from the confirmation URL) can extend holds indefinitely, permanently locking seats out of inventory.
  `apps/web/src/app/api/bookings/[bookingId]/extend-hold/route.ts`
  Fix: require customer session token; scope by `operatorId`; cap total hold lifetime (e.g. max 2 extensions or 90 min total); add IP rate limit.

---

## P1 — High (fix before taking real money)

- [ ] **ISR cache on fishing-reports pages serves one operator's data to all operators**
  `export const revalidate = 300` on both `/fishing-reports` and `/fishing-reports/[reportId]`. Next.js keys the cache by path, not host — whichever operator populates the cache first wins for 5 minutes across all tenants.
  `apps/web/src/app/fishing-reports/page.tsx:8`
  `apps/web/src/app/fishing-reports/[reportId]/page.tsx:11`
  Fix: `export const dynamic = "force-dynamic"` in centralized mode, or key ISR by operator slug in the path.

- [ ] **Boarding, confirmation, and delivery pages have no operator scope**
  All three pages fetch bookings by `id` or `confirmationCode` with no `operatorId` filter — another operator's customer data renders under the wrong brand.
  `apps/web/src/app/boarding/[bookingId]/page.tsx:10,40`
  `apps/web/src/app/booking/confirmation/page.tsx:17,39`
  `apps/web/src/app/booking/delivery/page.tsx:20`
  Fix: add `eq(bookings.operatorId, operator.id)` to every booking lookup; call `notFound()` on mismatch.

- [ ] **`GET /api/bookings` wallet lookup has no operator scope**
  Filters only on `(email, code, status)`. A confirmed booking on operator B can be fetched from operator A's domain.
  `apps/web/src/app/api/bookings/route.ts:387-396`
  Fix: resolve operator context in the GET handler and add `eq(bookings.operatorId, operatorId)` to the WHERE clause.

- [ ] **Push register uses the spoofable `x-operator-id` header instead of token's `operatorId`**
  `requireCustomer(req)` gives a token with an embedded `operatorId` — but the route ignores it and uses `getOperatorId(req)` (the header). With P0 middleware fix, this is safe; without it, tokens register push tokens under the wrong operator.
  `apps/web/src/app/api/push/register/route.ts:28-29`
  Fix: use `customer.operatorId` from the verified token for scoping.

- [ ] **Staff lookup at mate and admin login is not scoped by operator**
  Both routes do `WHERE email = $1` with no `operatorId`, then check `member.operatorId !== operatorId` in code. The same email can exist for two operators; Postgres returns an arbitrary row, causing legitimate staff to silently fail login.
  `apps/web/src/app/api/mate/auth/route.ts:28-30`
  `apps/web/src/app/api/admin/auth/login/route.ts:27-31`
  Fix: change to `WHERE email = $1 AND operator_id = $2`.

- [ ] **Admin capacity PATCH is a read-modify-write race (can overbook)**
  The route reads `seatsRemaining`, computes a delta, and writes — without a `FOR UPDATE` lock. A concurrent booking's SQL-arithmetic decrement is silently overwritten.
  `apps/web/src/app/api/admin/trips/[tripId]/route.ts:108-146`
  Fix: wrap in a transaction with `FOR UPDATE` on the trip row and use SQL arithmetic for the update.

- [ ] **Mate capacity PATCH has the same read-modify-write race**
  `apps/web/src/app/api/mate/trips/[tripId]/capacity/route.ts:20-80`
  Fix: same as above.

- [ ] **`POST /api/bookings` does not check `trip.status`**
  A customer can book a trip that is `cancelled` or `sailed`. Also: during admin trip-cancellation, there's a multi-second window where the trip is logically cancelled but still `scheduled` in the DB.
  `apps/web/src/app/api/bookings/route.ts:117-125`
  Fix: add `if (trip.status !== "scheduled") throw 409` inside the `FOR UPDATE` loop.

- [ ] **No DB-level `CHECK (seats_remaining >= 0)` constraint**
  Application-level guards are present in the main booking path but absent in capacity edits, cancellations, and refund paths. One missed guard anywhere silently overbooks.
  `packages/db/src/schema.ts`
  Fix: add migration `ALTER TABLE trips ADD CONSTRAINT trips_seats_remaining_non_negative CHECK (seats_remaining >= 0)`.

- [ ] **`expire-pending-bookings` will time out on large backlogs**
  Each iteration makes two Stripe API calls (~500 ms each). At 120 stale bookings the cron exceeds Vercel's 60 s Pro limit; if it times out mid-run, seats are never restored and all subsequent runs also time out.
  `apps/web/src/app/api/cron/expire-pending-bookings/route.ts`
  Fix: cap SELECT to `.limit(50)`; parallelize in chunks of 5–10; add `export const maxDuration = 60`.

- [ ] **`/api/platform/auth` has no rate limit**
  The platform-admin login (which can provision new operators) does a bare `!==` compare with no `checkRateLimit` call and no timing-safe comparison.
  `apps/web/src/app/api/platform/auth/route.ts:5-21`
  Fix: add IP-scoped rate limit; use `crypto.timingSafeEqual` for the secret compare.

- [ ] **Token vs. request header operator mismatch in `requireCustomer`/`requireMate`**
  A valid token issued for operator A is accepted on operator B's hostname — downstream code uses the token's `operatorId`, silently scoping queries to A while the request is on B's domain.
  `apps/web/src/lib/customer-auth.ts:46-58`
  `apps/web/src/lib/mate-auth.ts:48-63`
  Fix: read `getOperatorId(req)` inside `requireCustomer`/`requireMate` and return 403 if it doesn't match `payload.operatorId`.

- [ ] **`trip-reminders` has N+1 queries per trip — timeout risk at scale**
  One `SELECT bookingItems` + one `SELECT bookings` per upcoming trip. At 100 trips this is 200+ round-trips per hourly cron.
  `apps/web/src/app/api/cron/trip-reminders/route.ts:42-76`
  Fix: replace the loop with a single joined query across trips, booking_items, bookings, vessels, and products.

- [ ] **Stripe-PI-failure rollback path is not idempotent with the expiry cron**
  The catch block at booking creation restores seats without a `FOR UPDATE` lock. If the expiry cron concurrently processes the same booking, seats are restored twice → silent overbook.
  `apps/web/src/app/api/bookings/route.ts:325-337`
  Fix: route through `cancelPendingBooking(booking.id)` (which has `FOR UPDATE` + status check) instead of open-coding the rollback.

- [ ] **Admin trip cancellation resets `seatsRemaining = capacity` from a stale read**
  `seatsRemaining` is read before the (slow) Stripe refund loop. The reset at the end overwrites any bookings that came in during the refund window.
  `apps/web/src/app/api/admin/trips/[tripId]/cancel/route.ts:147`
  Fix: use `sql\`${trips.capacity}\`` inside the transaction so the reset reads the live value.

---

## P2 — Medium (fix before centralized launch)

- [ ] **Email not normalized to lowercase in `POST /api/bookings`**
  The Zod schema stores `customerEmail` as-is. The wallet lookup downcases before querying. A booking created with `Jane@Example.com` will 404 on wallet lookup.
  `apps/web/src/app/api/bookings/route.ts:30`
  Fix: add `.transform(s => s.toLowerCase().trim())` to the `customerEmail` Zod field.

- [ ] **Rate-limit keys don't include `operatorId` — cross-tenant DoS**
  One operator's IP traffic can exhaust another operator's booking-create or wallet-lookup budget. Three separate agents flagged this.
  `apps/web/src/app/api/bookings/route.ts:65,370-371`
  Fix: prefix all rate-limit keys with `operatorId` in centralized mode.

- [ ] **`charge.refunded` silently drops partial refunds**
  Dashboard-issued partial refunds are logged and ignored. The ticket stays valid and boardable; the fee remains `held` and will later be counted as `earned`.
  `apps/web/src/lib/webhooks/charge-refunded.ts:12-17`
  Fix: on partial refund, flag the booking `needs_review` and alert the operator.

- [ ] **Full refund via `charge.refunded` doesn't reverse the `application_fee` in Stripe**
  Local `fee_status` is set to `reversed` but `stripe.applicationFees.createRefund()` is never called. Platform keeps the fee on a refunded charge.
  `apps/web/src/lib/webhooks/charge-refunded.ts:35`
  Fix: call `stripe.applicationFees.createRefund(applicationFeeId)` before flipping local state.

- [ ] **`payment_intent.succeeded` after a cancelled booking logs but doesn't auto-refund**
  The customer has paid; the booking is already cancelled; no refund is issued automatically.
  `apps/web/src/lib/webhooks/payment-intent-succeeded.ts:57-62`
  Fix: call `stripe.refunds.create({ payment_intent: pi.id, reverse_transfer: true, refund_application_fee: true })` in this branch.

- [ ] **`charge.dispute.created` handler is not wrapped in a transaction and lacks operator scope**
  Three sequential writes with no transaction — a crash between steps leaves tickets valid while a dispute is open. Queries also have no `operatorId` filter.
  `apps/web/src/lib/webhooks/charge-dispute-created.ts:17-38`
  Fix: wrap in a single transaction; add `operatorId` filter; flip `feeStatus` to `reversed` on voided tickets.

- [ ] **Per-ticket admin refund is not atomic**
  Two Stripe API calls happen before the DB transaction. A failure between them leaves a refunded customer with a still-valid boardable ticket.
  `apps/web/src/app/api/admin/tickets/[ticketId]/refund/route.ts:48-80`
  Fix: mark ticket voided + restore seat in the DB first, then call Stripe; on Stripe failure, alert the operator with the ledger row visible.

- [ ] **Trip cancellation rolls forward on partial Stripe-refund failure**
  If refund #3 fails, refunds #1 and #2 have already gone through, but no booking rows are updated. A retry double-refunds.
  `apps/web/src/app/api/admin/trips/[tripId]/cancel/route.ts:81-108`
  Fix: persist each refund ID to a `refund_ledger` table as it succeeds, so retries are idempotent.

- [ ] **Old OTPs are not invalidated when a new one is requested**
  Multiple OTPs can be live simultaneously; an attacker who intercepts one has a full 15-minute window even after the user requests a new code.
  `apps/web/src/app/api/auth/request/route.ts:37-42`
  Fix: `UPDATE magic_link_otps SET used = true WHERE operator_id = $1 AND email = $2 AND used = false` before inserting the new row.

- [ ] **Timing oracle on mate and admin login**
  When a staff email isn't found, no `bcrypt.compare` runs — response time is significantly shorter than for a wrong-password hit, leaking the staff roster.
  `apps/web/src/app/api/mate/auth/route.ts:28-49`
  `apps/web/src/app/api/admin/auth/login/route.ts:27-44`
  Fix: always run `await compare(pin, DUMMY_HASH)` before returning `Invalid credentials`.

- [ ] **Wallet-lookup IP-bucket reset enables targeted enumeration**
  On a successful wallet lookup, both the email and IP rate-limit buckets are reset. An attacker with one valid pair can repeatedly reset the IP budget to probe other victims.
  `apps/web/src/app/api/bookings/route.ts:403`
  Fix: reset only the email bucket on success; let the IP bucket expire naturally.

- [ ] **CRON_SECRET comparison is not timing-safe on all three cron routes**
  Plain `!==` string comparison. Consistent with `SESSION_SECRET` which uses `timingSafeEqual`.
  `apps/web/src/app/api/cron/expire-pending-bookings/route.ts:22`
  `apps/web/src/app/api/cron/trip-reminders/route.ts:14`
  Fix: extract a shared `verifyCronAuth(header)` helper using `crypto.timingSafeEqual`. Also standardize on `env.CRON_SECRET` (not `process.env.CRON_SECRET`) across all three files.

- [ ] **`trip-reminders` sends duplicate push notifications per email**
  If a customer has two bookings on the same trip, they receive two push notifications.
  `apps/web/src/app/api/cron/trip-reminders/route.ts:50-56`
  Fix: deduplicate emails with `[...new Set(emails)]` before calling `sendPushToEmails`.

- [ ] **Duplicate `tripId` in cart silently creates two `bookingItems` for one trip**
  The Zod schema allows duplicate `tripId`s. Seat decrement is correct (accumulated), but two `bookingItems` rows are inserted for the same trip.
  `apps/web/src/app/api/bookings/route.ts:88-93`
  Fix: reject duplicate `tripId`s after Zod parse with a 400.

- [ ] **`OPERATOR_ID` env var not validated against DB at boot**
  A stale or mistyped `OPERATOR_ID` causes every `getOperatorContext()` call to return `null` → silent 500s or blank pages rather than a fast boot failure.
  `apps/web/src/middleware.ts:30-33`
  Fix: in `instrumentation.ts`, if `OPERATOR_ID` is set, do a one-time `SELECT id FROM operators WHERE id = $1` and throw at boot if missing.

- [ ] **Hostname not lowercased in middleware domain lookup**
  `domains.domain` is stored lowercase but the `host` header is not lowercased before comparison. RFC-legal uppercase hostnames (e.g. `OPENBOATFISHING.COM`) fail to resolve.
  `apps/web/src/middleware.ts:36`
  Fix: `.toLowerCase()` on the parsed hostname.

- [ ] **`/api/platform/operators` body is not Zod-validated**
  Operator creation uses an untyped cast instead of a schema. `domain`, `emailFrom`, `emailDomain`, and `slug` are not validated for shape or uniqueness.
  `apps/web/src/app/api/platform/operators/route.ts:38-103`
  Fix: add a Zod schema enforcing hostname regex on `domain`/`emailDomain`, email format on `emailFrom`, max lengths on all fields.

- [ ] **Push notification in expiry cron is fire-and-forget — may be dropped on Vercel**
  `sendPushToEmails(...).catch(...)` is not awaited with `waitUntil()`. Vercel freezes the function context on response, dropping in-flight promises.
  `apps/web/src/app/api/cron/expire-pending-bookings/route.ts:102-111`
  Fix: wrap in `waitUntil()` from `@vercel/functions`.

- [ ] **Verify `push.ts` scopes push-token lookup by `operatorId`**
  `trip-reminders` calls `sendPushToEmails` per trip with `trip.operatorId` — but if `push.ts` doesn't scope the `push_tokens` query by operator, push notifications leak across tenants. Elevate to Critical if unscoped.
  `apps/web/src/lib/push.ts`

- [ ] **PIN and OTP-verify rate limits have no IP fallback**
  `mate-auth` and `otp-verify` are keyed by email only. An attacker can parallelize across many emails from one host with no IP-level pressure.
  `apps/web/src/app/api/mate/auth/route.ts:20`
  `apps/web/src/app/api/auth/verify/route.ts:21`
  Fix: add a coarse IP-scoped bucket alongside the email bucket, following the pattern in `/api/auth/request`.

---

## P3 — Low / Post-launch cleanup

- [ ] **No webhook idempotency table keyed on `event.id`**
  Deduplication relies on status-check guards in each handler. Any new handler that skips the guard will silently double-process.
  Fix (post-launch): add `processed_webhook_events(event_id PRIMARY KEY)` and short-circuit in the outer webhook handler.

- [ ] **Customer tokens have a 90-day TTL with no revocation mechanism**
  A stolen customer token is valid for 3 months. Mate tokens are 24 hours — a fired mate can still scan tickets until end-of-day.
  Fix: add `revoked_at` column on `customers`/`staff` checked by `requireCustomer`/`requireMate`, or embed a `session_version` that increments on account changes.

- [ ] **Rate-limit table cleanup is coupled to the booking-expiry cron**
  If expiry cron is disabled or fails, the `rate_limits` table grows unbounded.
  Fix: move the `DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'` to its own cron or add a `window_start` index to keep the cleanup fast.

- [ ] **Add `window_start` index to `rate_limits` table**
  The cleanup DELETE is a full table scan without an index on `window_start`.
  Fix: `CREATE INDEX ON rate_limits (window_start)`.

- [ ] **Middleware queries the DB on every request with no cache**
  In centralized mode the Edge middleware does a DB round-trip per request. No `unstable_cache`, no KV.
  Fix: add an in-memory `Map<hostname, {operatorId, expiresAt}>` with a 60–300 s TTL at module scope; also move `neon()` instantiation to module scope.

- [ ] **Stripe webhook endpoint API version should be documented and enforced**
  SDK is pinned to `2026-06-24.dahlia`; webhook endpoint API version in the Stripe Dashboard must match or event object shapes diverge silently.
  Fix: document in `docs/openboatfishing-demo-deploy.md`; log a warning when `event.api_version !== expectedVersion`.

- [ ] **Legacy stale-window `OR` branch in `expire-pending-bookings`**
  The `holdExpiresAt IS NULL AND createdAt < 30-min-ago` branch exists for rows created before the `holdExpiresAt` column was added. Verify no such rows remain in prod and remove the branch.
  `apps/web/src/app/api/cron/expire-pending-bookings/route.ts:44-49`

- [ ] **`docs/refactoring-backlog.md` states `earned` never transitions — this is now wrong**
  `settleTrips()` is implemented and called on revenue page render. Update the docs.

- [ ] **`rate_limits` cleanup in expiry cron has no error handling**
  A failed purge crashes the cron response. Wrap in try/catch.

- [ ] **Staff email normalization should happen on write, not just on read**
  Both login routes normalize to lowercase before querying, but creation routes may store mixed-case emails.
  Fix: normalize `staff.email` to lowercase at insert time.

- [ ] **Rate-limit keys for mate-auth and admin-login don't include `operatorId`**
  In centralized mode, one operator's staff can lock out another operator's staff via shared email or IP buckets.
  Fix: prefix with `operatorId` — `mate-auth:${operatorId}:${email}`, `admin-login:${operatorId}:${ip}`.

- [ ] **Group discount pro-ration has double-rounding penny drift**
  `sum(bookingItems.subtotalCents)` can differ from `booking.totalCents` by ±1 cent per item.
  `apps/web/src/app/api/bookings/route.ts:194,258-263`
  Fix: assign rounded total to items and give the last item the remainder.

- [ ] **Middleware 404 for unknown hosts leaks the platform fingerprint**
  Returns `"No operator configured for this domain"` which distinguishes the platform from a normal 404.
  Fix: return a generic 404 with no body text.

- [ ] **`reset-demo-data` does not cancel live Stripe PaymentIntents before wiping bookings**
  Orphaned PIs can succeed after the reset and fire webhooks that reference deleted booking rows.
  Fix: cancel pending PIs before delete.

- [ ] **`bookings.confirmationCode` has no unique constraint**
  Birthday collision at ~4,000 total bookings. Not a security issue but a UX confusion risk.
  Fix: add a migration adding `UNIQUE` to `bookings.confirmation_code`.

- [ ] **Staff `UPDATE` route lacks `operatorId` in the `WHERE` clause (defense-in-depth)**
  The preceding `SELECT` scopes by operator, but the `UPDATE` uses only `id`. A future refactor dropping the SELECT would make the update cross-tenant.
  `apps/web/src/app/api/admin/settings/staff/[staffId]/route.ts:62-66`
  Fix: add `and(eq(staff.id, staffId), eq(staff.operatorId, session.operatorId))` to the UPDATE.

---

## Findings count by subsystem

| Subsystem | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Multi-tenant middleware | 3 | 6 | 4 | 2 | 15 |
| Seat inventory | 2 | 5 | 2 | 1 | 10 |
| Rate limiting | 1 | 2 | 4 | 4 | 11 |
| Cron jobs | 1 | 3 | 4 | 3 | 11 |
| Stripe / webhook | 0 | 2 | 6 | 5 | 13 |
| Auth | 0 | 1 | 4 | 4 | 9 |
| Booking flow | 0 | 1 | 5 | 7 | 13 |
| **Total** | **7** | **20** | **29** | **26** | **82** |
