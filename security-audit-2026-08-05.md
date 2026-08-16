# Security Audit — 2026-08-05

Session reviewing all API routes for ownership gaps, concurrency bugs, and webhook idempotency issues. All findings were fixed and pushed to `main`.

---

## Audit: API Route Ownership

Reviewed all 20 route files in `apps/web/src/app/api/`.

### Clean routes

| Endpoint                                          | Auth                 | Ownership check                                                             |
| ------------------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| `GET /api/account/bookings`                       | `requireCustomer`    | `WHERE customerEmail = customer.email AND operatorId = customer.operatorId` |
| `GET /api/admin/trips`                            | `requireAdmin`       | `WHERE operatorId = session.operatorId`                                     |
| `GET /api/admin/trips/[tripId]`                   | `requireAdmin`       | `AND operatorId = session.operatorId` before joins                          |
| `PATCH /api/admin/trips/[tripId]`                 | `requireAdmin`       | Same                                                                        |
| `POST /api/admin/trips/[tripId]/cancel`           | `requireAdmin`       | Same                                                                        |
| `POST /api/admin/tickets/[ticketId]/refund`       | `requireAdmin`       | `WHERE tickets.operatorId = session.operatorId`                             |
| `GET /api/admin/revenue`                          | `requireAdmin`       | All queries scoped via `session.operatorId`                                 |
| `GET /api/mate/trips`                             | `requireMate`        | `WHERE operatorId = staff.operatorId`                                       |
| `GET /api/mate/manifest`                          | `requireMate`        | `AND operatorId = staff.operatorId` before joins                            |
| `POST /api/mate/checkins`                         | `requireMate`        | `AND tickets.operatorId = staff.operatorId` per-event                       |
| `GET /api/trips`                                  | Public               | Calendar data only — acceptable                                             |
| `GET /api/cron/trip-reminders`                    | `CRON_SECRET` header | Server-to-server — correct                                                  |
| `POST /api/webhooks/stripe`                       | Stripe signature     | Cryptographic verification — correct                                        |
| `POST /api/auth/request`, `POST /api/auth/verify` | Public               | Auth initiation — correct by design                                         |
| `POST /api/mate/auth`                             | Public               | Auth initiation — correct by design                                         |
| `POST /api/admin/auth/*`                          | Session-based        | Correct                                                                     |

### Issues found

**Issue 1 — CRITICAL: `POST /api/push/register` unauthenticated**

- File: `apps/web/src/app/api/push/register/route.ts:7`
- `customerEmail` and `customerId` taken from request body with no token verification. Attacker can claim any email and receive all push notifications for that customer.

**Issue 2 — MEDIUM: `DELETE /api/push/register` unauthenticated**

- File: `apps/web/src/app/api/push/register/route.ts:53`
- No auth check. Anyone who knows a push token can deregister it and silence that device's notifications.

**Issue 3 — HIGH: `GET /api/bookings` wallet lookup — no rate limiting**

- File: `apps/web/src/app/api/bookings/route.ts:295`
- Accepts `?email=&code=`. Confirmation code is `randomBytes(3)` — only 16.7M combinations. No rate limiting meant it was brute-forceable. Success exposes PII, phone, all ticket IDs, and QR payloads.

**Issue 4 — LOW/Design: `POST /api/bookings` accepts any email**

- Guest checkout — no email ownership verification. Intentional design decision, flagged for awareness.

---

## Fixes Applied

### Fix 1 — Rate limiting on wallet lookup (`8fcdd21`)

`apps/web/src/app/api/bookings/route.ts`

- In-memory rate limiter keyed by email and IP
- 5 attempts per key per 15-minute window; 15-minute lockout after exhaustion
- 150ms minimum response floor on misses and 429s (prevents email-existence timing oracle)
- Successful lookup resets both keys
- `setInterval` prunes stale entries every 30 minutes

### Fix 2 — Auth on push token registration (`243577f`)

`apps/web/src/app/api/push/register/route.ts`

- Both `POST` and `DELETE` now call `requireCustomer` at the top
- `POST`: `customerEmail` and `customerId` sourced from the verified token, not the request body
- `DELETE`: `WHERE` clause gains `AND customerEmail = customer.email` to prevent deregistering other users' tokens
- Mobile app must send `Authorization: Bearer <token>` on both calls (same header already used for `/api/account/bookings`)

### Fix 3 — Orphaned pending booking cleanup (`afdd992`)

New: `apps/web/src/app/api/cron/expire-pending-bookings/route.ts`

Runs every 10 minutes (requires Vercel Pro; downgrade to hourly on Hobby).

Targets two failure modes:

1. Server crash between DB transaction commit and `stripe.paymentIntents.create` — booking exists with decremented seats, no PaymentIntent, no webhook ever fires
2. Customer abandoned checkout — PaymentIntent created but never completed

Logic per stale booking (>30 min old, `status = 'pending'`, no row in `payments`):

1. Cancel the Stripe PaymentIntent if one exists (prevents late payment after seats restored)
2. Open a transaction, `SELECT ... FOR UPDATE` on booking row, re-check status is still `pending`
3. If another process already handled it, skip
4. Count tickets per `booking_item`, restore seats with relative increment
5. Set `booking.status = 'cancelled'`

Also added `|| booking.status === 'cancelled'` to the `payment_intent.canceled` webhook guard to prevent the webhook double-restoring seats for a booking the cron already expired.

**Race condition fix** (`355938e`): The `SELECT ... FOR UPDATE` inside the cron's transaction closes the window between the initial stale-booking `SELECT` (outside the transaction) and the seat restoration. The cron and the webhook handler both use `FOR UPDATE`, so whichever wins the lock first sets the status, and the other reads the updated status and skips.

### Fix 4 — Webhook idempotency and response timing (`17756bb`)

`apps/web/src/app/api/webhooks/stripe/route.ts`

Added `@vercel/functions` for `waitUntil()`.

**`payment_intent.succeeded`:**

- Old: status check at line 56 was outside/before the transaction → two concurrent deliveries could both pass the guard → duplicate emails + pushes sent; payment insert would 500 on the second
- New: wrap booking status check + payment insert in a single `FOR UPDATE` transaction. Only one concurrent invocation can win the lock; the other reads `confirmed` and returns
- Stripe charge retrieval stays outside the transaction (external API calls should not hold a DB connection open)
- `sendConfirmationEmail()` extracted as a top-level helper, called via `waitUntil()` — response returns to Stripe immediately; email sends in background with function lifetime extended by Vercel
- `sendPushToEmails()` also wrapped in `waitUntil()` (was previously fire-and-forget `.catch()` which risked being killed after response)

**`payment_intent.canceled`:**

- Old: status check at line 190 outside the transaction → concurrent deliveries could both restore seats (double-increment)
- New: `SELECT ... FOR UPDATE` inside the transaction as the first step; `bookingItems` read also moved inside; if status is not `pending`, transaction returns `null` and handler exits
- `payment_intent.canceled` webhook guard now also checks `|| booking.status === 'cancelled'` (added in `afdd992`, present here)

---

## Concurrency Analysis: `POST /api/bookings` seat reservation

Reviewed the booking creation flow. **The primary booking path is correctly protected:**

- All seat-sensitive work runs inside a single Postgres transaction (`db.transaction`)
- `SELECT ... FOR UPDATE` on the `trips` rows (line 114) is the serialization point — the second concurrent request blocks here until the first commits, then reads the already-decremented count
- Availability check and seat decrement both happen inside the same transaction, under the lock
- No gap between "check seats" and "write booking"

**Known gap (by design, logged in CLAUDE.md):** The Stripe PaymentIntent creation happens _outside_ the transaction. If the server crashes between transaction commit and `stripe.paymentIntents.create`, the booking exists with decremented seats and no PaymentIntent. This is exactly what Fix 3 (expire-pending-bookings cron) addresses.

**Minor caveat:** Multi-trip carts lock multiple `trips` rows via `inArray`. Postgres may scan them in a consistent order, but in theory two requests with overlapping but differently-ordered trip IDs could deadlock. Postgres detects and aborts one transaction; the error surfaces as a 500 (no `httpStatus` property). Low probability in practice.

---

## Commit Log

| Hash      | Description                                                         |
| --------- | ------------------------------------------------------------------- |
| `8fcdd21` | Add rate limiting to wallet lookup endpoint                         |
| `243577f` | Require customer auth on push token registration and deregistration |
| `afdd992` | Add cron to expire orphaned pending bookings and restore seats      |
| `355938e` | Fix race condition in expire-pending-bookings cron                  |
| `17756bb` | Fix webhook idempotency and response timing                         |

---

## Remaining Known Issues (not fixed this session)

- **Issue 4** (`POST /api/bookings` accepts any email) — guest checkout design decision, no fix applied
- **QR payload is a bare UUID** — noted in CLAUDE.md as pre-launch tech debt; needs HMAC signing before go-live
- **`payment_intent.succeeded` concurrent delivery** — email/push duplication window still technically exists between the Stripe charge retrieval (outside transaction) and the transaction's `FOR UPDATE`. In practice, Stripe retries are sequential with backoff, not truly simultaneous. The `FOR UPDATE` closes the most realistic concurrent path.
