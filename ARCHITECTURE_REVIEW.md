# Architecture and Security Review — 2026-11-16

Reviewer stance: senior architect + application-security engineer + the staff engineer who owns this after launch.
Review only; no source changes. Builds on `CODE_REVIEW.md` (passes 1–9) and `docs/architecture-review-findings.md`.
Findings with an existing ID are not repeated; where one is a symptom of a deeper design problem, the design problem
is reported here as a new `AR-n` finding and cites the IDs it explains.

Confidence: **CONFIRMED** (proven by running, tracing or a scratch test), **LIKELY** (strong code evidence),
**SUSPECTED** (needs a named check). Size: **S** ≤ 1 day, **M** 2–5 days, **L** 1–2 weeks.

Base: written against `main` at `63d6403` plus the calendar-spec fix. PR #47 (blocker 7, ticket lifecycle) merged
afterwards as `b6e9ae8`; the branch was re-pointed to that `main`. Section 5 ends with a post-#47 update; line numbers
in findings refer to the pre-#47 files unless the update says otherwise.

---

## 0. Progress

Started: 2026-11-16 21:58 EST
Deadline: 2026-11-16 23:58 EST
Finished: 2026-11-16 22:20 EST (all tiers; 20 findings AR-1..AR-20; not committed)

**Tier 1**
- [x] E — tenant resolution & operator isolation — done, 3 findings (AR-1..3), 0h04m elapsed (22:02)
- [x] A — booking creation — done, 2 findings (AR-4, AR-5), 0h06m elapsed (22:05)
- [x] B — Stripe webhook — done, 1 finding (AR-6), 0h09m elapsed (22:07)
- [x] C — cancellation / refunds — done, 1 finding (AR-7), 0h09m elapsed (22:07)
- [x] F — auth — done, 2 findings (AR-8, AR-9), 0h10m elapsed (22:08)
- [x] D — crons / fee lifecycle — done, 2 findings (AR-10, AR-11), 0h12m elapsed (22:10). Tier 1 complete.

**Tier 2**
- [x] H — admin API — done, 0 new findings (feeds X), 0h12m elapsed (22:11)
- [x] G — mate API — done, 0 new findings (feeds X), 0h13m elapsed (22:11)
- [x] J — schema / migrations — done, 1 finding (AR-12), 0h14m elapsed (22:12)
- [x] I — Stripe Connect — done, 0 new findings, 0h15m elapsed (22:13)
- [x] O — notifications / misc lib — done, 0 new findings (2 notes), 0h15m elapsed (22:13)
- [x] P — packages / CI — done, 2 findings (AR-13, AR-14), 0h17m elapsed (22:15). Tier 2 complete.

**Cross-cutting and summary**
- [x] X — cross-cutting pass — done, 4 findings (AR-15..18), 0h17m elapsed (22:15)
- [x] S — executive summary, target architecture, sequencing — done, 0h20m elapsed (22:18)

**Tier 3**
- [x] K — web booking UI — done, 1 finding (AR-19), 0h20m elapsed (22:18)
- [x] L — admin UI — done, 1 finding (AR-20), 0h21m elapsed (22:19)
- [x] M — mate app — done, 0 new findings (3 notes), 0h21m elapsed (22:19)
- [x] N — consumer app — done, 0 new findings (3 notes), 0h21m elapsed (22:19). Tier 3 complete.

---

## 1. Executive summary

Nine earlier passes found and fixed the individual bugs; the primitives (seat lock, PI compensation, webhook
lock-and-recheck, hand-written operator predicates) hold. This review looked for the designs that keep producing
those bugs. Ten, in the order they matter:

1. **Tenant isolation is a convention, not a property (AR-1, AR-2, AR-3).** 81 of 185 tenant-table statements carry
   no operator predicate; library modules take bare ids and trust the caller; the DB enforces nothing; three
   different places say which operator a request is for; and the centralized-mode branch of the middleware has
   never run under CI. It is safe today by inspection. It will not stay safe with a second developer or a second
   operator. Fix: RLS plus a tenant-bound transaction handle, one request context, one CI job without `OPERATOR_ID`.
2. **The Stripe boundary is not durable (AR-6).** Events are processed synchronously and acknowledged whatever
   happens; refunds are sent before anything is recorded. Every Stripe-side failure becomes a log line, and the
   log is the only reconciliation tool. This is the root of P3-4, P3-8, P3-9, P4-3 and the auto-refund gaps. Fix:
   an event inbox and a command outbox, which rows 9–11 of the blocker list should be built on.
3. **`seats_remaining` is a counter with six writers and three restore rules (AR-7).** That is why per-ticket
   refund, trip cancel and Dashboard refund over-restore when combined (P2-2, P4-2, P4-4, P4-7). Fix: one
   inventory module driven by ticket transitions, with a ledger; this is the shape blocker row 8 should take.
4. **Domain logic has no home (AR-15, AR-16).** Eight money or inventory flows are inline in routes, two of them
   twice; booking and trip status are written at thirteen sites with no transition table. PR #47's `lib/tickets`
   is the right pattern; the rest of the domain needs the same treatment, and the blocker order already walks
   through it.
5. **A seat hold and a booking are the same row (AR-4).** Four code paths race to cancel it and every reader must
   filter holds out. PR #47 makes the readers safe; the hold itself should become its own short-lived record after
   launch.
6. **"What happens at time T" has no owner (AR-10, AR-11).** The expiry cron and the in-request reclaim are
   drifted copies; settlement runs only when an admin opens a page; the reminder window misses 23 hours a day on
   Hobby. Fix: one `tick(now)` scheduler that is unit-testable with a clock.
7. **Nobody is anyone, and the pages can be framed (AR-8, AR-9).** Refunds, cancellations and settings changes
   record no actor; the platform console is a shared secret; and no security headers are sent, so the admin
   console can be clickjacked. Both are small fixes with large consequences after launch.
8. **There is no observability (AR-18).** Unstructured `console.*`, no error tracker, no request id, no alerts.
   Every "manual review required" in the code is a message to no one.
9. **Web and mobile share no API contract (AR-13).** `@openboat/types` is empty; the apps hand-type each other's
   JSON; there is no version signal. PR #47's column change is the first that will break installed apps silently.
10. **The schema describes a product that does not exist (AR-12).** Deposits, holiday pricing, customer passwords,
    fee bearers, cancel windows and trip overrides are columns with no code; several have already cost a finding.

**Tier 3 addendum (K, L, M, N reviewed after this summary was written):** no new Critical or High finding. Two Mediums: the checkout hold protocol lives inside a 678-line component and is duplicated in the mobile checkout (AR-19), and the admin console is client-rendered over 33 untyped `fetch` calls (AR-20). Both are instances of items 4 and 9 above.

Nothing here is a new launch blocker on its own once PR #47 lands; items 2, 3 and 7 should shape how blocker rows
8–12 are built so that work is not done twice.

---

## 2. Target architecture

**Layers, top down.** `app/api/**` route = parse (Zod from `packages/contracts`) → `RequestContext` (tenant,
principal, now) → `withTenant(tx)` → one domain command → `toResponse`. Server Components do the same without the
HTTP step. Nothing below the route layer imports `next/server`, `cookies()`, `process.env` or the global `db`.

**Domain modules under `apps/web/src/lib/`** (each exports commands `(ctx, tx, input) → Result | DomainError`
and queries; each owns its tables' writes):

| Module | Owns | Findings it absorbs |
|---|---|---|
| `tickets` (PR #47) | ticket status, fee status, `isLive`/`holdsSeat` predicates | P3-1 class, AR-16 pattern |
| `inventory` | `seats_remaining`, `capacity`, `capacity_changes` ledger, `seat_holds` (later) | AR-7, AR-4, P7-3, G2 |
| `booking` | holds, `priceCart`, pending→confirmed, reclaim/release, hold token | AR-4, AR-5, AR-10, P2-x |
| `cancellation` | `cancelTrip`, `refundTicket`, refund planning from live tickets | P4-x, C findings |
| `payments` | Stripe gateway (timeouts, idempotency), `stripe_events` inbox, `stripe_commands` outbox, `payments` read model | AR-6, P3-x, P4-3 |
| `schedules` | materialize, reconcile, `datesInRange` | P7-1, P7-2, P7-11 |
| `checkin` | `recordCheckIn` for mate and office | P6-3, P7-7, G1 |
| `scheduler` | `tick(now)`: expire, settle, earn, remind, purge, drain inbox | AR-11, P3-5, P3-7, P5-9 |
| `settings` | operator/vessel/product/staff writes with Zod and audit | P7-4, P7-5, P7-9, AR-9 |

**Cross-cutting libraries:** `lib/db/tenant` (`withTenant`, `withPlatform`, RLS policies in migrations; AR-1),
`lib/request-context` (AR-2), `lib/http` (`parseBody`, `DomainError`, `toResponse`; AR-17), `lib/tokens` (one
HMAC scheme, per-audience keys; P5-12), `lib/log` + error tracker + `operator_alerts` (AR-18), `lib/env` as the
only `process.env` reader, `audit_log` written by every command (AR-9).

**Shared packages:** `packages/db` (schema, migrations, RLS), `packages/contracts` (Zod request/response schemas
and the contract version; AR-13), `packages/utils` (cart model, money formatting; O1).

**Tenancy as a property:** the operator id enters once (middleware → `RequestContext`), is bound to the
transaction (`SET LOCAL app.operator_id`), and is enforced by Postgres. Crons, the webhook and the platform console
run under `withPlatform`. Single-deploy mode is the same code with `OPERATOR_ID` feeding the context; the CI matrix
runs both.

**Time as an input:** every command takes `now` from the context; the scheduler is the only place that reads the
wall clock in production, and tests pass a fixed clock.

**Stripe as an async peer:** the app records intent before calling Stripe (outbox) and records receipt before
acting on events (inbox); the read model (`payments`) is derived from both, and the Money page shows what is
unreconciled.

---

## 3. Findings

### Area E — tenant resolution & operator isolation

Reviewed: `apps/web/src/middleware.ts`, `lib/operator.ts`, `lib/env.ts`, `instrumentation.ts`, `lib/session-factory.ts`,
`lib/platform-session.ts`, `app/api/platform/*`, and a scripted sweep of every Drizzle statement on a tenant table in
`apps/web/src` (excluding tests). Sweep script: `$TMPDIR/scope-sweep.mjs` (regex over `.from|update|delete|insert(<tenantTable>)`,
checks the statement for an `operatorId` predicate).

#### AR-1 · High · Tenant isolation is a convention applied per statement; 44% of tenant-table statements carry no operator predicate, and the DB enforces nothing

- **Confidence:** CONFIRMED (sweep run on this base; three "by derivation" chains traced by hand and found safe today).
- **Locations:**
  - Sweep result: **185** statements on tenant tables, **81** without `operatorId` in the statement
    (`apps/web/src/lib/bookings/cancel.ts:50–130` has 11 statements and 0 predicates; `lib/webhooks/*` never resolves an
    operator at all; `lib/settle-trips.ts:53–66`; `lib/notifications/send-confirmation-email.ts:25–41`;
    `app/api/admin/trips/[tripId]/cancel/route.ts` 9 of 12; `app/api/account/bookings/route.ts:38,52`;
    `app/api/mate/manifest/route.ts:49–87`).
  - No RLS: `grep -li 'POLICY' packages/db/migrations/*.sql` is empty. The app connects as the table owner
    (`packages/db/src/index.ts:8`, plain `postgres(databaseUrl)`), so even an `ENABLE ROW LEVEL SECURITY` would not apply
    without `FORCE`.
  - No composite FKs tie a child's `operator_id` to its parent's (F1-10).
- **What's wrong:** The invariant in CLAUDE.md ("every query on a tenant table must include `eq(table.operatorId, …)`")
  is enforced by reading each statement. The library modules (`cancel.ts`, `settle-trips.ts`, webhooks, confirmation
  email) take a `bookingId`/`tripId` and trust that the caller scoped it. Isolation therefore depends on every *entry*
  point getting its first predicate right; once past it, nothing in the DB or the type system can catch a wrong row.
  The earlier P0 (`architecture-review-findings.md:98`, cross-operator booking via cart `tripId`) was exactly one missed
  entry predicate, and the DB accepted the corrupt rows. Nine review passes have kept it safe by inspection; that is the
  control, and it does not scale to a second developer or a second operator.
- **Failure scenario:** An admin route is added that resolves a booking by confirmation code and forgets the operator
  predicate (the shape of the fixed P1 wallet-lookup bug). It calls `cancelConfirmedBooking(bookingId)`. The library
  cancels another operator's booking, voids its tickets, restores its seats and reverses its fees, and returns 200. No
  constraint, policy or test fires. The same applies to `settleTrips`, `handleChargeRefunded` and
  `sendConfirmationEmail`.
- **Related existing IDs:** explains P2-10 (the whole "by derivation" class), F1-10, F1-13; is the design cause behind
  the fixed P0/P1 scoping bugs in `architecture-review-findings.md`.
- **Fix design (M):**
  1. **Tenant-bound DB handle.** `lib/db/tenant.ts`: `withTenant(operatorId, fn: (tx: TenantTx) => T)` opens a
     transaction and runs `SET LOCAL app.operator_id = $1` before `fn`. `TenantTx` is the Drizzle transaction type. A
     second handle `withPlatform(fn)` sets `SET LOCAL app.role = 'platform'` for crons, the Stripe webhook dispatcher and
     `/api/platform`. The postgres-js driver already runs real transactions, and `SET LOCAL` is pool-safe in
     transaction mode.
  2. **RLS migration (expand step, no code change needed first).** For each of the 19 tables with `operator_id`:
     `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` and one policy
     `USING (operator_id = current_setting('app.operator_id', true)::uuid OR current_setting('app.role', true) = 'platform')`.
     Tables without `operator_id` (`product_prices`, `operators`, `rate_limits`) get a policy through their parent or stay
     open. Ship it with the policy `PERMISSIVE` and a kill-switch GUC so it can be disabled without a migration.
  3. **Library signature change.** Every `lib/**` function that touches a tenant table takes `tx: TenantTx` as its first
     argument instead of importing `db`. That makes "which tenant" a compile-time requirement.
  4. **Route sweep (S, mechanical).** Routes call `withTenant(ctx.tenant.id, …)`; the remaining hand-written
     `eq(operatorId)` predicates stay as defense in depth.
  5. **One test** (`test/db/tenant-isolation.test.ts`): seed two operators, open a tenant handle for A, assert every
     tenant table returns zero of B's rows for `select`, `update … returning` and `delete … returning`.
  Migration steps: (a) policies with the GUC kill-switch, (b) `withTenant` + libs, (c) routes, (d) remove the kill-switch
  one deploy later.

#### AR-2 · Medium · "Which operator" has three sources (host header, admin session, bearer token), and each route picks one

- **Confidence:** CONFIRMED (counts from grep on this base).
- **Locations:** `lib/operator.ts:12` (`getOperatorId` reads the header; used by 14 API route files);
  `session.operatorId` from the iron-session cookie (21 admin route files); `customer.operatorId` / `mate.operatorId`
  from the HMAC token (2 files, and inside `lib/customer-auth.ts`, `lib/mate-auth.ts` where it is compared to the header
  only when the header is present).
- **What's wrong:** There is no single request context. Admin routes never compare the session's operator with the host
  (F1-8). Token routes compare only if the header exists (P5-10). Skipped middleware paths pass a client header through
  (F1-3). One admin page mixes session-scoped and header-scoped data (Pass 9, "Auth invariants"). Each of those is a
  symptom of the same missing abstraction: the identity of the tenant and the identity of the principal are resolved
  separately, in different modules, by whichever helper the route author reached for.
- **Failure scenario:** In centralized mode an admin of operator A signs in on `a.example`, then opens
  `b.example/admin/...`. Routes that read `session.operatorId` serve A's data under B's host and brand (F1-8); a page
  that reads `getOperatorRecord()` for the header and `session.operatorId` for the query shows B's name over A's trips.
  Add one more route that forgets either check and the two drift further.
- **Related existing IDs:** F1-8, P5-10, F1-3, P5-7, the push/register P1 in `architecture-review-findings.md:136`.
- **Fix design (M):** `lib/request-context.ts` exporting one function per route class:
  `publicContext(req)`, `customerContext(req)`, `mateContext(req)`, `adminContext(req)`, `platformContext(req)`,
  `cronContext(req)`, `stripeContext(req)`. Each returns `{ tenant: OperatorContext, principal }` or a typed error
  response, and the only place that compares `principal.operatorId` to `tenant.id` is inside these functions (a missing
  header is a mismatch, not a skip). Routes receive the context and never import `getOperatorId`, `getSession` or the
  token verifiers directly; a lint rule (`no-restricted-imports` on `@/lib/operator`, `@/lib/session`) in `app/api/**`
  enforces it. Pairs with AR-1: `adminContext` is what hands the operator ID to `withTenant`.

#### AR-3 · Medium · The centralized-mode tenant boundary has never run under a test, and the module can't be unit-tested as written

- **Confidence:** CONFIRMED.
- **Locations:** `apps/web/src/middleware.ts:6` (module-scope `neon(process.env.DATABASE_URL!)` at import);
  `.github/workflows/web-checks.yml:162–164` (CI exports `OPERATOR_ID`, so every CI run, the Playwright suite and the
  Vercel smoke test exercise only the single-deploy branch at line 29–31); `apps/web/src/test/` has no middleware or
  `operator.ts` test; route tests inject `x-operator-id` directly.
- **What's wrong:** Lines 33–46 (hostname parse, lowercase, `domains` lookup, 404 on miss, header overwrite) are the
  entire security boundary of platform mode and are dead code under every automated gate. The DB client is created at
  import from `process.env`, so the function cannot be exercised with a fake lookup. F1-1/F1-2/F1-3/P5-10 all sit on
  these lines, and their fixes (blocker row 20) will also land untested.
- **Failure scenario:** Row 20 ships the `/api/cron/` and `/api/webhooks/` exemptions. A typo in the `startsWith` list
  (`/api/webhook/`) passes CI and the smoke test, because neither runs without `OPERATOR_ID`. The first centralized
  deploy 404s every Stripe webhook (F1-1 again), and confirmations silently stop.
- **Related existing IDs:** F1-1, F1-2, F1-3, P5-10, P9-1 (gates), P3 "middleware caching".
- **Fix design (S):** Split `middleware.ts` into `resolveTenant(hostname, lookup: (host) => Promise<string|null>)` (pure,
  in `lib/tenant/resolve.ts`, returns `{ operatorId } | { status: 404 }`) and a five-line Next middleware that supplies the
  Neon lookup. Unit-test `resolveTenant` with a map lookup for: uppercase host, port suffix, unknown host, skipped paths
  strip the inbound header, `OPERATOR_ID` precedence. Add one CI job that starts the app **without** `OPERATOR_ID`, with
  a seeded `domains` row for `localhost`, and runs the booking Playwright spec plus a webhook and cron request. The
  lookup cache (backlog item 6) then has a seam to live in.


### Area A — booking creation

Reviewed: `app/api/bookings/route.ts` (401 lines), `lib/bookings/{cart,price-book,price-cart,hold-token,release,
reclaim-expired-holds,cancel,contact}.ts`, `app/api/bookings/[bookingId]/{extend-hold,contact,release}`,
`app/api/bookings/quote`, `lib/stripe.ts`. Also read the `fix/b7-ticket-lifecycle` branch (PR #47) to avoid contradicting it.

What's clean (verified): trips are locked in id order (`route.ts:112–117`), pricing and seat decrement happen under
the locks with no external call inside the transaction, the PI is created after commit and compensated through
`cancelPendingBooking` on failure, `reclaimExpiredHolds` commits on its own before the booking transaction and uses
`SKIP LOCKED` to avoid inverting `cancelPendingBooking`'s lock order, the hold token has its own `aud`, and the cart
schema rejects duplicate trips. The 4b/18 work (reclaim, release, quote, `priceCart`) is well-factored.

#### AR-4 · Medium · A seat hold and a booking are the same row, so four code paths race to cancel it and every reader has to know which "pending" rows are real

- **Confidence:** CONFIRMED (traced; four cancel paths listed below exist on this base).
- **Locations:**
  - `route.ts:150–199`: one POST inserts `bookings` (with confirmation code, PII, terms acceptance), `booking_items`
    and `tickets` before any payment exists; the hold is `bookings.status='pending'` + `holdExpiresAt`.
  - Four independent cancellers of that row, each with its own Stripe-then-DB ordering:
    `lib/bookings/reclaim-expired-holds.ts:48–79` (inside another customer's checkout request, up to 20 bookings × 2
    Stripe calls), `lib/bookings/release.ts:47–70` (customer leaves), `app/api/cron/expire-pending-bookings` (cron),
    and `lib/webhooks/payment-intent-canceled` (Stripe). They coordinate through `SKIP LOCKED`, status re-checks and
    the `cancellation_reason` string on the PI.
  - Every reader of bookings/tickets must filter out holds: this is the P3-1/P7-7/P9-4 class, which PR #47 closes by
    giving tickets a `held` status and a `lib/tickets` module.
- **What's wrong:** The hold is an inventory concept with a TTL and a cart snapshot. The booking is a commercial record
  that should exist once money has moved. Modelling the hold as a pending booking means the commercial tables carry
  rows that may never become real, the confirmation code and customer PII exist before payment (part of P8-1), and
  "cancel a hold" is a multi-party protocol instead of a `DELETE … WHERE expires_at < now()`. PR #47 makes the readers
  safe (tickets become `live` only at `payment_intent.succeeded`), which is the right first step; it does not reduce
  the number of cancellers or the Stripe round-trips in the checkout path.
- **Failure scenario:** Two customers book the same near-full trip within a minute of a third customer's hold expiring.
  Both POSTs run `reclaimExpiredHolds` for the same expired booking: both retrieve the PI, one cancels it, the other's
  cancel returns an error (`release.ts:33–36` → `"error"`), so that request skips the booking and sees one seat fewer.
  It gets a 409 "Not enough seats" although the seat was freed a moment later by the first request. Rare, self-healing,
  and only possible because reclaim is a per-request side job rather than a property of the hold.
- **Related existing IDs:** explains P3-1 (root), P2-3, P3-5 items 1–3, P3-10, P4-1 (pending bookings on a cancelled
  trip), P8-1 item 2, P9-4, P7-7; cross-cutting problem 1 in CODE_REVIEW.md.
- **Fix design (L, after PR #47 lands; not a launch blocker once #47 is in):**
  1. `seat_holds` table: `id, operator_id, trip_id, seats, cart jsonb, contact jsonb, hold_token_hash, stripe_payment_intent_id,
     expires_at, created_at`, unique `(stripe_payment_intent_id)`. Inventory module `lib/inventory`:
     `holdSeats(tx, requests, ttl)` (locks trips in id order, decrements, inserts holds) and `releaseHold(tx, holdId)`
     (conditional delete + SQL-arithmetic restore). Expired holds are released by one query, `DELETE … RETURNING`, run by
     the cron and lazily by `holdSeats` under the same trip locks: no Stripe call needed, because a PI whose hold is
     gone is refused at `payment_intent.succeeded` (auto-refund, which P3-4's design already requires).
  2. `payment_intent.succeeded` becomes the only creator of `bookings`, `booking_items` and `tickets`, from the hold's
     cart snapshot, inside one transaction with the hold delete. The ticket module from #47 then has one entry
     (`held` disappears; tickets are born `live`).
  3. The checkout contract (`clientSecret`, `holdToken`, `holdExpiresAt`) is unchanged; `bookingId` in the POST response
     becomes `holdId`, and `confirmationCode` moves to the success response (closes the P8-1 "code before payment" half).
  4. Migration: expand (`seat_holds`, keep `bookings.status='pending'` readable), switch writers, contract (drop
     `hold_expires_at`, `pending` status) one deploy later.

#### AR-5 · Low · The PaymentIntent is created without an idempotency key, and its id is attached to the booking in a separate statement

- **Confidence:** LIKELY (code; not reproduced against Stripe).
- **Locations:** `app/api/bookings/route.ts:216–228` (no `idempotencyKey`), `:235–238` (PI id written after creation,
  outside any transaction), `lib/stripe.ts:3–5` (no `maxNetworkRetries` set; stripe-node 22 defaults to 1 retry with
  an auto-generated key, which covers only the SDK's own retry).
- **What's wrong:** Between the `create` returning and the `update` at line 235 there is no durable link from booking
  to PI. If the function is frozen or the update fails, the booking is pending with `stripePaymentIntentId = null`;
  the cron and reclaim then treat it as "no PI" and cancel it cleanly, but the PI stays open at Stripe with
  `requires_payment_method` forever. If the route is retried by the client after a timeout, a second booking is created
  (handled by `replaces`), so the real cost is orphan PIs and an audit trail that cannot answer "which PI belonged to
  this booking".
- **Failure scenario:** Neon hiccups on the line-235 update. The customer sees a 500 and retries; the retry replaces
  the first booking. Stripe now has an uncancelled PI with metadata pointing at a cancelled booking. Months later the
  operator reconciles Stripe to the app and finds PIs with no booking.
- **Related existing IDs:** the App ↔ Stripe boundary in CODE_REVIEW.md "Architecture Assessment" (P4-3, P3-4, P3-5).
- **Fix design (S):** pass `{ idempotencyKey: \`pi:${booking.id}\` }` so a retry for the same booking returns the same
  PI; write the booking row's PI id inside the booking transaction by generating the PI *first* with the amount from a
  prior `priceCart` quote and `capture_method: "automatic"`, or keep the order and make the post-create update a
  conditional `UPDATE … WHERE stripe_payment_intent_id IS NULL`, cancelling the PI if zero rows changed. Record the
  intent in `payments` at creation (status `created`) so reconciliation has a row before Stripe does.


### Area B — Stripe webhook

Reviewed: `app/api/webhooks/stripe/route.ts`, `lib/webhooks/{payment-intent-succeeded,payment-intent-canceled,
charge-refunded,charge-dispute-created}.ts`, `lib/bookings/get-confirmed-booking.ts`, `payments` schema.

What's clean (verified): raw body + `constructEvent` before any read (`route.ts:17–30`); `payment_intent.succeeded`
locks the booking row and re-checks status (`payment-intent-succeeded.ts:35–50`); the charge retrieve happens outside
the transaction; the cancelled-then-paid branch auto-refunds with `reverse_transfer` and `refund_application_fee`
(`:85–96`); `payment_intent.canceled` is routed through `cancelPendingBooking` and reads `cancellation_reason` to pick
the push; `charge.dispute.created` is now one transaction with a conditional void. Email, push and PostHog are behind
`waitUntil`.

#### AR-6 · High · Stripe events are processed synchronously and non-durably: there is no inbox for events and no outbox for commands, so every Stripe-side failure becomes a log line

- **Confidence:** CONFIRMED (code; the failure branches are all `console.error` + return/200).
- **Locations:**
  - `route.ts:48–58`: an if-chain dispatch; every handler path ends in `return NextResponse.json({ ok: true })`
    regardless of what happened inside. Unknown event types are dropped with no record.
  - `payment-intent-succeeded.ts:24–30` (charge retrieve fails → fee/transfer ids stored as null forever),
    `:85–96` (auto-refund fails → logged, never retried, no row anywhere), `charge-refunded.ts:38–46` (fee reversal
    fails → logged), `charge-dispute-created.ts:47–49` ("Manual review required" to stdout).
  - No `stripe_events` table; `grep -rn 'event.id' lib/webhooks app/api/webhooks` finds no persistence of the event id.
  - Outbound: `stripe.refunds.create` in `admin/trips/[tripId]/cancel/route.ts:93–95` and
    `admin/tickets/[ticketId]/refund/route.ts:48–65` run before any DB write, with a 24-hour idempotency key as the only
    retry safety (P4-3); `payments` is written only at success (`payment-intent-succeeded.ts:67–78`) and never updated
    afterwards (`payments.status` is `pi.status` at that moment and stays "succeeded" through refund and dispute).
- **What's wrong:** The handler does three things in one request: verify, decide, and perform side effects that call
  Stripe again. When the side effect fails, the decision is lost (200 returned, Stripe will not resend), and the only
  trace is a Vercel log line that expires. Ordering is whatever Stripe delivers (P3-8). The same shape applies in the
  other direction: refunds are issued with nothing recorded before the call, so a crash between Stripe and the DB
  leaves money moved and state unchanged (P4-3, P4-4). CODE_REVIEW.md's "App ↔ Stripe" boundary note names the
  symptom; the design cause is that neither direction has a durable record of intent.
- **Failure scenario:** Stripe delivers `payment_intent.succeeded` for a booking the cron just cancelled.
  `stripe.refunds.create` at `:87` times out (Stripe degraded for 30 s). The handler logs and returns 200. The customer
  is charged, has no booking, and nobody is told. Reconciliation requires someone to grep Vercel logs within the
  retention window.
- **Related existing IDs:** explains P3-4, P3-8, P3-9, P4-3, P3-5 item 2 (no reconciliation), the P3 "no webhook
  idempotency table" item, and the auto-refund part of blocker row 9. F1-1 (webhook availability) becomes less critical
  once events are durable, because a replay from Stripe's dashboard then re-drives the same inbox.
- **Fix design (M):**
  1. **Inbox.** `stripe_events(id text PK, type, account, created timestamptz, payload jsonb, received_at, processed_at,
     attempts int, last_error text)`. The route verifies the signature, `INSERT … ON CONFLICT (id) DO NOTHING`, and
     returns 200 (duplicate deliveries stop here; closes the idempotency-table item). Processing runs in the same
     request under `waitUntil` and is also driven by a cron (`/api/cron/process-stripe-events`, every 10 min on Pro)
     that picks `processed_at IS NULL` rows ordered by `created`, with `FOR UPDATE SKIP LOCKED`. A handler that throws
     leaves the row unprocessed with `last_error`, and the admin Money page lists rows with `attempts > 3` ("needs
     review", closes P3-9). Ordering problems (P3-8) are handled by processing in `created` order and by making
     handlers tolerant of "already in a later state" (the ticket transition table from PR #47 gives that for free).
  2. **Outbox / ledger for commands.** `stripe_commands(id uuid PK, operator_id, kind enum(refund, fee_refund,
     pi_cancel, transfer_reversal), target_id, params jsonb, idempotency_key, status enum(pending, sent, confirmed,
     failed), stripe_object_id, error, created_at, sent_at)`. Every refund path writes the row in the same transaction
     as the DB state change (ticket → refunded, seats restored), then sends. `idempotency_key = id`, so a retry sends
     the same params; `confirmed` is set when the matching `charge.refunded` arrives through the inbox. This is the
     P4-3 refund ledger generalised, and it is what blocker rows 9–11 should build on rather than three separate
     ledgers.
  3. `payments` becomes the read model updated by inbox handlers (`refunded_cents`, `disputed`, `dispute_status`).
  4. Tests: one per event type replays the fixture twice and out of order and asserts the end state; one test kills
     the Stripe mock mid-handler and asserts the inbox row holds the error and the cron completes it.


### Area C — cancellation / refunds

Reviewed: `lib/bookings/cancel.ts`, `app/api/admin/trips/[tripId]/cancel/route.ts`, `app/api/admin/tickets/[ticketId]/refund/route.ts`.

What's clean (verified): both `cancel*Booking` functions lock the booking and re-check status; ticket refund is
operator-scoped on the ticket; trip cancel reads `capacity` live inside the transaction (`:150–153`); refunds carry
idempotency keys and `reverse_transfer`.

#### AR-7 · High · `trips.seats_remaining` is a denormalized counter with six writers and three different restore rules, and no ledger

- **Confidence:** CONFIRMED (writers enumerated below; PR #47 adds `seatHoldingTicketCount`, which computes the
  truth the counter is supposed to track).
- **Locations (writers):**
  1. `app/api/bookings/route.ts:129–133` decrement by requested seats.
  2. `lib/bookings/cancel.ts:63–75` (`cancelPendingBooking`) restore = count of *all* tickets per item.
  3. `lib/bookings/cancel.ts:107–119` (`cancelConfirmedBooking`) same rule, including already-voided tickets.
  4. `app/api/admin/tickets/[ticketId]/refund/route.ts:81–84` restore `+1`, unconditional.
  5. `app/api/admin/trips/[tripId]/cancel/route.ts:150–153` reset to `capacity`.
  6. `app/api/mate/trips/[tripId]/capacity` and `app/api/admin/trips/[tripId]` PATCH (P7-3): set capacity and clamp
     `seats_remaining` with `GREATEST`.
  No reader can tell whether `seats_remaining` is right; `capacity_changes` audits only writer 6 (mate path).
- **What's wrong:** Three incompatible notions of "how many seats a cancellation returns" (all tickets, one ticket,
  everything) are each correct for their own path and wrong when paths combine: per-ticket refund then trip cancel
  (P4-2), per-ticket refund then Dashboard refund (`cancelConfirmedBooking` restores the refunded ticket again,
  P2-2(b)), cancel on an already-cancelled trip (P4-7). Every one of those is a consequence of the counter being
  adjusted by the *caller's* guess instead of by the ticket's transition. Blocker row 8 proposes
  `releaseBookingInventory` in the ticket module, which is the right place; this finding is about what that module
  should own.
- **Failure scenario:** Admin refunds one ticket of a party of three (seat +1). A week later the customer disputes the
  remaining charge and loses; Stripe sends `charge.refunded` for the rest; `cancelConfirmedBooking` counts three tickets
  and restores +3. The trip now shows capacity +1 and sells a seat that does not exist. The `seats_remaining <= capacity`
  CHECK in row 8 would turn that into a 500 on the webhook, which is why P4-7 says the helper must land first.
- **Related existing IDs:** P2-2(b), P3-12, P4-2, P4-4, P4-7, P7-3 (clamp hides drift), F1-12; blocker row 8.
- **Fix design (M, replaces the inventory half of row 8):**
  1. `lib/inventory/seats.ts` is the only module that writes `seats_remaining`:
     `takeSeats(tx, tripId, n)`, `giveBackSeats(tx, tripId, n, reason)`, and `recount(tx, tripId)` which sets
     `seats_remaining = capacity - seatHoldingTicketCount` under the trip lock. Every write inserts a `capacity_changes`
     row (extend the table with `delta`, `reason enum(hold, release, refund, trip_cancel, capacity_edit, recount)`,
     `ticket_id?`, `booking_id?`), so the counter has a ledger and `sum(delta)` can be checked against it.
  2. Seat give-backs are driven only by `moveTickets` results: the ticket module calls `giveBackSeats` with
     `moved.length` for transitions that leave a seat (`held→voided`, `live→refunded`), and never for `live→disputed`
     or on a trip whose status is `cancelled` (P4-7). Callers stop computing counts.
  3. Trip cancel does not reset to capacity; it moves every ticket and lets step 2 restore, then `recount`.
  4. A nightly cron runs `recount` for upcoming trips and alerts on drift (the `GREATEST` clamp in P7-3 goes away).
  5. Add `CHECK (seats_remaining BETWEEN 0 AND capacity)` last, as row 8 already says.


### Area F — auth

Reviewed: `lib/session-factory.ts`, `lib/session.ts`, `lib/platform-session.ts`, `lib/customer-auth.ts`, `lib/mate-auth.ts`,
`lib/bookings/hold-token.ts`, `lib/rate-limit.ts`, `app/api/auth/{request,verify}`, `app/api/admin/auth/login`,
`app/api/mate/auth`, `app/api/platform/auth`, `next.config.mjs`.

What's clean (verified): audiences are checked on every verify; staff lookups are operator-scoped; every auth route
rate-limits before DB access; `clientIp` prefers `x-real-ip` and the rightmost XFF hop; old OTPs are invalidated on
request; the admin cookie is `httpOnly`, `sameSite: lax`, `secure` in production; the platform secret route is
rate-limited.

#### AR-8 · Medium · The web app sets no security headers: no CSP, no `frame-ancestors`, no HSTS, no `Referrer-Policy`

- **Confidence:** CONFIRMED (`next.config.mjs` has no `headers()`; `vercel.json` has none; grep for
  `content-security-policy|frame-ancestors|access-control-allow` across `src` and config is empty).
- **Locations:** `apps/web/next.config.mjs:1–14`, `apps/web/vercel.json`.
- **What's wrong:** The admin console (`/admin/**`) and the platform console (`/platform`) are cookie-authenticated with
  `SameSite=Lax`. Lax blocks cross-site POSTs, so CSRF on the JSON mutation routes is covered. It does not cover
  clickjacking: any site can frame `/admin/today` and overlay the one-click "Refund" and "Cancel trip" buttons, because
  no `X-Frame-Options`/`frame-ancestors` is sent. There is no CSP, so a stored XSS anywhere (P3-11's unescaped email
  is the server side; fishing-report titles and operator settings render on public pages) runs with the admin's
  cookie. The boarding-pass and confirmation pages carry QR payloads (bearer credentials) and send a full `Referer` to
  any outbound link (`dockMapsUrl`, `termsUrl`, both operator-supplied: P8-13).
- **Failure scenario:** A phishing page frames `https://<operator>/admin/today` at 1% opacity over a "Claim your
  prize" button positioned on a passenger row's Refund control. A signed-in admin clicks; the refund route runs with
  their cookie.
- **Related existing IDs:** P3-11, P8-13, P9-12 (PostHog replay), P5-11 (login hardening).
- **Fix design (S):** `headers()` in `next.config.mjs` for `/(.*)`: `Content-Security-Policy` with
  `default-src 'self'; script-src 'self' 'nonce-…' https://js.stripe.com https://*.posthog.com; frame-src https://js.stripe.com
  https://hooks.stripe.com; img-src 'self' data: blob: https://*.public.blob.vercel-storage.com; connect-src 'self'
  https://api.stripe.com https://*.posthog.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), geolocation=()`.
  Use a per-request nonce from middleware (`x-nonce` header) for the inline PostHog/Stripe bootstraps. Start in
  `Content-Security-Policy-Report-Only` for one preview cycle; the Playwright suites catch any blocked resource.
  `Cross-Origin-Opener-Policy: same-origin` on `/admin` and `/platform`.

#### AR-9 · Medium · Money and inventory mutations record no actor: refunds, trip cancellations, capacity edits (admin path) and settings changes have no "who"

- **Confidence:** CONFIRMED (grep for `staffId: session` across `src/app/api` hits only `checkins` and `report`
  writes; `capacity_changes.staff_id` is written only by the mate capacity route).
- **Locations:** `app/api/admin/tickets/[ticketId]/refund/route.ts:75–85`, `app/api/admin/trips/[tripId]/cancel/route.ts:116–154`,
  `app/api/admin/trips/[tripId]/route.ts` (capacity PATCH), `app/api/admin/settings/**` (operator, vessels, products,
  staff), `app/api/platform/*` (platform admin is a shared secret with no identity at all:
  `platform-session.ts:3–5` stores only `authenticated: true`).
- **What's wrong:** The session knows `staffId`; the writes discard it. After launch the first "who refunded this and
  why" question has no answer. P5-1 (deactivated admins keep access for 14 days) and P7-6 (last admin can be
  deactivated, credential changes don't end sessions) are the access-control half of the same gap: there is no
  per-principal accounting, so neither revocation nor attribution is possible. The platform console can create
  operators and rotate their Stripe account (P5-5) as "someone with the secret".
- **Failure scenario:** Two admins share the office PC. One issues 30 refunds over a month. The operator notices a
  revenue gap; Stripe shows the refunds with `metadata.reason: admin_ticket_refund` and nothing else. The platform
  cannot say which staff session did it.
- **Related existing IDs:** P5-1, P7-6, P5-5, P7-10 ("Clear demo customers" deletes paid bookings with no record).
- **Fix design (M):** Make the acting principal a required argument of every domain command (it is already in the
  request context from AR-2): `cancelTrip(ctx, …)`, `refundTicket(ctx, …)`, `setTripCapacity(ctx, …)`. Each command
  writes an `audit_log(id, operator_id, actor_kind enum(staff, platform, customer, system, stripe), actor_id, action,
  target_table, target_id, before jsonb, after jsonb, reason, request_id, created_at)` row inside its transaction. Give
  the platform console named accounts (`platform_users` with email + password, same `staff` auth path) so `actor_id`
  is real; keep `PLATFORM_SECRET` only as the bootstrap for the first account. The Money page's refund list reads the
  audit rows. The Stripe `metadata` on refunds gets `actor_id` too, so Stripe and the DB agree.


### Area D — crons / fee lifecycle

Reviewed: `lib/cron-auth.ts`, `app/api/cron/{expire-pending-bookings,trip-reminders,reset-demo-data}`, `lib/settle-trips.ts`,
`lib/demo-reset.ts` (via its caller), `vercel.json`, and the three `settleTrips` call sites.

What's clean (verified): `verifyCronAuth` is timing-safe and shared by all three crons; the expiry cron skips
succeeded/processing PIs, uses `cancelPendingBooking`'s lock, has `maxDuration` and a batch limit; reminders are one
joined query with per-trip email de-duplication; the demo reset is operator-scoped and double-gated.

#### AR-10 · Medium · The expiry cron and `reclaimExpiredHolds` are two copies of the same algorithm, and they have already drifted

- **Confidence:** CONFIRMED (side-by-side read).
- **Locations:** `app/api/cron/expire-pending-bookings/route.ts:34–114` vs `lib/bookings/reclaim-expired-holds.ts:88–156`
  and `lib/bookings/release.ts:21–37`.
- **What's wrong:** Both select pending bookings with no `payments` row and a passed `holdExpiresAt`, retrieve the PI,
  skip if paid, cancel the PI, then `cancelPendingBooking`, then push. Differences that are already bugs or
  inconsistencies:
  1. On a Stripe error the cron **proceeds** to cancel the booking (`route.ts:88–94`, "Non-fatal: proceed with seat
     restoration regardless"); reclaim **excludes** that booking (`release.ts:33–36` → `"error"`,
     `reclaim-expired-holds.ts:147`). P3-5 item 3 flagged the cron's behaviour; the newer module got it right and the
     cron was not updated.
  2. The cron has the legacy `holdExpiresAt IS NULL` branch (`route.ts:48–53`); reclaim does not.
  3. The cron sends the push itself (`route.ts:109`); reclaim does too; the `payment_intent.canceled` webhook does
     too when it wins the race. Three senders of one notification, coordinated by the PI's `cancellation_reason`.
  4. The cron has no `ORDER BY`, so with more than 50 paid-but-unconfirmed holds it returns the same rows forever
     (P3-5 item 1); reclaim is bounded per trip set and does not have this problem.
- **Failure scenario:** Stripe returns 500s for a minute during the 02:00 cron. The cron cancels 50 bookings whose PIs
  are still open. A customer who had the checkout open pays at 02:01; `payment_intent.succeeded` finds the booking
  cancelled and auto-refunds (AR-6 covers what happens if *that* fails). The same minute, a customer booking the same
  trip triggers reclaim, which correctly leaves those bookings alone. Which outcome a customer gets depends on which
  path ran first.
- **Related existing IDs:** P3-5, P3-12 (same shape: two cancel paths), P2-3 (where reclaim came from), M10.
- **Fix design (S):** Delete the cron's loop. The cron calls `reclaimExpiredHolds` once per operator with
  `tripIds = undefined` (meaning "every trip with an expired hold"), ordered by `holdExpiresAt`, with the batch limit
  it already has. The cron keeps only: auth, the operator loop, the `rate_limits` purge (until AR-11 moves it), and
  the summary response. Drop the legacy branch after confirming `SELECT count(*) FROM bookings WHERE status='pending'
  AND hold_expires_at IS NULL` is 0 in production. One test: cron and reclaim given the same fixture produce the same
  cancellations and the same single push.

#### AR-11 · Medium · Time-driven state transitions are spread across two crons, three page-render hooks and per-request work, with a cadence that differs by plan and environment

- **Confidence:** CONFIRMED.
- **Locations:**
  - Hold expiry: cron (`0 2 * * *` on Hobby, `vercel.json:4`), plus `reclaimExpiredHolds` in every booking POST.
  - Trip `scheduled → pending_settlement → sailed` and fee `held → earned`: only when an admin loads Today, Revenue or
    Pending reports (`lib/settle-trips.ts`, called from `admin/today/route.ts:34`, `admin/revenue/route.ts:16`,
    `admin/reports/pending/route.ts:21`). Step 1 runs outside the transaction of step 2.
  - Reminders: cron at `0 9 * * *` with a `[+23h, +24h)` window (`trip-reminders/route.ts:18–20`), so on Hobby it fires
    only for trips departing between 08:00 and 09:00 UTC the next day. The departure time is formatted without
    `timeZone` (`:71–75`, P3-7 still open).
  - `rate_limits` purge: inside the expiry cron (`expire-pending-bookings/route.ts:117`). OTP purge: nowhere (P5-9).
  - Demo reset: documented as nightly, not registered (`vercel.json` has two entries).
- **What's wrong:** "What happens at time T" has no single owner. Whether a trip is `sailed`, whether its fees are
  `earned`, whether a hold is released, depends on who looked at which page and which plan the deployment is on. An
  operator who doesn't open the admin for a week has trips `scheduled` a week after departure; the reminder window
  silently misses 23 of 24 hours on Hobby. None of it is testable with a fake clock, because each transition is
  inlined in a route handler.
- **Failure scenario:** On Hobby, a trip departs 14:00 ET. The 09:00 UTC reminder run sees departures in
  [08:00, 09:00) UTC tomorrow and sends nothing. Customers get no reminder, and the revenue page shows the fee `held`
  until an admin visits.
- **Related existing IDs:** P3-5, P3-7, P5-9, the P3 "rate-limit cleanup coupled to the booking-expiry cron" item,
  the "earned never transitions" tech-debt note in CLAUDE.md, cross-cutting problem 9 (ET date math).
- **Fix design (M):** `lib/scheduler/tick.ts` exporting `tick(now: Date, scope?: { operatorId })` that runs, in order,
  each transition as a pure "find rows whose time predicate is due → conditional UPDATE from→to": `expireHolds`
  (AR-10's reclaim), `settleTrips` (both steps in one transaction, all operators), `earnFees`, `sendReminders` (window
  computed from the last successful tick, stored in a `scheduler_runs(name, last_run_at)` row, so a missed run catches
  up instead of skipping), `purgeRateLimits`, `purgeOtps`, `processStripeInbox` (AR-6). One cron path,
  `/api/cron/tick`, every 10 minutes on Pro; the page-render hooks call `tick(now, { operatorId })` for the same
  function so behaviour is identical, and every transition is unit-tested by calling `tick` with a controlled clock.
  `reset-demo-data` stays separate (destructive, demo-only) and gets registered.


### Area H — admin API

Reviewed: `lib/trip-materialization.ts`, `app/api/admin/settings/schedules/{route,[scheduleId]/route}.ts`,
`app/api/admin/trips/[tripId]/route.ts`, `app/api/admin/settings/operator/route.ts`,
`app/api/admin/settings/staff/[staffId]/route.ts`; file list and sizes for the rest (22 route files, 2,023 lines).

What's clean (verified): every admin route starts with `requireAdmin`; parent lookups are operator-scoped; the trip
capacity PATCH now locks the row and uses SQL arithmetic (the earlier P1 race is fixed); the staff UPDATE now carries
the operator predicate (the P3 defense-in-depth item is fixed); `onConflictDoNothing` on `(schedule_id,
departure_date)` prevents duplicate trips.

No new design findings beyond what Pass 7 recorded and what the cross-cutting pass (X) covers. Specifics that feed X:
- **Validation style.** Admin routes parse `req.json()` into `Record<string, unknown>` and validate by hand
  (`schedules/route.ts:63–88`, `[scheduleId]/route.ts:40–74`, `operator/route.ts:26–71`), then `.set(patch as any)` with
  an `eslint-disable` (`operator/route.ts:75–76`, `staff/[staffId]/route.ts:64–65`). The public booking API uses Zod
  end to end. Phase 1's "one Zod schema per route" is the right fix; X records the pattern.
- **Error shape.** Admin trip PATCH throws `{ status }` (`trips/[tripId]/route.ts:148–150,163–166`); the booking
  domain throws `{ httpStatus }` (`lib/bookings/cart.ts`). Two conventions for the same idea.
- **Materialization.** `datesInRange` and `etWallClockToUTC` are pure and in `lib/`, but the row-building loop and the
  "today" computation (`[scheduleId]/route.ts:87`, UTC) are inline and copied (P7-11). The schedule PATCH is still
  not a transaction (`:92–155`): the pattern is saved, then trips are diffed and deleted/inserted in separate
  statements (P7-2).
- **Ticket liveness in admin counts** still reads `voided = false` (`[scheduleId]/route.ts:115–120`,
  `trips/[tripId]/route.ts:156–160`), which PR #47 replaces with `isLive`.


### Area G — mate API

Reviewed: `app/api/mate/manifest/route.ts`, `app/api/mate/checkins/route.ts`, `app/api/mate/trips/[tripId]/capacity/route.ts`.

What's clean (verified): every route starts with `requireMate`; the trip and ticket lookups are operator-scoped; the
capacity PATCH locks the trip, enforces the certificate cap and writes a `capacity_changes` row with the acting
mate; check-in inserts are `onConflictDoNothing`.

No new design findings beyond Pass 6 and the cross-cutting pass. Specifics that feed X:
- **Two check-in paths, one rule set missing.** `mate/checkins/route.ts:34–82` and
  `admin/trips/[tripId]/checkins/route.ts` each decide what a valid check-in is (P7-7: the office path accepts unpaid
  bookings; the mate path checks `voided` only; neither checks `bookings.status`; PR #47 moves both to `isLive`).
  The brief's `check-in` module boundary is `lib/checkin/recordCheckIn(ctx, { ticketId, tripId, method, at }) →
  { ok } | { alreadyCheckedIn } | { rejected: reason }`, shared by both routes and by the mate client's
  `resolveScan` (blocker 16).
- **Client-supplied facts trusted.** `checkedInAt` (`:74`) is taken from the device clock with no bound; `tripId` in
  the event is used as a filter rather than derived from the ticket (`:49`), so a wrong `tripId` yields
  `ticket_not_found` rather than a clear "ticket is for another trip".
- **Manifest shape.** The manifest route assembles bookings → items → tickets → check-ins in memory with four
  queries and nested `filter`/`some` loops (`:93–113`, O(bookings × items × tickets)); fine at party-boat scale,
  but it is the same four-query assembly as `admin/trips/[tripId]/route.ts:40–93` (P7-11 class).


### Area J — schema / migrations

Reviewed: `packages/db/src/schema.ts` (constraints, indexes, enums, FKs), `packages/db/src/index.ts`,
`drizzle.config.ts`, migrations `0000`–`0015` (last three in full), `vercel.json` build command.

What's clean (verified): every tenant child table carries `operator_id` (good for AR-1's RLS); `(schedule_id,
departure_date)` unique; `confirmation_code` is unique since `0011`; `check_ins` unique per ticket; `seats_remaining
>= 0` CHECK exists in `0009`; `online_cutoff_minutes` CHECKs are in the schema; migrations run from the unpooled URL;
`0013`/`0014` follow expand-first; `0015` documents every table.

#### AR-12 · Medium · The schema records what the code does not enforce, and keeps what the code does not use

- **Confidence:** CONFIRMED (grep counts on this base, excluding tests and the schema itself).
- **Locations:**
  - Tables/columns with zero readers or writers in `apps/web` and `apps/mobile`: `holiday_dates` (0 files),
    `trips.deposit_percentage` (0), `trips.duration_day/hr/min` (0), `trips.online_cutoff` (deprecated, comment in
    `0015`), `trip_overrides` (1 file, the seed), `customers.password_hash` (4 files, all seeds/tests; customers
    authenticate by OTP only), `operators.twilio_from_number` (1), `operators.fee_bearer`/`fee_display` (P2-4),
    `operators.cancel_window_hrs` (P7-4 item 5), `payments.status` (written once, never read).
  - Invariants documented in `0015` comments that no constraint or code enforces: `trips.seats_remaining`
    "change only with SQL arithmetic inside a FOR UPDATE transaction" (six writers, AR-7); `bookings.status`
    transition graph (eight write sites, no transition table); `tickets.fee_status` "revenue counts only earned"
    (held tickets on unpaid bookings become earned, P3-1); `rate_limits` "deleted by the expire-pending-bookings cron"
    (documents the coupling the P3 item asks to remove).
  - Index coverage: `tickets` has no secondary index at all; `booking_items` is indexed on `booking_id` only
    (F1-11, still open); `magic_link_otps` has no index on `(operator_id, email)`; `rate_limits` none on
    `window_start`.
- **What's wrong:** The schema is the one artefact every developer reads first, and it currently describes a
  product with deposits, holiday pricing, customer passwords, fee bearers, cancel windows and trip overrides, none of
  which exist. Each dead column has already cost a finding (P2-1 `online_cutoff`, P2-4, P7-4, P2-13), because someone
  reads the column and assumes behaviour. The documented invariants without enforcement are the same problem in
  reverse: the schema promises rules that only convention keeps.
- **Failure scenario:** A new developer implements "pay a deposit" against `deposit_percentage` because the column
  and its comment exist, ships a PI for 20% of `total_cents`, and the settlement logic (which reads `total_cents`)
  counts the full amount as paid.
- **Related existing IDs:** F1-10, F1-11, F1-12, F1-14, P2-4, P7-4 item 5, P2-13, cross-cutting problem 7 in
  CODE_REVIEW.md.
- **Fix design (S for the contract migration, M for the constraints):**
  1. Contract migration (after confirming zero reads in prod code): drop `holiday_dates`, `trip_overrides`,
     `trips.deposit_percentage`, `trips.duration_*`, `trips.online_cutoff`, `customers.password_hash`; keep
     `twilio_from_number` only if SMS is on the roadmap, else drop. `fee_bearer`/`fee_display`/`cancel_window_hrs`:
     either implement (P2-4, P8-14) or drop, decided before launch.
  2. Encode the state machines: `bookings.status` and `trips.status` transitions become `CHECK`-free but
     code-enforced through one `transition()` helper per table (same shape as PR #47's `moveTickets`), plus a
     trigger-free `*_status_changed_at` column so "when did this change" is answerable.
  3. Indexes from F1-11 plus `magic_link_otps(operator_id, email, used)`, `rate_limits(window_start)`,
     `bookings(operator_id, hold_expires_at) WHERE status = 'pending'` (the reclaim and cron predicate), and
     `tickets(operator_id, status)` once PR #47 lands.
  4. Composite FKs for tenant consistency (F1-10) become cheap once AR-1's RLS is in place; do them in the same
     migration series.


### Area I — Stripe Connect

Reviewed: `app/api/stripe/connect/start/route.ts`, `app/api/stripe/connect/callback/route.ts`.

What's clean (verified): both routes require an admin session; `state` is an HMAC of a nonce held in a 10-minute
`httpOnly` cookie and compared timing-safely before anything else; OAuth errors redirect without writing; the token
exchange uses the documented endpoint after `stripe.oauth` was removed in SDK 22.

No new findings. P5-4 and P5-5 stand as written (status below). Two notes for X: the callback reads
`process.env.STRIPE_SECRET_KEY!` directly (`callback/route.ts:61`) while everything else goes through `env`, and the
redirect URI is derived from the request host (`start/route.ts:23`), which is the right tenant-aware choice but means
every tenant hostname must be registered in the Connect settings (P5-4 item 3).


### Area O — notifications / misc lib

Reviewed: `lib/date-et.ts`, `lib/format.ts`, `lib/push.ts`, `lib/email.ts` (head), `app/api/reports/upload/route.ts`,
`app/api/reports/upload-photo/route.ts`, file sizes of the report routes.

What's clean (verified): `todayET` and `etWallClockToUTC` resolve the offset via `Intl`, not a constant;
`fmtTimeET` passes `timeZone`; push lookups are operator-scoped and filtered by preference; uploads require a mate
token or admin session and allow-list image types.

No new design findings beyond Pass 9; two Low notes that fold into X:
- **Push receipts are never read.** `push.ts:53` `Promise.allSettled(... sendPushNotificationsAsync)` discards the
  tickets. Expo's contract is to fetch receipts and deactivate tokens that return `DeviceNotRegistered`; without it,
  `push_tokens.active` never turns false and Expo throttles the sender after repeated failures. Fix (S): store
  ticket ids, fetch receipts from the AR-11 `tick`, set `active = false` on `DeviceNotRegistered`.
- **Upload size check trusts `Content-Length`.** `upload-photo/route.ts:19–22`: a chunked request has no
  `Content-Length`, so `Number(null ?? 0)` is `0` and the stream goes to Blob unbounded (P9-10's "10 MB limit is
  unreachable" from the other side). Fix (S): wrap `req.body` in a counting `TransformStream` that aborts past the
  limit, and prefix the pathname with the operator id (P9-10 item 1).
- Money formatting is implemented in `email.ts:30–32` (`fmt`), `@openboat/utils` (`dollars`) and the clients; the
  duplication table has the row.


### Area P — packages / CI

Reviewed: `.github/workflows/*.yml` (triggers, permissions, action pins, secrets), `pnpm-workspace.yaml`,
`packages/types/src/index.ts`, `packages/utils/src`, the vitest inventory (66 files) and what they mock.
`jscpd` is not installed in `node_modules/.bin` and the network sandbox blocks `npx`; the committed
`jscpd-report/` was not re-run. The duplication table in §4 comes from reading, not from jscpd.

What's clean (verified): workflows trigger on `pull_request`, never `pull_request_target`; the smoke test runs on
`deployment_status` and uses a bypass secret rather than exposing the preview; web tests run against a real Postgres
service (`@/lib/session` is mocked in 22 files, `@/lib/stripe` in 11, the DB is not); migrations run from the
unpooled URL; every override in `pnpm-workspace.yaml` is explained in CLAUDE.md.

#### AR-13 · Medium · There is no shared API contract between web and mobile: `@openboat/types` is empty, the apps hand-type each other's JSON, and nothing versions the API

- **Confidence:** CONFIRMED.
- **Locations:** `packages/types/src/index.ts` (`export type {}`; zero importers across `apps/`);
  `apps/mobile/lib/wallet.ts:7–40` (`WalletTicket`, `WalletBookingItem`, `WalletBooking` typed by hand against
  `GET /api/bookings`); `apps/mobile/lib/mate-store.ts:5–50` (`MateTrip`, `MateTicket`, `MateBooking`,
  `MateManifest` against `/api/mate/manifest`); no `x-app-version`, `Accept-Version` or `/v1/` anywhere in
  `apps/web/src/app/api` or `apps/mobile/lib`. `@openboat/utils` is shared (13 mobile importers) for the cart model
  and Zod schemas only.
- **What's wrong:** Every response shape exists twice: once implicitly in the route's `NextResponse.json({...})` and
  once in the mobile type. A server change (PR #47 adds `tickets.status` and will drop `voided`; AR-4 renames
  `bookingId` to `holdId`; `alreadyCheckedIn` in P6-3) compiles on both sides and fails at runtime on installed apps.
  There is no way for the server to tell an old app it must update, and no way for CI to catch a drift.
- **Failure scenario:** PR #47 ships `status` and later drops `voided`. The mate app in the field still reads
  `t.voided` (`mate-store.ts`); it is `undefined`, so `!t.voided` is true and a refunded ticket scans green. The
  server-side guard catches the sync, but the gangway already waved the passenger on.
- **Related existing IDs:** P6-2, P6-3, P8-6, P8-16 (the cart half, now shared), P9-8 (no release gates).
- **Fix design (M):**
  1. `packages/contracts`: one Zod schema per endpoint response and request (`walletBookingSchema`,
     `mateManifestSchema`, `checkInBatchResultSchema`, `quoteSchema`, …), with `z.infer` types exported. Routes
     build their JSON through `schema.parse(...)` (dev-only strict, prod `safeParse` + log), and the mobile client
     parses every response with the same schema, so a drift is a typed error at the boundary on both sides.
  2. Version the contract: a `CONTRACT_VERSION` constant in the package; mobile sends `x-contract-version`; a
     middleware-level check returns `426 Upgrade Required` with a store link when the server's minimum is higher.
     Additive changes bump the minor; removals (dropping `voided`) bump the minimum after one release cycle.
  3. A CI job (`contract-check`) that runs the web route tests with the mobile schemas as the response validator.

#### AR-14 · Low · CI workflows run with default token permissions and unpinned third-party code

- **Confidence:** CONFIRMED (no `permissions:` key in any of the five workflows; all actions pinned by tag; `npx
  expo-doctor@latest` in `mobile-checks.yml:43`).
- **Locations:** `.github/workflows/web-checks.yml`, `mobile-checks.yml`, `mobile-preview.yml`, `mobile-release.yml`,
  `smoke-test.yml`; `k1LoW/setup-tbls@v1` (`web-checks.yml:260`).
- **What's wrong:** Without `permissions:`, `GITHUB_TOKEN` gets the repository default, which on older repos is
  read/write for `contents` and `pull-requests`. A compromised tag of any used action, or a malicious
  `expo-doctor` publish, runs with that token plus `EXPO_TOKEN` (which can publish an OTA update to the store
  builds, P9-8) and `VERCEL_BYPASS_SECRET`.
- **Failure scenario:** A maintainer of a transitive action is phished and moves the `v4` tag. The next PR run
  exfiltrates `EXPO_TOKEN`; an OTA update ships to every installed mate app with a modified `resolveScan`.
- **Related existing IDs:** P9-8, P9-14.
- **Fix design (S):** top-level `permissions: { contents: read }` in every workflow, with `pull-requests: write`
  only on the comment step; pin every `uses:` to a commit SHA with a version comment and enable Dependabot for
  actions; replace `expo-doctor@latest` with the version in `apps/mobile/package.json`; move `EXPO_TOKEN` to an
  environment with required reviewers for the release workflow.


### Area K — web booking UI

Reviewed: `app/checkout/CheckoutForm.tsx` (678 lines, first 420 read closely, rest skimmed), `lib/checkout/stored-hold.ts`,
file sizes and structure counts for `components/BookingCalendar/*`, `app/cart/CartClient.tsx`, `app/(public)/page.tsx`,
`app/boarding/[bookingId]/page.tsx`; import graph checks (DB in components, design tokens).

What's clean (verified): no client component imports `@openboat/db`; every total shown is the server quote or the
held booking's PI amount (P8-3 closed); the hold token travels in a header; `releaseHold` uses `keepalive`; the
bfcache `pageshow` case is handled.

#### AR-19 · Medium · The checkout's hold protocol is a state machine implemented inside a 678-line React component

- **Confidence:** CONFIRMED (structure counts: 6 `useEffect`, 10 `useState`, 3 `fetch`, 4 `window.location`
  writes, a `Prepared` union and `reachedReclaim()` status heuristics, all in `CheckoutForm.tsx`).
- **Locations:** `app/checkout/CheckoutForm.tsx:226–420` (`Prepared`, `reachedReclaim`, `createBooking`,
  `releaseAttempt`, `handleHoldExpired`, resume-on-load, bfcache) plus the submit path below line 420;
  `lib/checkout/stored-hold.ts` (storage and `releaseHold` only).
- **What's wrong:** The 4b work made the hold lifecycle correct, and it made it live in the view. The transitions
  (none → ready → paid | expired | replaced; error-with-answer vs error-without-answer; "unreleased previous
  booking rides along as `replaces`") are decided by status codes and refs inside effects. There is no unit test
  for them (the Playwright spec covers the happy path and a declined card), and the mobile checkout
  (`apps/mobile/app/checkout.tsx`, 508 lines) re-implements the same protocol against the same endpoints. Every
  rule the server adds (AR-4's `holdId` rename, a 426 from AR-13) will be patched into both components.
- **Failure scenario:** The server starts returning 429 with a JSON body on `POST /api/bookings` during a
  release-and-rebook. `reachedReclaim(429)` is false, so the previous booking is kept and sent as `replaces`
  again; correct. A later change makes the route release `replaces` *before* the rate-limit check. Now 429 means
  "released", the component keeps a dead hold, and the next press sends a stale `replaces` with a token for a
  cancelled booking, which the server ignores; the customer sees "hold ran out" after a successful rebook. Nothing
  in CI notices because the protocol is only testable through a browser.
- **Related existing IDs:** P2-3 (4b), P8-8, P8-16, P8-4; AR-13.
- **Fix design (M):** `packages/contracts/checkout-session.ts`: a pure reducer
  `next(state: CheckoutState, event: CheckoutEvent) → { state, effects[] }` where events are `pay`, `holdExpired`,
  `bookingResponse(status, body)`, `releaseResponse(result)`, `pageShown`, `confirmResult`, and effects are
  `createBooking(replaces)`, `release(hold)`, `confirm(clientSecret)`, `navigate(url)`, `store(hold)`. Shared by web
  and mobile (both already import `@openboat/utils` for the cart). `CheckoutForm` becomes a view plus an effect
  runner; the mobile checkout likewise. Unit tests enumerate the transition table, including the 429/400/404/409
  cases that `reachedReclaim` encodes today.

Notes that feed existing findings:
- **Pages query the DB directly.** Five Server Components import `@/lib/db` and write Drizzle queries inline
  (`app/boarding/[bookingId]/page.tsx:15–45`, `app/(public)/page.tsx`, both fishing-report pages, `app/status`).
  This is the UI → DB layering leak the brief asks about; AR-15's modules should expose `queries.ts` (e.g.
  `loadBoardingPass(tx, bookingId)`) and pages call those.
- **Design tokens unused on web.** `@openboat/design` has zero importers under `apps/web/src`; `CheckoutForm.tsx`
  and `CartClient.tsx` each contain 35 hex colour literals in inline `style` objects. Not a bug; it is why the
  P9-9 branding-per-operator work has no seam on the web side.
- `StoredHold` keeps the PI `clientSecret` in `sessionStorage` (`stored-hold.ts:15–29`). Per-tab and short-lived;
  acceptable, but it is one more copy of the bearer-credential class (P8-9).

### Area L — admin UI

Reviewed: file sizes for `app/admin/**` and `components/admin/merchant/*` (6,918 lines), the API call pattern across
all pages (33 raw `fetch('/api/admin/…')` sites, 28 `useEffect`s), the refund and report handlers in
`app/admin/trips/[tripId]/passengers/page.tsx`, and which pages are client components (all five top-level pages).

What's clean (verified): the v1 pages and the bridge are gone (P9-13 closed by `e8911e5`/`aa54232`); mutations in
the passengers page check `res.ok` and toast the server's error; today-ness uses `todayET()`.

#### AR-20 · Medium · The admin console is entirely client-rendered over 33 hand-written `fetch` calls with no shared client, no response types and server state held in component `useState`

- **Confidence:** CONFIRMED (counts above; every `app/admin/*/page.tsx` starts with `"use client"`).
- **Locations:** `app/admin/page.tsx`, `calendar/page.tsx`, `money/page.tsx`, `schedule/page.tsx`,
  `reports/page.tsx`, `settings/SettingsClient.tsx` (706 lines), `trips/[tripId]/passengers/page.tsx` (6 fetch
  sites); no `adminFetch`/`useTripActions` helper exists (P9-5's proposed fix has not landed).
- **What's wrong:** Each page re-implements load → `setState` → mutate → reload with its own error handling. A
  non-JSON error response still throws out of `await res.json()` (`passengers/page.tsx:156`) past the `finally`,
  so P9-5 is only partly closed. Response shapes are untyped `body.trip`, `body.refundedCents`; AR-13's drift
  applies to the web admin as much as to mobile. Reads that need no interactivity (Today, Calendar, Money) run as
  client fetches after hydration, which doubles the request count and makes every page a loading spinner.
- **Failure scenario:** Blocker row 9 changes `POST /api/admin/trips/:id/cancel` to return
  `{ bookingsCancelled, refunds: [...] }` and drop `ticketsVoided`. Two pages read `body.ticketsVoided`
  (`page.tsx`, `calendar/page.tsx`, per P9-5) and render `undefined` in the toast. TypeScript is silent because the
  body is `any`.
- **Related existing IDs:** P9-5, P9-13 (closed), P7-12, AR-13.
- **Fix design (M):** (1) `lib/admin-api.ts`: one typed client generated from `packages/contracts` (AR-13), with
  one error path (non-2xx and non-JSON both become `AdminApiError` with the server message or a default). (2) Read
  pages become Server Components calling `lib/*/queries.ts` with `adminContext()` (AR-2); only the interactive
  islands (dialogs, TripRow actions) stay client. (3) Mutations go through route handlers as now, but via the typed
  client, and revalidate with `router.refresh()`. This removes the 28 effects and the per-page reload functions.

### Area M — mate app

Reviewed: `apps/mobile/lib/mate-store.ts` (full), `lib/mate-auth.ts` (storage), structure of
`app/(mate)/manifest/[tripId].tsx` (879 lines; the scan match and sync call sites), `lib/api.ts`.

What's clean (verified): the mate token lives in `expo-secure-store` (`mate-auth.ts:13–21`), not AsyncStorage;
the queue is `INSERT OR IGNORE` on `local_id`, so replays are idempotent on the device; `syncCheckIns` is
injectable and unit-tested; sync runs before the manifest refresh (`manifest/[tripId].tsx:190–191`).

No new design findings beyond Pass 6; the existing ones stand (status below). Notes that feed this review's
findings:
- **Server types are hand-copied** (`mate-store.ts:5–44`, `MateTicket.voided`), the AR-13 case that PR #47 will
  break first.
- **The device's queue is treated as truth**: `getLocalCheckedInTickets` (`:235–242`) returns every queued ticket
  regardless of `synced` or `sync_error`, and `syncCheckIns` (`:216–229`) only marks rows; it never replaces the
  local view with the server's check-in set. The fix in blocker row 16 (`useCheckInQueue` + a sync response that
  returns the trip's current check-ins) is the outbox-plus-authoritative-merge shape AR-6 uses on the server.
- **A non-OK sync response is silent** (`:216`, no `else`): an expired token (P6-5) or a 5xx looks like "offline".
  AR-13's `426` path needs an explicit branch here.
- The manifest is cached as one JSON blob per trip (`mate_manifests.raw_json`), including every ticket's
  `qrPayload` and the customer's email and phone (P6-2, P6-8).

### Area N — consumer app

Reviewed: `apps/mobile/lib/api.ts` (full), `lib/wallet.ts` (types and DB init), `lib/customer-auth.ts` (storage),
structure counts for `app/checkout.tsx` (508 lines: 1 effect, 9 state hooks, 5 API calls).

What's clean (verified): the customer token lives in `expo-secure-store`; production builds throw without
`EXPO_PUBLIC_API_URL` (`api.ts:9`) instead of defaulting to a placeholder host; the wallet mirrors the `GET
/api/bookings` shape with a `syncedAt`.

No new design findings beyond Pass 8. Notes:
- **Checkout protocol duplicated.** `app/checkout.tsx` re-implements the hold/replace/release flow against the same
  endpoints as `CheckoutForm.tsx`; AR-19's shared reducer is the fix for both.
- **No `https` check** on `EXPO_PUBLIC_API_URL` (`api.ts:4`, P8-12 still open), so a misconfigured build would send
  the SecureStore token in clear.
- **Wallet types hand-typed** (`wallet.ts:7–50`; AR-13); `WalletTicket.voided` is the field PR #47 supersedes.
- The wallet SQLite cache stores boarding `qrPayload`s and PII unencrypted on the device (P6-8/P8-11 class).

### Cross-cutting (pass X)

#### AR-15 · High · Domain logic has no home: eight money or inventory flows live inline in route handlers, so every rule is enforced per entry point and tested only over HTTP

- **Confidence:** CONFIRMED (file-by-file in areas A–H).
- **Where the logic lives today (the answer to "which other flows have the same problem"):**

  | Flow | Where | Lines | Domain module it should be |
  |---|---|---|---|
  | Booking creation (hold, price, persist, PI) | `api/bookings/route.ts` | 54–253 | `lib/booking` (`createHold`, `attachPayment`) |
  | Trip cancellation (refund plan, Stripe loop, state) | `api/admin/trips/[tripId]/cancel/route.ts` | 9–193 | `lib/cancellation` (`cancelTrip`) |
  | Per-ticket refund | `api/admin/tickets/[ticketId]/refund/route.ts` | 8–88 | `lib/cancellation` (`refundTicket`) |
  | Schedule materialization and reconciliation | `api/admin/settings/schedules/{route,[scheduleId]}` | 58–141, 31–163 | `lib/schedules` (`materialize`, `reconcile`) |
  | Capacity edit (two copies) | `api/admin/trips/[tripId]`, `api/mate/trips/[tripId]/capacity` | 98–192, 7–101 | `lib/inventory` (`setTripCapacity`, AR-7) |
  | Check-in (two copies) | `api/mate/checkins`, `api/admin/trips/[tripId]/checkins` | 16–85, — | `lib/checkin` (`recordCheckIn`) |
  | Hold expiry (two copies) | `api/cron/expire-pending-bookings`, `lib/bookings/reclaim-expired-holds` | 25–124 | `lib/booking` (`reclaimExpiredHolds`, AR-10) |
  | Settings writes (operator, vessels, products, staff) | `api/admin/settings/**` | — | `lib/settings` with one Zod schema per entity |

  Already extracted and in good shape: `lib/bookings/{cart,price-cart,price-book,reclaim,release,cancel}`,
  `lib/webhooks/*`, `lib/settle-trips`, `lib/trips/{month,online-sales}`, and PR #47's `lib/tickets`.
- **What's wrong:** Besides the per-flow bugs the earlier passes found, the structural costs are: (1) every rule
  about a ticket, a seat or a refund is re-decided where it is used (AR-7's three restore rules, P7-3's two
  capacity rule sets, P7-7's two check-in rule sets); (2) the only way to test a rule is through a `NextRequest`
  with a mocked session (22 test files mock `@/lib/session`); (3) the operator, the actor and the clock are read
  from globals inside the flow, which is why AR-1, AR-9 and AR-11 are hard to fix one route at a time.
- **Related existing IDs:** P2-11, P4-10, P6-10, P7-11, P7-3, P7-7, P9-5, refactoring-backlog item 1, blocker rows
  8, 9, 14, 16.
- **Fix design (L in total, built as the blockers are fixed rather than before them):** Each module exports
  commands with the shape `command(ctx: RequestContext, tx: TenantTx, input) → Result | DomainError`, where
  `RequestContext` carries `tenant`, `principal` and `now` (AR-2, AR-9, AR-11), `TenantTx` comes from `withTenant`
  (AR-1), and `DomainError` is a discriminated union (`not_found | conflict | validation | stripe_unavailable`)
  that one `toResponse()` in `lib/http.ts` maps to status codes (AR-17). Routes become: parse with Zod → build
  context → `withTenant` → call the command → `toResponse`. Unit tests call the command with a real `tx` from the
  test DB and a fixed `now`. The order to extract is the blocker order: tickets (#47) → inventory (AR-7) → booking
  (row 8) → cancellation (rows 9–11) → schedules (row 14) → check-in (row 16).

#### AR-16 · Medium · Booking and trip status transitions are open-coded at eight and five sites with no transition table; PR #47 gives tickets one, the other two state machines need the same

- **Confidence:** CONFIRMED (grep on this base).
- **Locations:** bookings: `api/bookings/route.ts:155` (`pending`), `lib/bookings/cancel.ts:79,131`,
  `admin/trips/[tripId]/cancel/route.ts:144`, `lib/webhooks/payment-intent-succeeded.ts:64` (`confirmed`), each
  with its own precondition (or none: the trip-cancel route sets `cancelled` on a plain `inArray`). Trips:
  `admin/trips/[tripId]/cancel/route.ts:40,121`, `lib/settle-trips.ts:26,61`, and the schedule PATCH deletes
  `scheduled` trips outright.
- **What's wrong:** "Can this booking go from X to Y" is answered by whichever route is writing. A cancelled
  booking can be re-confirmed only because one handler checks; a sailed trip can be cancelled with a warning
  (P4-9); a `charge.refunded` arriving before `succeeded` is dropped (P3-8) because `cancelConfirmedBooking`
  requires `confirmed`. The ticket module on PR #47 shows the fix: one `ALLOWED` table and one conditional UPDATE
  that returns the rows it moved.
- **Related existing IDs:** P3-8, P4-1, P4-9, P4-8, P3-5 item 2, P4-7.
- **Fix design (S each):** `lib/bookings/status.ts` and `lib/trips/status.ts` with `transition(tx, scope, from, to)`
  mirroring `moveTickets`; every write site calls it and branches on the returned rows; a unit test per table
  asserts the graph. Add `status_changed_at` (AR-12 item 2).

#### AR-17 · Medium · Three conventions for the same boundary concerns: validation, domain errors and env access

- **Confidence:** CONFIRMED.
- **Locations:**
  - Validation: Zod on `POST /api/bookings`, `quote`, `contact` (`lib/bookings/cart.ts`, `contact.ts`); hand-rolled
    `String(body.x ?? "")` / `Number()` on every admin route (`settings/schedules/route.ts:63–88`,
    `settings/operator/route.ts:26–71`, `trips/[tripId]/route.ts:104–131`); untyped `as { email?: string }` casts on
    the auth routes; `req.json()` with no guard on `admin/auth/login/route.ts:11` and `platform/auth/route.ts:11`
    (a non-object body throws → 500).
  - Domain errors: `{ httpStatus }` (`lib/bookings/cart.ts:59–73`), `{ status }` (`admin/trips/[tripId]/route.ts:148`,
    `mate/trips/[tripId]/capacity/route.ts:41–65`), `NextResponse` returned from helpers (`requireAdmin`,
    `requireMate`, `requireHoldToken`), string results (`release.ts` `"paid" | "error"`).
  - Env: `env.X` (validated) in most places; `process.env.X!` in `lib/stripe.ts:3`, `lib/db.ts:3`,
    `middleware.ts:6`, `customer-auth.ts:18,26`, `mate-auth.ts:18,26`, `hold-token.ts:22`,
    `connect/callback/route.ts:61`, `email.ts:5`.
- **What's wrong:** None of these is a bug on its own; together they mean a reviewer can't tell from the shape of
  a route whether its input is validated or its errors are mapped. Phase 1's "one Zod schema per route" fixes the
  first; the other two have no owner.
- **Related existing IDs:** P7-4, P7-9, P7-5, P6-7, P5-11, P9-11.
- **Fix design (S):** `lib/http.ts`: `parseBody(req, schema)` → `Result`, `DomainError` class with a `kind`,
  `toResponse(err)`; `lib/env.ts` becomes the only reader of `process.env` (ESLint `no-process-env` outside it).
  Lands alongside AR-15's route rewrite so each route is touched once.

#### AR-18 · Medium · There is no observability: unstructured `console.*`, no error tracker, no request id, no alert path, and "manual review" has nowhere to land

- **Confidence:** CONFIRMED (`grep -rn 'sentry\|opentelemetry\|pino\|winston' apps/web/src` is empty; every
  failure branch in B, C, D ends in `console.error`).
- **Locations:** `lib/webhooks/*` (12 `console.error` branches), `api/cron/*`, `lib/bookings/release.ts:34`,
  `admin/trips/[tripId]/cancel/route.ts:29,97`, `lib/push.ts`, `lib/email.ts`.
- **What's wrong:** On Vercel, `console` output is the only trace and it is unsearchable after the retention
  window. Nothing carries `operatorId`, `bookingId` or a request id consistently, so correlating a Stripe event
  with a booking means reading free-text. There is no way to page anyone when the webhook starts failing
  (AR-6), when the cron 404s (F1-2), or when a dispute opens (P3-9).
- **Failure scenario:** `RESEND_API_KEY` is rotated and the old one revoked. Confirmation emails fail for two days.
  The only signal is `console.error("Failed to send confirmation email")` in logs nobody tails; customers call
  the operator.
- **Related existing IDs:** P3-4, P3-9, P9-5, P9-7, P9-15, P6-5, F1-2.
- **Fix design (S):** `lib/log.ts` (pino, JSON, bound with `operatorId`, `requestId`, `principal`), used by the
  `RequestContext` from AR-2; Sentry (or equivalent) with the same tags and `waitUntil`-safe flush; an
  `operator_alerts` table written by the inbox/outbox (AR-6) and the scheduler (AR-11) and shown on the admin
  Today page, plus one platform-level alert channel (email or Slack webhook) for `attempts > 3` rows and cron
  failures. Health check gains `select 1` and a `stripe_events` lag number.


---

## 4. Duplication table

| # | Cluster | Locations | Drifted? | Proposed abstraction |
|---|---------|-----------|----------|----------------------|
| D1 | Expire unpaid holds (select → retrieve PI → cancel PI → cancel booking → push) | `api/cron/expire-pending-bookings/route.ts:34–114`; `lib/bookings/reclaim-expired-holds.ts:88–156` + `release.ts:21–37` | **Yes** (error handling, legacy branch, ordering) | `reclaimExpiredHolds` is the one implementation; cron calls it (AR-10) |
| D2 | Seat restore from ticket count | `lib/bookings/cancel.ts:63–75` and `:107–119`; `admin/tickets/[ticketId]/refund/route.ts:81–84`; `admin/trips/[tripId]/cancel/route.ts:150–153` | **Yes** (all tickets / +1 / reset to capacity) | `lib/inventory/seats.ts` driven by ticket transitions (AR-7) |
| D3 | HMAC token sign/verify | `lib/customer-auth.ts:17–44`; `lib/mate-auth.ts:17–46`; `lib/bookings/hold-token.ts:21–53` | Minor (TTL, payload shape; the hold token's verify also binds ids) | `lib/tokens.ts` `signToken(aud, payload, ttl)` / `verifyToken(aud)` with per-audience derived keys (P5-12) |
| D4 | Operator record fetch | `lib/operator.ts:70–80` and `:87–97` | No | one `loadOperator(id)` behind both (F1-16) |
| G1 | Trip manifest assembly (trip → items → bookings/tickets/check-ins → nested map) | `api/mate/manifest/route.ts:49–113`; `api/admin/trips/[tripId]/route.ts:40–93`; `api/admin/today/route.ts` (per Pass 7) | Minor (field sets differ; admin adds PI id) | one `loadTripManifest(tx, tripId)` in `lib/trips` returning a typed manifest; routes project fields |
| G2 | Capacity edit (lock trip → count sold → cap → `GREATEST` update) | `api/mate/trips/[tripId]/capacity/route.ts:28–91`; `api/admin/trips/[tripId]/route.ts:141–184` | **Yes** (certificate cap and audit row only on mate path, P7-3) | `setTripCapacity(ctx, tripId, n)` in `lib/inventory` (AR-7), used by both |
| O1 | Money formatting | `lib/email.ts:30–32` (`fmt`), `packages/utils/src/index.ts:5` (`dollars`), `components/admin/merchant/TripTypeDialog.tsx:35`, `apps/mobile/app/(tabs)/account.tsx:53` | **Yes** (`dollars` drops `.00`, the others keep it) | `@openboat/utils` `formatCents(cents, { cents: 'always' | 'auto' })`, only formatter |
| P1 | API response types | every mobile `lib/*.ts` type vs the route's inline JSON | **Yes** (will drift on PR #47) | `packages/contracts` Zod schemas (AR-13) |
| D5 | "Booking Expired" push | `reclaim-expired-holds.ts:164–180` (`notifyHoldsExpired`), called from cron, reclaim and `payment-intent-canceled.ts:30` | No (one function, three callers racing) | the canceller that wins the conditional UPDATE sends it; AR-6's inbox makes the webhook the single sender |

---

## 5. Status of existing findings

| ID | Status | Evidence |
|----|--------|----------|
| F1-3 | open | `middleware.ts:18–24` returns `NextResponse.next()` with no header strip on skipped paths. |
| F1-1 / F1-2 | open | `middleware.ts:17–24` skip list is still `/platform`, `/api/platform`, `/api/health`; webhook and cron paths go through the `domains` lookup. |
| P2-11 | fixed | `lib/bookings/price-cart.ts`; the route prices once at `route.ts:123`. |
| P2-3 / P8-10 | fixed | `reclaimExpiredHolds`, `release`, hold token (`route.ts:82–97`, `lib/bookings/*`). |
| P2-6 | fixed | `route.ts:116` locks trips in id order; `reclaim-expired-holds.ts:59–64` likewise. |
| P2-2 | open | `route.ts:180–189`: `priceCents: t.listCents`, comment says "until row 8". |
| P2-7 | open | `route.ts:50–52` 3-byte code, no unique constraint, no retry on collision. |
| P2-13 | open | `route.ts:163–164` records acceptance with no signal from the client. |
| P3-2 | open | `payment-intent-succeeded.ts:11–16` still trusts `metadata.bookingId`; no amount/destination compare. `route.ts:32–36` comment says single-deploy webhooks live on the connected account, which can't be true for destination charges (the PI is on the platform). |
| P3-4 | open | every handler branch returns 200 (`route.ts:58`). |
| P3-9 | partly fixed | dispute handler is now one transaction with `feeStatus: "reversed"` (`charge-dispute-created.ts:17–50`); "manual review" still goes only to `console.error`. |
| P3 "auto-refund on succeeded-after-cancel" (`architecture-review-findings.md:221`) | fixed | `payment-intent-succeeded.ts:85–96`. |
| P4-1 | open | `admin/trips/[tripId]/cancel/route.ts:69` skips pending bookings; trip status is written only after refunds (`:116–126`). |
| P4-3 | open | idempotency keys only (`cancel/route.ts:94`, `refund/route.ts:56,63`); no ledger. |
| P4-4 | open | `refund/route.ts:75–85` unconditional void and `+1`. |
| P4-10 | open | trip cancel is 180 lines inline. |
| P9-7 | open | `cancel/route.ts:172–183` push is not in `waitUntil`. |
| F1-6 | open | `platform/auth/route.ts:17` still `secret !== env.PLATFORM_SECRET`. |
| P5-2 | open | `admin/auth/login/route.ts:33`, `mate/auth/route.ts:44`: same `DUMMY_HASH` literal the review measured as malformed. |
| P5-7 | open | `auth/request/route.ts:23–24`, `auth/verify/route.ts:24–25`: OTP keys have no operator prefix. |
| P5-8 | open | `auth/request/route.ts:34` `Math.random()`. |
| P5-10 | open | `customer-auth.ts:60–61`, `mate-auth.ts:60–61`: compare only `if (operatorIdHeader …)`. |
| P5-12 | open, worse | a third hand copy of the HMAC scheme now exists: `lib/bookings/hold-token.ts:21–53`; all three read `process.env.SESSION_SECRET!` directly. |
| P5-1 | open | `session-factory.ts:13–22` passes no `ttl`; iron-session's seal default (14 d) still outlives the 8 h cookie. |
| P3-5 | open | `expire-pending-bookings/route.ts:34–56` no `ORDER BY`; `:88–94` proceeds after a Stripe error. |
| P3-7 | open | `trip-reminders/route.ts:71–75` `toLocaleTimeString` without `timeZone`. |
| P3 "CRON_SECRET timing-safe" | fixed | `lib/cron-auth.ts`. |
| P3 "trip-reminders N+1" / "duplicate pushes per email" | fixed | single join + `Set` (`trip-reminders/route.ts:23–64`). |
| P3 "legacy stale-window OR branch" | open | `expire-pending-bookings/route.ts:48–53`. |
| P7-1 / P7-2 | open | `[scheduleId]/route.ts:92–155`: schedule saved first, trips diffed after, no transaction, booked trips untouched. |
| P7-9 | open | `operator/route.ts:34–37` allow-list copy with `patch as any`. |
| P7-11 | open | trip-row building duplicated at `schedules/route.ts:119–132` and `[scheduleId]/route.ts:135–148`. |
| P3 "staff UPDATE lacks operatorId" (`architecture-review-findings.md:366`) | fixed | `staff/[staffId]/route.ts:66`. |
| P1 "admin capacity PATCH read-modify-write" | fixed | `trips/[tripId]/route.ts:141–184` locks and uses SQL arithmetic. |
| P6-3 | open | `mate/checkins/route.ts:77–78`: `onConflictDoNothing` then `ok: true`; `alreadyCheckedIn` is declared (`:30`) and never set. |
| P6-7 | open | `mate/checkins/route.ts:21–40`: no Zod; `new Date(checkedInAt)` unguarded. |
| P7-3 | open | admin capacity PATCH (`admin/trips/[tripId]/route.ts:155–170`) has no certificate cap and no `capacity_changes` row; mate path has both. |
| F1-11 | open | `schema.ts:314–330` tickets: no secondary index; `:300–308` booking_items: `booking_id` only. |
| F1-12 | partly fixed | `0009_seats_remaining_check.sql` lower bound only; no upper bound; still not in `schema.ts`. |
| F1-14 | open | `timestamp` without tz throughout (`hold_expires_at`, `created_at`, …). |
| P3 "confirmation_code unique" | fixed | `0011_confirmation_code_unique.sql`, `schema.ts:277`. |
| P3 "rate_limits window_start index" | open | no index in `schema.ts:584–`. |
| P5-4 | open | `callback/route.ts:82–89` sets `stripeOnboardingComplete: true` on token exchange alone. |
| P5-5 | open | `start/route.ts:20–21` state = HMAC(nonce) with no operator or session binding; callback overwrites `stripeAccountId` unconditionally. |
| P0 "Connect OAuth no state" (`architecture-review-findings.md:103`) | fixed | nonce cookie + HMAC state. |
| P9-6 | open | `date-et.ts:39` still uses the noon offset. |
| P9-10 | open | `upload-photo/route.ts:25` path `reports/<ts>-<name>`, no operator prefix. |
| P3-11 | open | `email.ts:38–60` interpolates fields into HTML without escaping. |
| P9-15 | open | `push.ts:53` results discarded. |
| P9-13 | fixed | `app/admin` has no legacy pages; commits `e8911e5`, `aa54232`. |
| P9-5 | partly fixed | `passengers/page.tsx:155–160` checks `res.ok`, but `res.json()` on a non-JSON body still throws uncaught. No shared helper. |
| P6-2 | open | `manifest/[tripId].tsx:271` matches `ticket.qrPayload === cleaned || ticket.id === cleaned`. |
| P6-4 | open | `mate-store.ts:235–242` local queue read without `synced`/`sync_error`. |
| P6-5 | open | `mate-store.ts:216–232` no branch for a non-OK response. |
| P6-7 | open | `server_error` results are neither marked nor dropped (`:224–226`). |
| P6-10 | open | 879-line screen. |
| P8-12 | open | `api.ts:4` no scheme check. |
| F1-16 | open | `lib/operator.ts:70–97`: `getOperatorContext` and `getOperatorRecord` are still two copies of the same select. |
| P3 "OPERATOR_ID validated at boot" (`architecture-review-findings.md:273`) | fixed | `instrumentation.ts:11–25` does the boot-time lookup. |
| P3 "middleware caches domain lookup" | open | `middleware.ts:38–40` queries per request; no cache. |

---

**Post-#47 update (verified on `main` at `b6e9ae8`):**

| ID | Status | Evidence |
|----|--------|----------|
| P3-1 / P7-7 / P9-4 | fixed | `lib/tickets/{lifecycle,queries,status}.ts`; `payment-intent-succeeded.ts` moves `held → live`; mate and office check-in use `isTicketLive`; `settle-trips.ts` earns only `isLive`. |
| P3-12 | fixed | `lib/bookings/cancel.ts:20–41` one `restoreSeats` counting moved tickets. |
| P4-4 | fixed | `admin/tickets/[ticketId]/refund/route.ts:76–89` conditional `moveTickets` before the `+1`. |
| AR-7 writers 2, 3 | now driven by ticket transitions (`cancel.ts:89–90, 125–129`), as the fix design asks. Writers 1, 4, 5, 6 unchanged: the refund route still does its own `+1`, trip cancel still resets to `capacity` (`cancel/route.ts:151`), capacity PATCHes still clamp with `GREATEST`. No ledger yet. AR-7 stays open at High; its remaining scope is writers 4–6 plus the ledger and `recount`. |
| AR-16 | unchanged | booking and trip status writes are still open-coded; `moveTickets` is the pattern to copy. |
| AR-4 | unchanged | the hold is still a `pending` booking row with `held` tickets. |

## 6. Cross-cutting notes

_(running scratch list; pass X turns these into findings)_

- (E) Library modules under `lib/` import the global `db` and take bare IDs; none take a tenant. Scoping is an entry-point property, not a module property. → AR-1.
- (E) CI, Playwright and the smoke test all run with `OPERATOR_ID`; centralized mode has zero automated coverage. → AR-3.
- (E) Crons and the webhook are legitimately cross-operator (they iterate all tenants); CLAUDE.md's "never build cross-operator features" has no carve-out, so there is no sanctioned `withPlatform` path either.
- (A) Domain errors carry HTTP status: `cart.ts:59–73` throws `Object.assign(new Error(), { httpStatus })`, and the route maps it at `route.ts:204–210`. The domain layer knows HTTP. Check whether other modules do the same (C/H).
- (A) Booking status is written in 4 files / 8 sites (`route.ts:155`, `cancel.ts:79,131`, `admin/trips/[tripId]/cancel/route.ts:40,121,144`, webhook succeeded) with no transition table; trips likewise (`settle-trips.ts:61`, cancel route). PR #47's `moveTickets` (conditional UPDATE from→to, one module) is the pattern the other two state machines lack. → X finding.
- (J) `createDb` uses postgres-js defaults (`max: 10`, prepared statements on). SUSPECTED: confirm prod `DATABASE_URL` is the Neon pooled host and set `max` per lambda to a small number (2–3); with 10 per instance a burst of 20 lambdas can exhaust a Neon compute's connection budget.
- (D) Operability: every cron and handler reports through `console.log/error`; no structured fields (operator, booking, request id), no error tracker (no Sentry/OTel import anywhere: `grep -rn sentry\|opentelemetry apps/web/src` empty), no alert path. "Manual review required" has nowhere to go. → X.
- (D) Trip status has a time-driven state (`pending_settlement`) that only exists if someone looks; `trips.status` is therefore not a fact about the trip but about admin page views.
- (F) Three token modules, one `makeSession`, and `process.env.SESSION_SECRET!` read in 5 places: the key-management surface is spread across `lib/`. A `lib/tokens.ts` with HKDF-derived per-audience keys is P5-12's fix and should also own the hold token.
- (F) Rate-limit keys are free-form strings built per call site (`booking-create:${opId}:${ip}`, `otp-request:ip:${ip}`, `mate-auth:${operatorId}:${email}`): no central registry, so operator scoping is applied inconsistently (P5-7).
- (B/C) `payments.status` is written once and never updated; `payments` has no refund or dispute columns. Dead-column class (CODE_REVIEW cross-cutting 7).
- (B/C) Stripe calls in request handlers: `route.ts` (PI create), `release.ts`, `reclaim`, 4 webhook handlers, 2 admin routes, cron. No wrapper, no per-call timeout, no circuit breaker. `lib/stripe.ts` is 5 lines.
- (C) Trip-cancel route builds the refund plan from `booking_items.subtotalCents` (net) while ticket refund uses `tickets.priceCents` (list): two money sources for one refund concept (P2-2/P4-2 class).
- (A) `GET /api/bookings` returns `qrPayload` per ticket (bearer-credential class, P6-2/P8-1).
- (E) `packages/db/src/index.ts:8`: `postgres(databaseUrl)` with driver defaults (max 10 connections per lambda instance, no `prepare: false`); memory notes dev exhausts connections. Check in J/P whether prod uses the Neon pooled URL.


---

## 7. Proposed sequencing

**The order of work lives in `CODE_REVIEW.md` → "Launch Blockers" (folded in on 2026-11-16).** This section only
says where each finding landed, so nobody follows two tables.

| Finding | Where it landed |
|---|---|
| AR-1 | Before a second operator, row 27 (with F1-10, P2-10) |
| AR-2 | Before a second operator, row 26 |
| AR-3 | Before a second operator, row 28 |
| AR-4 | Fix Roadmap, Phase 3 (after rows 8, 10, 29) |
| AR-5 | Pre-launch, row 24 |
| AR-6 | Pre-launch, row 10 (rewritten; rows 9 and 11 build on it) |
| AR-7 | Pre-launch, row 8 — done (PR #51), except the capacity CHECK |
| AR-8 | Pre-launch, row 21 |
| AR-9 | Pre-launch, row 12 (with P5-1, F1-8) |
| AR-10 | Pre-launch, row 22 (with the rest of P3-5) |
| AR-11 | Before a second operator, row 29 (with P3-7, P5-9 purge) |
| AR-12 | Row 31 (indexes, item 3); Phase 3 (contract migration, items 1–2); row 8 (`status_changed_at`, item 2) |
| AR-13 | Before a second operator, row 30 (must precede the first store submission) |
| AR-14 | Pre-launch, row 23 |
| AR-15 | Phase 3 (remaining extractions); rows 8, 9, 14, 16 build the first modules |
| AR-16 | Pre-launch, row 8 — done (PR #51) |
| AR-17 | Phase 3, with AR-15 |
| AR-18 | Pre-launch, row 25 |
| AR-19 | Phase 3 (after row 30) |
| AR-20 | Phase 3 (after row 30) |

---

## 8. What was not reviewed or could not be verified

- **Tier 3 was reviewed after S** (K, L, M, N; sections above). Coverage there is structural, not line-by-line:
  `CheckoutForm.tsx` beyond line 420, the 879-line manifest screen, `SettingsClient.tsx`, the calendar and schedule
  pages, and `app/checkout.tsx` were sampled by grep and size, not read in full. A later session should read the
  scanner's `handleScan` path in full against blocker 16's design.
- **Not re-run:** `jscpd` (not installed; `npx` blocked by the sandbox). The committed `jscpd-report/` is stale and
  was not used.
- **SUSPECTED, needs a check:**
  - AR-5: stripe-node 22's default retry/idempotency behaviour on a network timeout during `paymentIntents.create`
    (check `maxNetworkRetries` default in the installed version and reproduce with a Stripe mock that times out).
  - J note: whether production `DATABASE_URL` is the Neon pooled host and what `max` postgres-js opens per lambda
    (check Vercel env and Neon's connection graph during the k6 load test).
  - AR-8: exact CSP allow-list for Stripe Elements, PostHog and Vercel Blob needs one report-only cycle to settle.
- **Not reviewed by design:** `docs/`, screenshots, `.har`/`.dump`, `design_handoff_*`, `admin_redesign_brief/`,
  generated `migrations/schema.ts` and `relations.ts`, and PR #47's branch beyond reading `lib/tickets` and the
  schema diff.
- **Out of reach:** GitHub API (sandbox), so PR #47's description and review state were read from the local branch
  only; Stripe Dashboard settings (webhook endpoints, Connect redirect URIs) were not checked.

