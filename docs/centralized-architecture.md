# Centralized Architecture

How to evolve from one-deployment-per-operator to a shared platform (FareHarbor/GoFish model), with the existing per-deploy model kept as the enterprise/white-label tier.

---

## What Centralizes vs. What Always Stays Per-Operator

| Service | Centralized | Always per-operator |
|---|---|---|
| Vercel (hosting) | One deployment, all operators | — |
| Neon (Postgres) | One DB, all data scoped by `operator_id` | — |
| Resend (email) | One account, one sender | — |
| Vercel Blob (photos) | One storage bucket | — |
| PostHog (analytics) | One account | — |
| **Stripe Connect** | — | Each operator has their own Connected Account; platform takes `application_fee_amount`. Does not change between models. |
| **Expo (mobile app)** | — | One shared app build; push gateway is always the same Expo account |

Stripe and Expo are always shared across operators regardless of deployment model.

---

## Schema

No migration needed. A `domains` table (`id`, `operator_id`, `domain`, `primary`, `created_at`) has been in the schema since migration `0000`. One operator can have multiple domains; each domain row is unique.

---

## Work Item List

Items are ordered by dependency. Core architecture is ~1 week; platform admin panel is a separate workstream after the plumbing is done.

| # | Item | Status | Effort | Notes |
|---|---|---|---|---|
| 1 | **`domains` table** — hostname → operator_id mapping | ✅ Done | — | Already in schema since `0000_safe_kingpin`. |
| 2 | **Vercel Edge middleware:** read hostname → lookup `operator_id` → inject `x-operator-id` header | ✅ Done | — | `apps/web/src/middleware.ts`. Uses `@neondatabase/serverless` HTTP driver (required for Edge runtime). `OPERATOR_ID` env var short-circuits the DB lookup for single-deploy mode. |
| 3 | **`src/lib/operator.ts`:** `getOperatorId(req)` helper | ✅ Done | — | Reads `x-operator-id` header. API routes call this instead of doing a DB lookup themselves. |
| 4 | **Replace `db.select().from(operators).limit(1)`** across all API routes | ⬜ Todo | ~1 day | Every route that does `limit(1)` needs to call `getOperatorId(req)` instead. ~15 routes. |
| 5 | **Replace `process.env.STRIPE_CONNECTED_ACCOUNT_ID`** with per-operator lookup | ⬜ Todo | ~half day | Load from `operators.stripeAccountId` after resolving `operator_id`. Two callsites: `POST /api/bookings` and the Stripe webhook. |
| 6 | **Stripe webhook routing:** route by `account` field in payload | ⬜ Todo | ~1 day | Webhook currently validates against one fixed connected account. Needs to verify the `account` field against any known `operators.stripeAccountId`. |
| 7 | **Stripe Connect OAuth flow:** UI for operator to connect their Stripe account at onboarding | ⬜ Todo | ~2 days | Standard Connect OAuth (`/oauth/authorize` → redirect → token exchange → store `stripeAccountId` on operator row). |
| 8 | **Operator onboarding UI:** form to create operator row, set domain, upload logo | ⬜ Todo | ~2–3 days | Admin-only page (platform owner). Creates `operators` row, inserts into `domains`, triggers Stripe Connect OAuth. |
| 9 | **Platform owner admin panel:** view all operators, aggregate revenue, suspend accounts | ⬜ Todo | ~1–2 weeks | Separate workstream. Not a blocker for the routing plumbing. |

---

## Middleware Design (Item 2 — implemented)

See `apps/web/src/middleware.ts`. Key points:

- Next.js Edge middleware cannot use the standard `postgres` / node-postgres driver (V8 isolate, not Node.js). Uses `@neondatabase/serverless` HTTP driver instead.
- Queries the `domains` table (`WHERE domain = $hostname`) rather than `operators` directly, supporting multiple domains per operator.
- `OPERATOR_ID` env var short-circuits the DB lookup entirely — existing single-deploy deployments set this and need no other changes.
- Sets `x-operator-id` request header; API routes read it via `getOperatorId(req)` in `src/lib/operator.ts`.
- Returns 404 if the hostname is not in the `domains` table (guards against misconfigured or unknown domains).
- The DB round-trip is ~5–10ms p99 on Neon HTTP from Vercel edge. Vercel KV can cache the mapping if this becomes a concern at scale.

---

## Cost Model at Scale (Centralized)

| Operators | Tickets/mo | Platform revenue | Infra cost | Margin |
|---|---|---|---|---|
| 3 | 1,500 | $2,250 | ~$115/mo | $2,135 |
| 10 | 5,000 | $7,500 | ~$130/mo | $7,370 |
| 25 | 12,500 | $18,750 | ~$200/mo | $18,550 |

Infra grows slowly (Neon storage, Blob, Resend volume). Revenue scales linearly with tickets.

Monthly fixed baseline (platform pays): Vercel Pro $20 + Neon Scale $69 + Resend Starter $20 + Vercel Blob ~$5–20 = **~$115–130/mo**.

Break-even: ~80 tickets/month across all operators.

---

## Transition Strategy

The single-deploy model (current) and the centralized model can coexist. Set `OPERATOR_ID` as an env var on any per-operator deployment — the middleware reads it and skips the DB lookup entirely, so existing deployments keep working with zero code changes. New centralized deployments leave `OPERATOR_ID` unset and rely on domain resolution.

This means the migration is zero-downtime and backwards-compatible.
