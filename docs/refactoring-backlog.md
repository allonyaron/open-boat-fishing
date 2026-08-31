# Refactoring Backlog

Captured before starting Step 11 / fishing-reports work. Goal: domain-driven structure, consistent patterns, cleaner boundaries between layers.

---

## 1. Domain-Driven Module Structure

**Problem:** Business logic is scattered across API route files. A route file for `/api/bookings` contains seat decrement logic, fee calculation, Stripe PI creation, and email dispatch all inline.

**Goal:** Extract domain modules under `src/lib/` (or `src/domain/`) so that routes become thin orchestration layers and the business logic is testable in isolation.

Candidate domains:
- `bookings` — create, cancel, expire, seat lock/restore
- `payments` — PI creation, fee calculation, Stripe interactions
- `notifications` — email + push dispatch (currently split across webhook, cron, and admin cancel)
- `reports` — create/update fishing report, photo upload coordination
- `operator` — already partially exists (`src/lib/operator.ts`); could absorb settings PATCH logic

**Approach:** Extract one domain at a time. Start with `bookings` since it's touched by the most routes (booking creation, cron expiry, webhook confirmation, admin cancel, refund).

---

## 2. Operator Resolution — Consolidate Access Pattern

**Problem:** Two helpers exist for reading `operator_id` from context:
- `getOperatorId(req: NextRequest)` — for API route handlers (reads `x-operator-id` request header)
- `getOperatorIdFromHeaders()` — for Server Components (calls `next/headers`)

Both are thin wrappers and work correctly, but callers have to know which to use based on their render context. Server component pages also repeat the pattern `operatorId ? await db.select(...).where(eq(operators.id, operatorId)) : []` in every file.

**Improvements:**
- Add `getOperatorOrThrow(req)` variant that throws a typed error instead of returning null, for routes where null is always a 500
- Add a server-component helper `getOperatorRecord()` that resolves the header + fetches the full operator row in one call, replacing the repeated pattern across 10+ pages

**Files affected:** `src/lib/operator.ts`, all 10 server-component pages that do the two-step resolve + fetch.

---

## 3. API Route Consistency — Operator Data Fetching

**Problem:** Routes that need full operator fields (not just the ID) each do their own `db.select().from(operators).where(eq(operators.id, operatorId))` with varying field selections. No shared type for "the fields a route typically needs."

**Improvements:**
- Define a shared `OperatorContext` type (the subset of operator fields most routes need: `id`, `name`, `emailFrom`, `emailDomain`, `stripeAccountId`, `feeBearer`, `feeDisplay`, `cancelWindowHrs`, `settleGraceHrs`)
- Helper: `getOperatorContext(req): Promise<OperatorContext | null>` — resolves ID from header, fetches the standard field set

---

## 4. Session Utilities — Reduce Duplication

**Problem:** `src/lib/session.ts` and `src/lib/platform-session.ts` are structurally identical (iron-session wrapper, session data type, `getSession()`, `requireX()` guard). If a third session type is added, it'll be a third copy.

**Improvement:** Extract a `makeSession<T>(cookieName, options)` factory in a shared `src/lib/session-factory.ts`. Both session modules become one-liners using the factory.

---

## 5. General Cleanup

- **`.env.local`:** `STRIPE_CONNECTED_ACCOUNT_ID` is still present but was removed from `env.ts` schema validation. Remove the stale line.
- **Dead env var in webhook:** `process.env.STRIPE_WEBHOOK_SECRET!` is still read directly instead of via `env.STRIPE_WEBHOOK_SECRET`. Standardize all env access through `env.*`.
- **`_req` rename artifacts:** A few files still have `_req` parameter names left over from before `getOperatorId` was added. Some were fixed; audit for stragglers.
- **`NEXT_PUBLIC_APP_URL`:** Used in the webhook (`process.env.NEXT_PUBLIC_APP_URL ?? ""`) but not in `env.ts`. Add it as optional or use a constant.

---

## 6. Middleware — Domain Lookup Caching (future, post-launch)

**Not urgent** — the Neon HTTP round-trip is ~5–10ms p99. But at scale (many requests, many operators), caching the `domain → operator_id` mapping in Vercel KV (or edge config) would eliminate the per-request DB hit.

**Design:** On cache miss, query `domains` table and write to KV with a TTL of ~5 min. On domain add/update (via platform admin), invalidate the KV key. Would require adding Vercel KV to the centralized deployment's infra.

**Prerequisite:** Platform admin panel (item 9) needs to exist and trigger invalidation on domain changes.

---

## Priority Order (suggested)

1. **Item 5 (cleanup)** — fastest, low risk, unblocks cleaner diffs going forward
2. **Item 4 (session factory)** — small refactor, pays off if more session types are added
3. **Item 3 (operator context helper)** — reduces boilerplate across API routes
4. **Item 2 (operator resolution consolidation)** — pairs with item 3
5. **Item 1 (domain modules)** — biggest lift; do after the helpers are stable
6. **Item 6 (middleware caching)** — post-launch only
