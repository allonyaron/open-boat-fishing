# Architecture Diagrams

Two levels: **Context** (who uses the system and what it talks to) and **Container** (how the technical pieces fit together).

---

## Level 1 — System Context

```mermaid
graph TD
    C["Customer<br/>web + iOS/Android"]
    A["Operator / Admin<br/>web dashboard"]
    M["Mate<br/>tablet app"]
    PO["Platform Owner<br/>/platform onboarding UI"]

    P["Open Boat Fishing Platform<br/>Vercel + Neon · single-deploy OR centralized multi-tenant"]

    stripe["Stripe Connect<br/>payment processing"]
    push["Expo Push Service<br/>mobile notifications"]
    twilio["Twilio<br/>SMS — planned"]

    C -->|books trips, views boarding passes| P
    A -->|manages trips, revenue, settings| P
    M -->|views manifests, scans QR codes| P
    PO -->|onboards new operators, sets domain| P

    P -->|creates payment intents, refunds| stripe
    stripe -->|OAuth connect + webhook: payment events| P
    P -->|booking & cancellation notifications| push
    P -.->|SMS reminders| twilio

    classDef person fill:#1168bd,stroke:#0b4c8c,color:#fff
    classDef system fill:#1168bd,stroke:#0b4c8c,color:#fff
    classDef ext fill:#6b6b6b,stroke:#4a4a4a,color:#fff

    class C,A,M,PO person
    class P system
    class stripe,push,twilio ext
```

Two deployment models, same codebase (see `centralized-architecture.md` for the full breakdown):

- **Single-deploy (enterprise/white-label):** one Vercel + Neon instance per operator. `OPERATOR_ID` env var short-circuits operator resolution.
- **Centralized (platform mode):** one shared Vercel + Neon instance, many operators, hostname → `operator_id` resolved per-request via the `domains` table. New operators onboard through `/platform` (Platform Owner persona above), gated by `PLATFORM_SECRET`.

---

## Level 2 — Container

```mermaid
graph TD
    C["Customer"]
    A["Admin"]
    M["Mate"]
    PO["Platform Owner"]

    stripe["Stripe Connect<br/>OAuth + payment processing<br/>one connected account per operator"]
    push["Expo Push Service<br/>mobile notifications"]

    subgraph platform["Open Boat Fishing Platform"]
        mw["Edge Middleware<br/>hostname → operator_id<br/>domains table (Neon HTTP driver) or OPERATOR_ID env var"]
        web["Next.js Web App<br/>TypeScript · Next.js 14 · Vercel<br/>marketing + booking + admin + /platform"]
        consumer["Consumer Mobile App<br/>React Native · Expo · iOS/Android"]
        mate_app["Mate Tablet App<br/>React Native · Expo · same codebase"]
        db[("Neon Postgres<br/>PostgreSQL · Drizzle ORM<br/>all tenant tables scoped by operator_id")]
        cron["Vercel Cron Jobs<br/>expire holds · reminders · demo reset"]
    end

    C -->|browse & book| web
    C -->|browse & checkout| consumer
    A -->|trips, manifests, revenue| web
    M -->|manifest & check-in| mate_app
    PO -->|create operator + domain| web

    consumer -->|booking, auth, push tokens| web
    mate_app -->|manifest fetch, check-in sync| web

    mw -->|x-operator-id header| web
    web <-->|SQL / TLS| db
    cron -->|HTTPS + CRON_SECRET| web

    web -->|create intents, refunds| stripe
    web -->|OAuth connect/reconnect| stripe
    stripe -->|webhook events, keyed by event.account in centralized mode| web
    web -->|send notifications| push

    classDef person fill:#1168bd,stroke:#0b4c8c,color:#fff
    classDef container fill:#1168bd,stroke:#0b4c8c,color:#fff
    classDef ext fill:#6b6b6b,stroke:#4a4a4a,color:#fff

    class C,A,M,PO person
    class web,consumer,mate_app,cron,mw container
    class stripe,push ext
```

Every inbound request to `web` first passes through `mw` (`apps/web/src/middleware.ts`), which resolves `operator_id` before any route handler runs — API routes read it via `getOperatorId(req)`/`getOperatorContext(req)` (`src/lib/operator.ts`), server components via `getOperatorIdFromHeaders()`. No route does its own `SELECT operators LIMIT 1` or trusts a client-supplied operator ID.

---

## Key Architecture Decisions

| Decision | What and Why |
|---|---|
| **Single-deploy and centralized coexist** | Same codebase serves both. `OPERATOR_ID` env var short-circuits Edge middleware for per-operator deployments; unset, it resolves hostname → `operator_id` via the `domains` table. Zero-downtime, backwards-compatible migration path. |
| **No separate API server** | All backend logic is Next.js API routes deployed as Vercel serverless functions. Eliminates a separate service to maintain and deploy. |
| **Stripe Connect destination charges, OAuth-linked per operator** | Funds route directly to the operator's connected Stripe account at charge time. Platform fee (`application_fee_amount: $1.50`) is deducted automatically. `stripeAccountId` is stored per-operator and linked via an OAuth flow (`/api/stripe/connect/start` → `/callback`), not a single shared env var. |
| **Same Expo codebase for two apps** | Consumer and mate apps share one codebase. `EXPO_PUBLIC_APP_VARIANT=mate` switches which screens are mounted. Avoids duplicating shared components. |
| **Seats locked with `FOR UPDATE SKIP LOCKED`** | Prevents double-booking without application-level counters. The DB holds the truth; no Redis or external lock needed. |
| **Email OTP auth for customers, PIN for mates** | Customers authenticate via 6-digit email codes. Mates use short PINs on a shared tablet where typing a full password is impractical. Both are Postgres-backed rate-limited and operator-scoped. |
| **Offline SQLite wallet in consumer app** | Boarding passes survive airplane mode. Tickets sync to local SQLite at confirmation. |
| **Trip rows materialized at schedule save** | Schedules are patterns; individual `trips` rows are written immediately. Keeps the booking calendar query simple. |
| **Operator ID never trusted from the client** | Edge middleware resolves it once per request and injects `x-operator-id`; every API route and server component reads it from there — never from request body, query string, or a per-route DB `LIMIT 1`. |
