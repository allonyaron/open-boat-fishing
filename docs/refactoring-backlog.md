# Refactoring Backlog

Captured before starting Step 11 / fishing-reports work. Goal: domain-driven structure, consistent patterns, cleaner boundaries between layers.

---

## 1. Domain-Driven Module Structure

**Status: Partially done**

**Problem:** Business logic is scattered across API route files. A route file for `/api/bookings` contains seat decrement logic, fee calculation, Stripe PI creation, and email dispatch all inline.

**Goal:** Extract domain modules under `src/lib/` (or `src/domain/`) so that routes become thin orchestration layers and the business logic is testable in isolation.

**Done:**
- `src/lib/bookings/cancel.ts` — `cancelPendingBooking` + `cancelConfirmedBooking` (seat restore, ticket void, fee reverse). Used by cron, PI-canceled webhook, and charge-refunded webhook.
- `src/lib/webhooks/` — all four Stripe event handlers extracted from `route.ts` dispatcher
- `src/lib/notifications/send-confirmation-email.ts` — confirmation email assembly extracted
- `src/test/api/bookings.test.ts` — 24 integration tests covering `POST` (validation, operator/Stripe errors, seat inventory, happy path, near-full hold window, Stripe PI rollback) and `GET` (wallet lookup). Prerequisite for safe extraction.

**Remaining:**
- Booking creation is still inline in `POST /api/bookings` (490 lines, no other callers — low duplication value, high risk). Now has test coverage — safe to extract.
- `payments` domain (Stripe PI creation, per-ticket refund) — no duplication yet, defer
- `reports` domain — no duplication yet, defer

---

## 2. Operator Resolution — Consolidate Access Pattern ✅ Done

`getOperatorRecord()` added to `src/lib/operator.ts` — server-component variant of `getOperatorContext(req)`. Reads `x-operator-id` from `next/headers`, fetches the curated `OperatorContext` field set, returns `OperatorContext | null`. All 10 server-component pages migrated off the inline two-step pattern. `OperatorContext` expanded with `slug`, `phone`, `dockAddress`, `dockMapsUrl` to cover all display fields needed by those pages.

---

## 3. API Route Consistency — Operator Data Fetching ✅ Done

`OperatorContext` type defined in `src/lib/operator.ts` via `Pick<typeof operators.$inferSelect, ...>`. Standard field set: `id`, `name`, `emailFrom`, `emailDomain`, `stripeAccountId`, `stripeOnboardingComplete`, `termsUrl`, `feeBearer`, `feeDisplay`, `cancelWindowHrs`, `settleGraceHrs`.

`getOperatorContext(req)` replaces the per-route `getOperatorId + db.select` two-step in `POST /api/bookings` and `POST /api/auth/request`.

---

## 4. Session Utilities — Reduce Duplication ✅ Done

`makeSession<T>()` factory extracted to `src/lib/session-factory.ts`. Both `session.ts` (admin, 8h) and `platform-session.ts` (platform, 4h) are now one-liners that declare their data type and `isAuthorized` predicate. Also fixes `SESSION_SECRET` access from `process.env.!` to `env.SESSION_SECRET`.

---

## 5. General Cleanup ✅ Done

- `STRIPE_CONNECTED_ACCOUNT_ID` removed from `.env.local`
- `process.env.STRIPE_WEBHOOK_SECRET!` → `env.STRIPE_WEBHOOK_SECRET` (route.ts)
- `process.env.NEXT_PUBLIC_APP_URL` → `env.NEXT_PUBLIC_APP_URL` (notifications module); `NEXT_PUBLIC_APP_URL` added to `env.ts` as optional
- `_req` artifact audit — two remaining instances (`extend-hold`, `platform/auth DELETE`) are intentionally unused parameters, not artifacts

---

## 6. Middleware — Domain Lookup Caching (future, post-launch)

**Not urgent** — the Neon HTTP round-trip is ~5–10ms p99. But at scale (many requests, many operators), caching the `domain → operator_id` mapping in Vercel KV (or edge config) would eliminate the per-request DB hit.

**Design:** On cache miss, query `domains` table and write to KV with a TTL of ~5 min. On domain add/update (via platform admin), invalidate the KV key. Would require adding Vercel KV to the centralized deployment's infra.

**Prerequisite:** Platform admin panel (item 9 in centralized-architecture.md) needs to exist and trigger invalidation on domain changes.

---

## Priority Order (updated)

1. ~~**Item 5 (cleanup)**~~ ✅ Done
2. ~~**Item 4 (session factory)**~~ ✅ Done
3. ~~**Item 3 (operator context helper)**~~ ✅ Done
4. ~~**Item 2 (server-component operator helper)**~~ ✅ Done
5. **Item 1 (booking creation extraction)** — test coverage now in place; ready to extract when the time is right
6. **Item 6 (middleware caching)** — post-launch only
