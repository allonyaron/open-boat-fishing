# Architecture Diagrams

Two levels: **Context** (who uses the system and what it talks to) and **Container** (how the technical pieces fit together).

---

## Level 1 — System Context

```mermaid
graph TD
    C["Customer<br/>web + iOS/Android"]
    A["Operator / Admin<br/>web dashboard"]
    M["Mate<br/>tablet app"]

    P["Open Boat Fishing Platform<br/>Vercel + Neon · one deployment per operator"]

    stripe["Stripe Connect<br/>payment processing"]
    push["Expo Push Service<br/>mobile notifications"]
    twilio["Twilio<br/>SMS — planned"]

    C -->|books trips, views boarding passes| P
    A -->|manages trips, revenue, settings| P
    M -->|views manifests, scans QR codes| P

    P -->|creates payment intents, refunds| stripe
    stripe -->|webhook: payment events| P
    P -->|booking & cancellation notifications| push
    P -.->|SMS reminders| twilio

    classDef person fill:#1168bd,stroke:#0b4c8c,color:#fff
    classDef system fill:#1168bd,stroke:#0b4c8c,color:#fff
    classDef ext fill:#6b6b6b,stroke:#4a4a4a,color:#fff

    class C,A,M person
    class P system
    class stripe,push,twilio ext
```

---

## Level 2 — Container

```mermaid
graph TD
    C["Customer"]
    A["Admin"]
    M["Mate"]

    stripe["Stripe Connect<br/>payment processing"]
    push["Expo Push Service<br/>mobile notifications"]

    subgraph platform["Open Boat Fishing Platform"]
        web["Next.js Web App<br/>TypeScript · Next.js 14 · Vercel"]
        consumer["Consumer Mobile App<br/>React Native · Expo · iOS/Android"]
        mate_app["Mate Tablet App<br/>React Native · Expo · same codebase"]
        db[("Neon Postgres<br/>PostgreSQL · Drizzle ORM")]
        cron["Vercel Cron Jobs<br/>expire holds · reminders · settle fees"]
    end

    C -->|browse & book| web
    C -->|browse & checkout| consumer
    A -->|trips, manifests, revenue| web
    M -->|manifest & check-in| mate_app

    consumer -->|booking, auth, push tokens| web
    mate_app -->|manifest fetch, check-in sync| web

    web <-->|SQL / TLS| db
    cron -->|HTTPS + CRON_SECRET| web

    web -->|create intents, refunds| stripe
    stripe -->|webhook events| web
    web -->|send notifications| push

    classDef person fill:#1168bd,stroke:#0b4c8c,color:#fff
    classDef container fill:#1168bd,stroke:#0b4c8c,color:#fff
    classDef ext fill:#6b6b6b,stroke:#4a4a4a,color:#fff

    class C,A,M person
    class web,consumer,mate_app,cron container
    class stripe,push ext
```

---

## Key Architecture Decisions

| Decision | What and Why |
|---|---|
| **One deployment per operator** | No shared infrastructure. Onboard a new client by forking the repo and deploying a fresh Vercel + Neon instance. Simple ops, no cross-tenant data risk. |
| **No separate API server** | All backend logic is Next.js API routes deployed as Vercel serverless functions. Eliminates a separate service to maintain and deploy. |
| **Stripe Connect destination charges** | Funds route directly to the operator's Stripe account at charge time. Platform fee (`application_fee_amount: $1.50`) is deducted automatically. No payout logic needed. |
| **Same Expo codebase for two apps** | Consumer and mate apps share one codebase. `EXPO_PUBLIC_APP_VARIANT=mate` switches which screens are mounted. Avoids duplicating shared components. |
| **Seats locked with `FOR UPDATE SKIP LOCKED`** | Prevents double-booking without application-level counters. The DB holds the truth; no Redis or external lock needed. |
| **Email OTP auth for customers, PIN for mates** | Customers authenticate via 6-digit email codes. Mates use short PINs on a shared tablet where typing a full password is impractical. |
| **Offline SQLite wallet in consumer app** | Boarding passes survive airplane mode. Tickets sync to local SQLite at confirmation. |
| **Trip rows materialized at schedule save** | Schedules are patterns; individual `trips` rows are written immediately. Keeps the booking calendar query simple. |
