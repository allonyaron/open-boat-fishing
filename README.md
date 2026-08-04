# Open Boat Fishing — Booking Platform

Multi-tenant ticketing and check-in platform for party fishing boat operators. Each operator gets their own isolated deployment (Vercel + Neon Postgres) from this shared codebase.

**MVP client:** Captree / Blue Wave fleet — 4 boats, 2 domains.

---

## What's in the box

| App | Description |
|-----|-------------|
| `apps/web` | Next.js 14 — marketing site, booking calendar, checkout, boarding passes, API routes |
| `apps/mobile` | Expo SDK 53 — consumer booking app (trips calendar, Stripe Payment Sheet, offline tickets wallet) |
| `packages/db` | Drizzle ORM schema + migrations (shared source of truth) |

A **mate check-in app** (QR scanner, offline manifest) will be built from the same `apps/mobile` codebase using a separate EAS build profile.

---

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+ (`npm install -g pnpm`)
- **Expo CLI** (`npm install -g expo-cli`)
- **EAS CLI** (`npm install -g eas-cli`) — for mobile device builds
- **Stripe CLI** (`brew install stripe/stripe-cli/stripe`) — for local webhook forwarding
- A **Neon** Postgres database (free tier works for dev)
- A **Stripe** account with Connect enabled (platform account)
- A **Resend** account for transactional email
- An **Apple Developer account** ($99/yr) — required for iOS device builds and App Store

---

## Monorepo setup

```bash
git clone <repo>
cd open-boat-fishing
pnpm install
```

---

## Setting up a new operator

### 1. Database

Create a Neon project. Copy the connection string.

```bash
# In packages/db — run migrations against the new database
DATABASE_URL="postgres://..." pnpm db:migrate
```

Then seed development data (creates one operator row, 4 vessels, products, prices, and ~150 trips):

```bash
DATABASE_URL="postgres://..." pnpm --filter @openboat/db seed
```

> For production, replace the seed script with real operator data or use the admin dashboard.

### 2. Stripe

- Create or log in to your Stripe **platform** account.
- In Connect settings, enable **Destination Charges**.
- The operator needs their own Stripe account. Onboard them via Stripe Connect (or create a test connected account in the dashboard).
- Note the connected account ID (`acct_...`).

### 3. Web app environment variables

Create `apps/web/.env.local`:

```env
# Database
DATABASE_URL=postgres://...

# Stripe (platform account)
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...        # from `stripe listen` in dev; from Stripe dashboard in prod
STRIPE_CONNECTED_ACCOUNT_ID=acct_...  # operator's connected account

# App
NEXT_PUBLIC_APP_URL=https://yourclient.com   # used in boarding pass links in emails

# Email (Resend)
RESEND_API_KEY=re_...
```

### 4. Mobile app environment variables

Create `apps/mobile/.env.local` for local dev:

```env
EXPO_PUBLIC_API_URL=http://localhost:3001

EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Apple Pay / Google Pay
EXPO_PUBLIC_APPLE_MERCHANT_ID=merchant.com.yourclient.app
EXPO_PUBLIC_URL_SCHEME=yourclientapp
EXPO_PUBLIC_MERCHANT_NAME=Your Client Name
```

For EAS builds, set these in `apps/mobile/eas.json` under the appropriate build profile (see [Mobile builds](#mobile-builds) below).

### 5. `app.json` — per-operator mobile identity

Edit `apps/mobile/app.json` to match the operator:

```json
{
  "expo": {
    "name": "OpenBoat Fishing",
    "slug": "openboat-fishing",
    "scheme": "openboatfishing",
    "ios": {
      "bundleIdentifier": "com.openboat.fishing"
    },
    "android": {
      "package": "com.openboat.fishing"
    }
  }
}
```

Each operator needs a unique bundle ID and scheme. For a second operator, either fork the repo or use EAS build profiles to override these values.

---

## Local development

```bash
# Start everything (Turborepo — web + mobile Metro in parallel)
pnpm dev

# Or individually:
pnpm --filter @openboat/web dev        # Next.js on :3001 (or :3000)
pnpm --filter @openboat/mobile dev -- --clear   # Expo Metro on :8081

# Forward Stripe webhooks to local server (required for booking confirmation + wallet sync)
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

> **Webhook note:** booking status only transitions to `confirmed` (and tickets appear in the mobile wallet) after `payment_intent.succeeded` fires. In local dev this requires `stripe listen` running.

### Running in the iOS simulator

```bash
pnpm --filter @openboat/mobile ios
```

The app opens automatically. Use test card `4242 4242 4242 4242` with any future expiry and any CVC.

### Running on a physical iOS device

Requires an EAS development build — see [Mobile builds](#mobile-builds). The simulator build won't install on a device.

---

## Database commands

```bash
# Run migrations
DATABASE_URL="..." pnpm db:migrate

# Generate migration from schema changes
pnpm --filter @openboat/db generate

# Open Drizzle Studio (visual DB browser)
DATABASE_URL="..." pnpm db:studio
```

---

## Mobile builds

The mobile app uses [Expo EAS Build](https://docs.expo.dev/build/introduction/). Builds run in the cloud — you don't need Xcode installed for production builds, but you do need an Apple Developer account.

### Build profiles (in `apps/mobile/eas.json`)

| Profile | Purpose |
|---------|---------|
| `development` | Dev client build — installs on device, connects to local Metro for fast iteration |
| `preview` | Internal distribution (TestFlight / direct APK) — for QA and stakeholder review |
| `consumer` | App Store / Google Play production build |
| `mate` | Internal distribution — mate check-in app (future) |

### First-time EAS setup

```bash
cd apps/mobile

# Log in to your Expo account
eas login

# Link to an EAS project (creates one if needed)
eas init

# Configure credentials (Apple Developer account required for iOS)
eas credentials
```

### Building a dev client for a physical device

```bash
cd apps/mobile

# iOS device build (requires Apple Developer account)
eas build --profile development --platform ios

# Install on your device via QR code shown after build completes
# Then start Metro and the app will connect to it:
pnpm --filter @openboat/mobile dev
```

> Update `EXPO_PUBLIC_API_URL` in the `development` profile in `eas.json` to your machine's LAN IP so the physical device can reach your local web server: `http://192.168.x.x:3001`

### Submitting to the App Store

```bash
eas submit --profile consumer --platform ios
```

Fill in the Apple IDs in `eas.json` under `submit.consumer.ios` first.

---

## Deploying a new operator (production)

1. Fork this repo (or use a branch per operator — fork is cleaner for isolation)
2. Update `apps/mobile/app.json` with operator's app name and bundle IDs
3. Create a Neon project → run migrations → seed real data
4. Create a Vercel project → connect to the fork → set all env vars
5. Create an EAS project → update `eas.json` → run `eas build --profile consumer`
6. Point the operator's domain DNS to Vercel
7. Register `merchant.com.operator.app` in Apple Pay merchant registration

**Time estimate:** ~2–3 hours for web, ~1–2 hours per mobile platform.

---

## Architecture notes

- **No shared infrastructure** — every operator has their own Vercel + Neon instance. A data breach at one operator cannot affect another.
- **All backend logic lives in Next.js API routes** (`apps/web/src/app/api/`) deployed as Vercel serverless functions. No separate server.
- **Payments:** Stripe Connect Destination Charges. Operator is merchant of record. Platform fee = $1.50/ticket (`application_fee_amount: 150`).
- **Seat inventory:** PostgreSQL `FOR UPDATE` row-lock inside a transaction — race-condition-safe without application-level locks.
- **Boarding passes:** Printable web pages at `/boarding/[bookingId]`. CSS `@media print` handles layout. No server-side PDF generation.
- **Offline tickets wallet:** SQLite via `expo-sqlite` in the mobile app. Boarding pass QR works with no cell signal at the dock.

See `CLAUDE.md` for the full build order, data model, and architectural decisions.

---

## Project status

**Complete:** Web booking flow end-to-end (calendar → cart → Stripe PaymentElement → boarding passes), Stripe webhooks (`payment_intent.succeeded` + `payment_intent.canceled`), confirmation email via Resend, mobile Trips tab, mobile Tickets tab (offline SQLite wallet, offline QR boarding pass), mobile checkout (Stripe Payment Sheet + wallet sync).

**Admin dashboard complete:** Staff auth (iron-session + bcrypt), trips list with vessel colors + seat progress, one-tap trip cancellation (full/partial Stripe refund + fee reversal), trip manifest (passenger list, per-ticket refund, check-in status), revenue reporting (earned/held/reversed fees, lazy sail-signal transition), per-trip capacity edit.

**In progress:** EAS device builds, push notifications, Account tab (mobile).

**Not started:** Mate check-in app (offline manifest, QR scanner, name search, offline sync).
