# C4 Architecture Diagrams

Two levels: **Context** (who uses the system and what it talks to) and **Container** (how the technical pieces fit together). Level 3 (Component) and Level 4 (Code) are omitted — too granular to justify maintenance at this project size.

---

## Level 1 — System Context

Who uses the platform and what external systems does it depend on.

```mermaid
C4Context
  title System Context — Open Boat Fishing Platform

  Person(customer, "Customer", "Books fishing trips via web or mobile app")
  Person(admin, "Operator / Admin", "Manages trips, manifests, revenue, and settings")
  Person(mate, "Mate", "Checks in passengers at the gangway using a tablet")

  System(platform, "Open Boat Fishing Platform", "Booking and operations platform. One dedicated Vercel + Neon deployment per operator.")

  System_Ext(stripe, "Stripe Connect", "Payment processing via destination charges")
  System_Ext(expo_push, "Expo Push Service", "Push notifications to customer mobile devices")
  System_Ext(twilio, "Twilio", "SMS reminders — planned, not yet wired")

  Rel(customer, platform, "Books trips, views boarding passes", "HTTPS / mobile app")
  Rel(admin, platform, "Manages trips, staff, schedules, revenue", "HTTPS")
  Rel(mate, platform, "Views manifests, scans QR codes", "HTTPS")

  Rel(platform, stripe, "Creates payment intents, issues refunds", "REST")
  Rel(stripe, platform, "Payment events: succeeded, refunded, disputed", "Webhook")
  Rel(platform, expo_push, "Sends booking and cancellation notifications", "REST")
  Rel(platform, twilio, "Sends SMS reminders", "REST")
```

---

## Level 2 — Container

The internal technical building blocks and how they communicate.

```mermaid
C4Container
  title Container Diagram — Open Boat Fishing Platform

  Person(customer, "Customer", "Web or mobile")
  Person(admin, "Admin", "Web dashboard")
  Person(mate, "Mate", "Tablet app")

  System_Ext(stripe, "Stripe Connect", "Payment processing")
  System_Ext(expo_push, "Expo Push Service", "Mobile push notifications")

  System_Boundary(platform, "Open Boat Fishing Platform") {

    Container(web, "Next.js Web App", "TypeScript, Next.js 14, Vercel", "Public booking calendar, checkout, boarding passes, admin dashboard, all API routes")

    Container(consumer_app, "Consumer Mobile App", "React Native, Expo, iOS/Android", "Trip browsing, checkout, offline ticket wallet, email OTP auth, push notifications")

    Container(mate_app, "Mate Tablet App", "React Native, Expo, iOS/Android", "PIN auth, offline manifest cache, QR scanner, keyboard check-in, sync")

    ContainerDb(db, "Neon Postgres", "PostgreSQL, Drizzle ORM", "All operator data: trips, bookings, tickets, staff, customers, check-ins, push tokens")

    Container(cron, "Vercel Cron Jobs", "Node.js, Vercel Cron", "expire-pending-bookings, trip-reminders, settle-trips")

  }

  Rel(customer, web, "Browse and book trips", "HTTPS")
  Rel(customer, consumer_app, "Browse, checkout, view tickets", "Mobile")
  Rel(admin, web, "Trips, manifests, revenue, settings", "HTTPS")
  Rel(mate, mate_app, "Manifest and check-in", "Mobile")

  Rel(consumer_app, web, "Booking, auth, push token registration", "HTTPS/JSON")
  Rel(mate_app, web, "Manifest fetch, check-in sync", "HTTPS/JSON")

  Rel(web, db, "Read and write all operator data", "SQL/TLS")
  Rel(cron, web, "Trigger scheduled jobs", "HTTPS + CRON_SECRET")

  Rel(web, stripe, "Create payment intents, issue refunds", "REST")
  Rel(stripe, web, "Payment lifecycle events", "Webhook")
  Rel(web, expo_push, "Send notifications to customer devices", "REST")
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
