# Architecture Diagrams

Two levels: **Context** (who uses the system and what it talks to) and **Container** (how the technical pieces fit together).

---

## Level 1 — System Context

```mermaid
graph TD
    C["Customer<br/><small>web + iOS/Android mobile app</small>"]
    A["Operator / Admin<br/><small>web dashboard</small>"]
    M["Mate<br/><small>tablet check-in app</small>"]

    P["Open Boat Fishing Platform<br/><small>one Vercel + Neon Postgres deployment per operator</small>"]

    stripe["Stripe Connect<br/><small>payment processing</small>"]
    push["Expo Push Service<br/><small>mobile notifications</small>"]
    twilio["Twilio<br/><small>SMS reminders — planned</small>"]

    C -->|"books trips · views boarding passes"| P
    A -->|"manages trips · revenue · settings"| P
    M -->|"views manifests · scans QR codes"| P

    P -->|"creates payment intents · issues refunds"| stripe
    stripe -->|"webhook: payment events"| P
    P -->|"booking & cancellation notifications"| push
    P -.->|"SMS reminders"| twilio

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

    stripe["Stripe Connect<br/><small>payment processing</small>"]
    push["Expo Push Service<br/><small>mobile notifications</small>"]

    subgraph platform["  Open Boat Fishing Platform  "]
        web["Next.js Web App<br/><small>TypeScript · Next.js 14 · Vercel</small><br/><small>booking UI · admin dashboard · all API routes</small>"]
        consumer["Consumer Mobile App<br/><small>React Native · Expo · iOS/Android</small><br/><small>trip browsing · checkout · offline ticket wallet</small>"]
        mate_app["Mate Tablet App<br/><small>React Native · Expo · same codebase</small><br/><small>PIN auth · offline manifest · QR scanner</small>"]
        db[("Neon Postgres<br/><small>PostgreSQL · Drizzle ORM</small><br/><small>trips · bookings · tickets · staff</small>")]
        cron["Vercel Cron Jobs<br/><small>expire holds · send reminders · settle fees</small>"]
    end

    C -->|"browse & book"| web
    C -->|"browse & checkout"| consumer
    A -->|"trips · manifests · revenue"| web
    M -->|"manifest & check-in"| mate_app

    consumer -->|"booking · auth · push tokens"| web
    mate_app -->|"manifest fetch · check-in sync"| web

    web <-->|"SQL / TLS"| db
    cron -->|"HTTPS + CRON_SECRET"| web

    web -->|"create intents · refunds"| stripe
    stripe -->|"webhook events"| web
    web -->|"send notifications"| push

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
