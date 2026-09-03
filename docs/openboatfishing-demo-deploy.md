# Deploying openboatfishing.com — Demo + Production Sandbox

This site plays two roles from one deployment:

1. **Production sandbox** — real Vercel + Neon + Stripe + Resend running the same code path any paying operator will run. Used to shake out infra, DNS, cron scheduling, and webhooks before someone else's revenue depends on it.
2. **Live public demo** — a fictional operator (**MV Open Boat**) seeded with three vessels, six trip types, and schedules through 2035 so anyone can click through booking end-to-end.

Follow this checklist top-to-bottom. Everything from Step 4 onward assumes Steps 1–3 are complete.

---

## Prerequisites

- Domain `openboatfishing.com` registered (Namecheap / Cloudflare / etc.)
- GitHub account with push access to this repo
- Stripe account with Connect enabled (platform account)
- Neon account
- Vercel account
- Resend account

---

## Step 1 — Register the domain + set up Neon

- Register `openboatfishing.com` at your registrar of choice
- In Neon: create a new project (production tier, region close to your users — likely `us-east-1`)
- Copy the connection string — this becomes `DATABASE_URL`

---

## Step 2 — Set up Stripe (TEST mode)

The demo runs in Stripe test mode so anyone can book with card `4242 4242 4242 4242` without moving real money.

- In the **Stripe dashboard**, toggle to **Test mode** (top-right toggle)
- Create a Connect connected account for the demo operator:
  - Dashboard → Connect → Accounts → **Add account**
  - Type: Standard or Express (either works for test)
  - Country: US, Business type: Company (or Individual)
  - Copy the resulting `acct_test_...` ID → this becomes `STRIPE_CONNECTED_ACCOUNT_ID`
- Create a webhook endpoint (address won't exist until Step 4; that's fine, use placeholder):
  - Dashboard → Developers → Webhooks → **Add endpoint**
  - URL: `https://openboatfishing.com/api/webhooks/stripe`
  - Events to send:
    - `payment_intent.succeeded`
    - `payment_intent.canceled`
    - `charge.refunded`
    - `charge.dispute.created`
  - Copy the signing secret (`whsec_...`) → this becomes `STRIPE_WEBHOOK_SECRET`

---

## Step 3 — Set up Vercel

- Create a new Vercel project connected to this repo
  - Framework preset: **Next.js**
  - Root directory: `apps/web`
  - Build command: default (`next build`)
- Vercel Hobby plan works for this demo deployment (2 daily crons — see cron schedule below). Upgrade to Pro later to restore hourly expiry and full-day reminder coverage.
- Point DNS: add `openboatfishing.com` and `www.openboatfishing.com` in Vercel → domain settings; update your registrar's nameservers or A/CNAME records per Vercel's instructions

### Environment variables (Vercel dashboard → Settings → Environment Variables)

All in the **Production** environment. Anything marked "generate" should be created with `openssl rand -hex 32`.

| Variable                      | Value                                                       |
| ----------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`                | Neon connection string from Step 1                          |
| `SESSION_SECRET`              | generate (≥ 32 chars)                                       |
| `STRIPE_SECRET_KEY`           | Stripe test secret key (`sk_test_...`)                      |
| `STRIPE_WEBHOOK_SECRET`       | From Step 2                                                 |
| `STRIPE_CONNECTED_ACCOUNT_ID` | From Step 2 (`acct_test_...`)                               |
| `CRON_SECRET`                 | generate — used by all three cron endpoints                 |
| `RESEND_API_KEY`              | From your Resend account (production key)                   |
| `DEMO_MODE`                   | `true` — enables the banner + gates the nightly reset cron  |

`DEMO_MODE=true` is the switch that identifies this as the demo deployment. It:

- Renders the yellow "Live demo" banner at the top of every page
- Enables `/api/cron/reset-demo-data` (returns 403 otherwise)
- Enables the "Clear demo customers" button in `/admin/settings`

---

## Step 4 — First deploy + migrations + seed

Once Steps 1–3 are done and DNS resolves to Vercel:

```bash
# Deploy — either push to main or trigger a manual deploy
git push origin main

# Run migrations against the Neon prod DB (from your local machine)
DATABASE_URL="<neon connection string>" \
  pnpm --filter @openboat/db migrate

# Seed the demo operator
# IMPORTANT: save the admin password printed on first run — it is not
# printed again on re-runs.
DATABASE_URL="<neon connection string>" \
  STRIPE_CONNECTED_ACCOUNT_ID="<acct_test_... from Step 2>" \
  tsx packages/db/src/seed-demo.ts

# Seed schedules + trips through 2035-12-31 (~4,200 trip rows across 3 vessels)
DATABASE_URL="<neon connection string>" \
  tsx packages/db/src/seed-trips-demo.ts
```

**Optional overrides for the seed:**

- `DEMO_ADMIN_EMAIL` — defaults to `demo-admin@openboatfishing.com`
- `DEMO_ADMIN_NAME` — defaults to `Demo Admin`
- `DEMO_ADMIN_PASSWORD` — defaults to a random 24-char string (printed once)

**What the seed creates:**

| Entity          | Count | Notes                                                                                  |
| --------------- | ----- | -------------------------------------------------------------------------------------- |
| Operators       | 1     | MV Open Boat (`mv-open-boat`)                                                          |
| Vessels         | 3     | MV Open Boat I (24 pax), II (32 pax), Nightfall (28 pax)                               |
| Products        | 6     | Bay Fluke Half-Day, Bay Sea Bass, Full-Day Blackfish, Ocean Wreck, Night Bluefish, Night Striped Bass |
| Schedules       | 3     | Weekday mornings / weekends / Fri-Sat nights, through 2035-12-31                       |
| Trips           | ~4,200 | Materialized from schedules                                                            |
| Domains         | 2     | `openboatfishing.com` + `www.openboatfishing.com`                                      |
| Staff           | 1     | Demo admin — password printed once on first seed run                                   |

---

## Step 5 — Smoke test

Visit the site and walk through these checks.

**Anonymous booking flow:**

- [ ] Load `https://openboatfishing.com` — yellow demo banner is visible at the top
- [ ] Calendar renders with future trips available
- [ ] Pick a trip, add 2 tickets, go to checkout
- [ ] Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP
- [ ] Land on delivery/confirmation page
- [ ] Boarding pass at `/boarding/<bookingId>` renders with QR code

**Webhook check (in Stripe dashboard → Developers → Webhooks):**

- [ ] `payment_intent.succeeded` fired and delivered (200 response)
- [ ] `bookings` row transitions from `pending` → `confirmed`
- [ ] `payments` row exists with `application_fee_cents = 150 × ticket count`

**Customer wallet:**

- [ ] Log in as the demo customer email at `/account` — OTP arrives via Resend
- [ ] Ticket appears in wallet

**Admin:**

- [ ] Log in at `/admin/login` with the demo admin credentials
- [ ] Manifest shows the new booking
- [ ] Revenue page renders (may show $0 earned — expected, fees don't transition to `earned` until `settle_grace_hrs` after departure)
- [ ] Settings page shows a **Demo tools** card (only visible when `DEMO_MODE=true`)

**Cron endpoints (from your terminal):**

```bash
# Should return {"ok":true,"tripsReset":N}
curl -H "authorization: Bearer <CRON_SECRET>" \
  https://openboatfishing.com/api/cron/reset-demo-data

# Should return 401
curl https://openboatfishing.com/api/cron/reset-demo-data

# Should return 403 (only 403 if the CRON_SECRET matches but DEMO_MODE is off — sanity check)
```

After the manual cron trigger: reload `openboatfishing.com`, the calendar should show all trips at full availability again and no booking on the manifest.

---

## Ongoing behavior

**Cron schedule** (defined in `apps/web/vercel.json`):

| Endpoint                                | Schedule       | What it does                                                          |
| --------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `/api/cron/expire-pending-bookings`     | `0 2 * * *`    | Daily 2am UTC — cancels unpaid holds; legacy fallback window 90 min   |
| `/api/cron/trip-reminders`              | `0 9 * * *`    | Daily 9am UTC — sends push reminders for trips departing 8–9am next day |

> **Hobby plan limits:** max 2 cron jobs, each at most once per day. The `reset-demo-data` cron is excluded from `vercel.json`; trigger it manually (see below) or restore it on Vercel Pro. Trip reminders only cover the 8–9am departure window on Hobby — upgrade to Pro to restore hourly coverage.

**Nightly reset** (`/api/cron/reset-demo-data`) — deletes and preserves:

| Deleted                                                                     | Preserved                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `bookings`, `booking_items`, `tickets`, `payments`, `check_ins`, `trip_overrides` | `operators`, `vessels`, `products`, `product_prices`, `schedules`, `staff`, `customers`, `fishing_reports`, `capacity_changes`, `push_tokens`, `magic_link_otps`, `trips` metadata |

After delete, each trip's `seats_remaining` is restored to `trips.capacity` so the calendar is fully open the next morning.

**Manual "Clear demo customers"** (admin-only, requires `DEMO_MODE=true`):

- Path: `/admin/settings` → **Demo tools** card → **Clear demo customers**
- Runs the same wipe as the nightly cron **and** deletes all customer accounts, their push tokens, and their OTPs
- Because `bookings.customerId` is a FK to customers, booking activity has to be wiped in the same transaction

---

## Known deferrals for later

Tracked in the plan file (`~/.claude/plans/i-wanted-to-know-foamy-puffin.md`) but not blocking initial deploy:

- **Live-mode Stripe deployment** for load testing the real money path — probably as `live.openboatfishing.com` subdomain with $1 demo prices
- **Mobile app TestFlight / Play internal-testing build** — fill in `apps/mobile/eas.json` `submit.consumer.ios`, then `eas build --profile consumer && eas submit`
- **Platform marketing content** (About / Features / Pricing pages)
- **Comparison pages** (vs GoFish, vs FareHarbor) for SEO
- **ROI calculator** for prospect operators
- **Fishing reports aggregate feed** (grows into consumer aggregator once ≥ 2 operators are live)

---

## Troubleshooting

**Deploy fails at "Collecting page data" with `ERR_INVALID_URL`.**
Your `DATABASE_URL` env var is missing or invalid in Vercel. Next.js tries to construct the Postgres client at build time; without a valid URL it crashes on the first page-data pass.

**Cron endpoint returns 403 `DEMO_MODE not enabled`.**
Set `DEMO_MODE=true` in Vercel (Production environment). Redeploy — env vars only take effect on new deployments.

**Cron endpoint returns 401 `Unauthorized`.**
`CRON_SECRET` mismatch. Vercel's built-in cron sends the header automatically; if hitting it manually via curl, use `-H "authorization: Bearer <CRON_SECRET>"`.

**Seed script fails with "No operator found".**
Run `seed-demo.ts` before `seed-trips-demo.ts` — the trip seeder looks up the operator by slug (`mv-open-boat`).

**Admin login fails.**
The admin password is only printed on the first run of `seed-demo.ts`. If lost, either connect to the DB and reset the `staff.password_hash` manually, or `DELETE FROM staff WHERE email = '...'` and re-run the seed with a new `DEMO_ADMIN_PASSWORD` env var.

**Trips run out in 2035.**
Bump `SEASON_END` in `packages/db/src/seed-trips-demo.ts`, delete the existing schedule rows for the vessels (or add new ones via the admin schedule wizard), and re-run the trip seeder.
