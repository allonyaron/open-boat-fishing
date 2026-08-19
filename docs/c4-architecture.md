# C4 Architecture Diagrams

Two levels: **Context** (who uses the system and what it talks to) and **Container** (how the technical pieces fit together). Level 3 (Component) and Level 4 (Code) are omitted — too granular to justify maintenance at this project size.

---

## Level 1 — System Context

Who uses the platform and what external systems does it depend on.

```mermaid
C4Context
  title System Context — Open Boat Fishing Platform

  Person(customer, "Customer", "Books fishing trips online or via\nthe iOS/Android consumer app.\nReceives boarding passes and\npush notifications.")

  Person(admin, "Operator / Admin", "Owns the fishing boat business.\nManages trips, manifests,\ncancellations, revenue, and\nall operator settings.")

  Person(mate, "Mate", "Boat crew member. Uses a tablet\nat the gangway to view the\npassenger manifest and scan\nQR boarding passes.")

  System(platform, "Open Boat Fishing Platform", "Booking, ticketing, and operations\nplatform for party fishing boats.\nOne dedicated deployment per operator\n(Vercel + Neon Postgres).")

  System_Ext(stripe, "Stripe Connect", "Payment processing.\nDestination charges route funds\ndirectly to the operator's\nStripe account minus platform fee.")

  System_Ext(expo_push, "Expo Push Service", "Delivers push notifications to\ncustomer mobile devices for\nbooking confirmations, trip\nreminders, and cancellations.")

  System_Ext(twilio, "Twilio", "SMS delivery for booking\nconfirmations and reminders.\n(Planned — not yet wired.)")

  Rel(customer, platform, "Books trips, views boarding passes,\nreceives notifications", "HTTPS / Expo push")
  Rel(admin, platform, "Manages trips, staff, schedules,\nrevenue, and settings", "HTTPS")
  Rel(mate, platform, "Views manifests, syncs check-ins,\nscans QR codes", "HTTPS")

  Rel(platform, stripe, "Creates payment intents,\nissues refunds", "REST / HTTPS")
  Rel(stripe, platform, "Delivers payment events\n(succeeded, refunded, disputed)", "Webhook / HTTPS")

  Rel(platform, expo_push, "Sends booking and\ncancellation notifications", "REST / HTTPS")
  Rel(platform, twilio, "Sends SMS reminders\n(planned)", "REST / HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

## Level 2 — Container

The internal technical building blocks and how they communicate.

```mermaid
C4Container
  title Container Diagram — Open Boat Fishing Platform

  Person(customer, "Customer", "Books via web or mobile app")
  Person(admin, "Admin", "Uses the web admin dashboard")
  Person(mate, "Mate", "Uses the tablet check-in app")

  System_Ext(stripe, "Stripe Connect", "Payment processing")
  System_Ext(expo_push, "Expo Push Service", "Mobile push notifications")

  System_Boundary(platform, "Open Boat Fishing Platform (per-operator deployment)") {

    Container(web, "Next.js Web App", "TypeScript · Next.js 14 · Vercel", "Serves the public booking calendar,\ncheckout flow, and boarding pass pages.\nHosts all admin dashboard pages.\nAll API routes run as Vercel\nserverless functions.")

    Container(consumer_app, "Consumer Mobile App", "React Native · Expo · iOS / Android", "Trip browsing, checkout, offline\nticket wallet (SQLite), email OTP\nauthentication, push notification\nregistration.")

    Container(mate_app, "Mate Tablet App", "React Native · Expo · iOS / Android\n(same codebase, EXPO_PUBLIC_APP_VARIANT=mate)", "PIN authentication, offline manifest\ncache, QR code scanner, keyboard\ncheck-in mode, real-time sync.")

    ContainerDb(db, "Neon Postgres", "PostgreSQL · Drizzle ORM", "Single database per deployment.\nHolds all operator data: trips,\nbookings, tickets, staff, customers,\nfee lifecycle, check-ins, push tokens.")

    Container(cron, "Vercel Cron Jobs", "Node.js · Vercel Cron", "Three scheduled jobs:\n• expire-pending-bookings (every 10 min)\n• trip-reminders (hourly, 23–24 h window)\n• settle-trips (daily, marks fees earned)")

  }

  Rel(customer, web, "Browses calendar, books trips,\nviews boarding passes", "HTTPS")
  Rel(customer, consumer_app, "Browses trips, manages tickets,\nchecks out", "Tap")

  Rel(admin, web, "Admin dashboard —\ntrips, manifests, revenue, settings", "HTTPS")

  Rel(mate, mate_app, "Views manifest,\nscans QR codes", "Tap")

  Rel(consumer_app, web, "API calls — booking, auth,\npush token registration", "HTTPS / JSON")
  Rel(mate_app, web, "API calls — manifest fetch,\ncheck-in sync", "HTTPS / JSON")

  Rel(web, db, "Reads and writes all\noperator data", "SQL / TLS · postgres.js")
  Rel(cron, web, "Triggers cron API endpoints\non schedule", "HTTPS · CRON_SECRET header")

  Rel(web, stripe, "Creates payment intents,\nissues refunds, reads charges", "REST / HTTPS · Stripe SDK")
  Rel(stripe, web, "Payment lifecycle events\n(succeeded, refunded, disputed)", "Webhook · HTTPS · signature verified")

  Rel(web, expo_push, "Sends notifications to\ncustomer devices", "REST / HTTPS · Expo SDK")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

## Key Architecture Decisions

These are the non-obvious choices that the diagrams don't fully convey:

| Decision | What and Why |
|---|---|
| **One deployment per operator** | No shared infrastructure. Onboard a new client by forking the repo and deploying a fresh Vercel + Neon instance. Simple ops, no cross-tenant data risk. |
| **No separate API server** | All backend logic is Next.js API routes deployed as Vercel serverless functions. Eliminates a separate service to maintain and deploy. |
| **Stripe Connect destination charges** | Funds route directly to the operator's Stripe account at charge time. Platform fee (`application_fee_amount: $1.50`) is deducted automatically. No payout logic needed. |
| **Same Expo codebase for two apps** | Consumer and mate apps share one codebase. `EXPO_PUBLIC_APP_VARIANT=mate` switches which screens are mounted. Avoids duplicating shared components (manifest, QR). |
| **Seats locked with `FOR UPDATE SKIP LOCKED`** | Prevents double-booking without application-level counters. The DB holds the truth; no Redis or external lock needed. |
| **Email OTP auth for customers, PIN for mates** | Customers authenticate via 6-digit email codes (no password to forget or reset). Mates use short PINs on a shared tablet where typing a full password is impractical. |
| **Offline SQLite wallet in consumer app** | Boarding passes survive airplane mode. Tickets sync to local SQLite at confirmation; the mate app validates QR content without a network call. |
| **Trip rows materialized at schedule save** | Schedules are patterns; individual `trips` rows are written immediately when a schedule is created. This keeps the booking calendar query simple (`SELECT * FROM trips WHERE date >= today`). |
