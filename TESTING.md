# Manual Testing Guide

A step-by-step walkthrough of every feature in the system. Follow in order — later sections depend on data created in earlier ones.

---

## 0. Prerequisites

### Tools you need

- **Stripe CLI** — for webhook forwarding. Install: `brew install stripe/stripe-cli/stripe`
- **Expo Go** — on your phone (iOS or Android) for mobile testing
- **pnpm** — already installed if you've run this project before

### Confirm your env files exist

```
apps/web/.env.local      ← must exist with DATABASE_URL, STRIPE_*, SESSION_SECRET, etc.
apps/mobile/.env.local   ← must exist with EXPO_PUBLIC_API_URL, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
```

If either is missing, copy from `.env.example` and fill in the values.

---

## 1. Start the Dev Server

Open **three terminals** and keep them all running.

### Terminal 1 — Web + Expo

```bash
pnpm dev
```

Wait until you see both:
- `▲ Next.js` ready on `http://localhost:3000`
- `Metro waiting on exp://...` with a QR code

### Terminal 2 — Stripe webhook forwarding

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

You'll see `> Ready! Your webhook signing secret is whsec_...`

**Important:** The `whsec_...` value must match `STRIPE_WEBHOOK_SECRET` in `apps/web/.env.local`. If it doesn't match, open `.env.local`, update `STRIPE_WEBHOOK_SECRET` to the new value, and restart Terminal 1.

### Terminal 3 — leave free for commands

---

## 2. Seed the Database

If the DB is already seeded (you've run this before), skip to section 3.

Run each command from the **root** of the repo:

```bash
# 1. Main seed — creates the operator, 4 vessels, ~60 products, 157 trips
pnpm --filter @openboat/db seed

# 2. Admin user for the web dashboard
pnpm --filter @openboat/db seed:admin
# Creates: admin@example.com / password: changeme

# 3. Mate user for the check-in app
pnpm --filter @openboat/db seed:mate
# Creates: mate@example.com / PIN: 1234
```

Then visit `http://localhost:3000/status` — you should see 4 vessels, ~60 products, and a fleet grid. If you see "No operator seeded", the seed didn't run.

---

## 3. Web Booking Flow

**URL: `http://localhost:3000`**

### Step 1 — Browse the calendar

1. The homepage loads a booking calendar.
2. **Desktop:** You see a month grid on the left and "Select a date" on the right.
3. Click any date that shows colored dots (each dot = a vessel with a trip that day).
4. The right panel populates with trip cards for that date.
5. **Mobile viewport** (resize browser): the layout switches to a scrollable list grouped by date.

### Step 2 — Select tickets

1. Click any trip card → a bottom sheet opens (mobile) or the right panel expands (desktop).
2. You see: vessel name, departure–return time, available seats, ticket types with prices.
3. The **Adult** stepper starts at 1. Hit `+` to add more. Hit `−` to reduce.
4. Add a Child or Senior ticket too if you want to test multiple types.
5. Watch the **live subtotal** update at the bottom.
6. Click **"Add to cart"**.
7. A cart bar appears pinned at the bottom: "$ total / N tickets — Checkout →"

**Optional — multi-trip cart:** Navigate to a different date and add a second trip. Both appear in the cart.

### Step 3 — Checkout

1. Click **"Checkout →"** in the cart bar → goes to `/cart`.
2. You see an order summary with each trip, ticket breakdown, and total.
3. Fill in the contact form:
   - **Email** (required — use a real address so you get the confirmation email)
   - **Name** (optional)
   - **Phone** (optional)
4. Click **"Checkout →"** → goes to `/checkout` with the Stripe Payment Element.
5. Enter the test card:
   - Card number: **`4242 4242 4242 4242`**
   - Expiry: **`12/34`** (any future date)
   - CVC: **`123`**
   - ZIP: **`10001`**
6. Click **"Pay"**.
7. Stripe redirects to `/booking/delivery`.

### Step 4 — Watch the webhook fire

Switch to **Terminal 2**. Within a few seconds you should see:

```
--> payment_intent.succeeded [evt_...]
<-- [200] POST http://localhost:3000/api/webhooks/stripe
```

This confirms the booking, inserts the payment record, sends the confirmation email via Resend, and fires a push notification (if you have a device registered).

### Step 5 — Delivery screen

On `/booking/delivery` you see:
- Confirmation code (e.g. `080817`)
- Booking summary
- Three options: Print tickets / Email tickets / Text updates

### Step 6 — Boarding passes

1. Click **"Print tickets"** → opens `/boarding/[bookingId]`.
2. One boarding pass per ticket, stacked vertically.
3. Each pass shows: vessel name, trip name, date, departure/return, ticket type, QR code, confirmation code.
4. Click **"Print / Save PDF"** top-right → triggers `window.print()` — save as PDF or print.
5. **Keep this tab open** — you'll scan this QR with the mate app later.

**Note the confirmation code** — you'll need it in the mobile wallet test.

---

## 4. Admin Dashboard

**URL: `http://localhost:3000/admin`**

### Step 1 — Log in

1. Go to `http://localhost:3000/admin/login`.
2. Email: **`admin@example.com`**
3. Password: **`changeme`**
4. Click **"Sign in"** → redirects to `/admin/trips`.

### Step 2 — Trips list (`/admin/trips`)

1. You see a table of all trips with:
   - Vessel color badge + name
   - Trip name and date
   - Seat progress bar (e.g. "23/29 sold")
   - Status badge: Scheduled / Pending / Sailed / Cancelled
2. The trip you just booked should show updated seat counts.
3. Click the row for that trip → goes to the trip manifest.

### Step 3 — Trip manifest (`/admin/trips/[tripId]`)

1. You see the trip header: vessel, departure time, capacity, seats remaining, status.
2. Below that: a passenger list grouped by booking.
3. Each booking shows: customer name, email, confirmation code, total paid.
4. Each ticket row shows: ticket type, price, fee status (held/earned/reversed), check-in status.

### Step 4 — Edit capacity

1. Find the capacity line near the top (e.g. "29 seats · 6 sold").
2. Click **"Edit capacity (29)"**.
3. An inline input appears. Type a new number (e.g. `35`).
4. Click **"Save"** → capacity updates, `seatsRemaining` adjusts by the delta.
5. Try typing a number *less than* tickets sold (e.g. `2`) → you should get a validation error.

### Step 5 — Per-ticket refund

1. Find a ticket row in the manifest.
2. Click the refund icon on the right side of the row.
3. A confirmation appears. Confirm the refund.
4. In Terminal 2, you may see Stripe activity.
5. The ticket updates to show `reversed` fee status and `voided`.

### Step 6 — Revenue page (`/admin/revenue`)

1. Click **"Revenue"** in the nav → `/admin/revenue`.
2. You see summary cards: Earned / Held / Reversed (in dollars).
3. Below: a per-trip breakdown table.
4. Try the **30 / 90 / 365 day** range selector — the numbers update.

**Note:** fees show as "Held" until the trip is `sailed` and the settle grace window (48h) passes. To see "Earned" fees immediately, you'd need a sailed trip — covered in the fishing report section below.

### Step 7 — Trip cancellation

1. Go back to the manifest for your booked trip.
2. Click **"Cancel Trip"** (appears if status is not already cancelled).
3. A modal appears — optionally enter a cancellation reason (e.g. "weather").
4. Click **"Confirm Cancellation"**.
5. What happens automatically:
   - All tickets are refunded via Stripe
   - All fees reversed (`fee_status → reversed`)
   - Seats restored to inventory
   - A push notification fires to every passenger email
   - Trip status → `cancelled`
6. In Terminal 2 you'll see the refund webhook events.
7. The manifest refreshes showing all tickets as voided.

---

## 5. Fishing Reports (Admin → Public)

Fishing reports can only be posted on trips with status `sailed` or `pending_settlement`. The lazy status transition fires when the page loads *after* the trip's departure time has passed.

### Step 1 — Get a trip into sailed/pending state

**Option A (easiest):** Use Drizzle Studio to manually set a trip's `startTime` to yesterday.

```bash
pnpm db:studio
```

Open `http://localhost:4983` → find the `trips` table → find any `scheduled` trip → edit `startTime` to a past timestamp → save. Then reload its manifest page in the admin dashboard — the status transitions lazily on page load.

**Option B:** Use the seed to ensure today has a trip, wait until its departure time passes.

### Step 2 — Post a fishing report

1. Open the manifest page for a `sailed` or `pending_settlement` trip.
2. Scroll down — you'll see a **"Fishing Report"** section.
3. Fill in:
   - **Catch summary:** e.g. "Good action on fluke today, 4–8 lb fish running strong."
   - **Fish counts:** Click "Add species" → enter species (e.g. `Fluke`) and count (e.g. `23`). Add another (e.g. `Sea Bass`, `7`).
   - **Photos:** Click "Upload photos" → select an image from your computer.
4. Click **"Post Report"**.
5. A green "Saved" confirmation appears.

### Step 3 — View the public report

1. Go to `http://localhost:3000/fishing-reports`.
2. Your report appears in the list with vessel name, date, and fish counts.
3. Click it → detail page at `/fishing-reports/[reportId]` shows:
   - Fish count cards
   - Captain's catch summary text
   - Photo grid
4. Check the page title — it's built from vessel + date + fish counts (used for SEO `og:image`).

---

## 6. Consumer Mobile App

**On your phone:** open Expo Go → scan the QR code from Terminal 1.

> **If on a physical device:** `localhost:3000` won't work from your phone. Open `apps/mobile/.env.local` and change `EXPO_PUBLIC_API_URL` to your machine's LAN IP (shown in the Metro output as `exp://192.168.x.x:...`). Use `http://192.168.x.x:3000`. Then restart Metro: `pnpm --filter @openboat/mobile dev -- --clear`.

### Tab 1 — Trips

1. Opens to a month calendar with colored dots (one per vessel with trips that day).
2. Tap a date → trip cards appear below.
3. Tap a trip card → a bottom sheet slides up with ticket types and prices.
4. Adjust quantities with `−`/`+` steppers.
5. Tap **"Add to cart"** → a cart bar appears at the bottom.

### Tab 2 — Checkout (from Trips tab)

1. Tap the cart bar → checkout screen.
2. Review your order.
3. Tap **"Reserve"** → Stripe Payment Sheet slides up.
4. Enter test card **`4242 4242 4242 4242`**, expiry `12/34`, CVC `123`.
5. Tap **"Pay"**.
6. Confirmation screen appears with your booking details.
7. Ticket automatically saves to your local SQLite wallet.

### Tab 2 — Tickets (wallet)

1. Tap the **Tickets** tab.
2. Your booked trip appears as a ticket card.
3. Tap it → offline boarding pass opens with a large QR code.
4. Screen brightness boosts automatically (for dock scanning).
5. If the trip was cancelled, the ticket shows a "Cancelled" / voided state.

**Add an existing booking by code:**

1. On the Tickets tab, tap **"+"** (top right).
2. Enter the confirmation code and email from a booking you made on the web.
3. Tap **"Add"** → the booking downloads from the API and saves locally.

### Tab 3 — Account

**Sign in with OTP:**

1. Tap the **Account** tab.
2. Enter your email address → tap **"Send code"**.
3. Check your email — a 6-digit code arrives from Resend.

   > **If email doesn't arrive:** open Drizzle Studio (`pnpm db:studio`), find the `magic_link_otps` table, and read the code directly from the `otp_hash` column — actually you can't, it's bcrypt-hashed. Check your Resend dashboard instead, or use a real inbox.

4. Enter the 6-digit code → tap **"Verify"**.
5. You're signed in. Your booking history appears.

**Notification preferences:**

1. After signing in, scroll to **Notifications**.
2. Three toggles: Trip reminders / Trip cancellations / Booking confirmations.
3. Toggle one off and back on — the preference saves and registers with the server.

### Tab 4 — Reports

1. Tap the **Reports** tab (fish icon).
2. Paginated list of fishing reports (pull down to refresh).
3. Tap any report → detail screen with fish count cards, captain's notes, photo grid.
4. Scroll to the bottom → automatically loads the next page (infinite scroll).

---

## 7. Mate Check-In App

The mate app is a separate build variant from the same Expo codebase.

### Switch to mate variant

Open `apps/mobile/.env.local` and set:

```
EXPO_PUBLIC_APP_VARIANT=mate
```

Restart Metro with cache clear:

```bash
pnpm --filter @openboat/mobile dev -- --clear
```

Scan the new QR in Expo Go. The app looks different — dark header, no bottom tabs, mate-specific UI.

### Step 1 — Log in

1. Enter email: **`mate@example.com`**
2. Enter PIN: **`1234`**
3. Tap **"Sign In"**.
4. The app prefetches today's trips and their full manifests into SQLite. You'll see a brief loading indicator.

### Step 2 — Trips list

1. Today's scheduled trips appear in a list with:
   - Trip name and departure time
   - Seat count and status badge
2. Tap a trip → the full passenger manifest loads.

### Step 3 — Manifest

1. Each booking is listed with customer name, confirmation code, and number of tickets.
2. Expand a booking to see individual ticket rows.
3. Each ticket shows: type (Adult/Child/Senior), check-in status (checked in / not yet).

### Step 4 — QR scan check-in

1. Tap the **scan icon** (camera) in the header.
2. The camera opens. Point it at the QR code from the boarding pass you printed in section 3.
3. On a successful scan:
   - The ticket row updates to "Checked In ✓" with a timestamp.
   - A success sound/haptic fires.
4. Try scanning the same QR again → the app shows "Already checked in."

**Keyboard mode (for Tera HW0002 Bluetooth scanner):**

1. Tap the **keyboard icon** in the header to switch modes.
2. A hidden text input captures focus.
3. The Bluetooth scanner fires the QR payload as typed text.
4. Same check-in logic runs automatically on input.

### Step 5 — Manual check-in

1. On the manifest, find a ticket that isn't checked in.
2. Tap the ticket row → a check-in button appears.
3. Tap **"Check In"** → the row updates to checked in.

### Step 6 — Offline mode

1. Turn off WiFi on your phone (keep cellular off too if testing full offline).
2. The manifest is still readable — it's cached in SQLite.
3. Perform a QR scan or manual check-in — it queues locally.
4. Turn WiFi back on.
5. Navigate away and back (or pull to refresh) — the queued check-ins sync to the server via `POST /api/mate/checkins`.

### Step 7 — Post-trip report (mate app)

1. After a trip is `sailed` or `pending_settlement`, the manifest header shows a **"Post Report"** button.
2. Tap it → report screen opens.
3. Fill in catch summary + fish count pairs (species + number).
4. Tap **"Add photo"** → pick from your camera roll (multi-select, up to several images).
5. Tap **"Post Report"** → photos upload to Vercel Blob, report saves to DB.
6. Go back to the manifest header — button now shows "Update Report."

---

## 8. Cron Jobs

Both cron endpoints require the `CRON_SECRET` header. Get the value from `apps/web/.env.local`.

### Expire pending bookings

This cron cancels bookings that never got paid.

**To test it:**

1. Start a booking on the web (go through the cart, fill contact info, reach `/checkout`).
2. **Do not pay** — close the tab instead.
3. The booking is now `pending` in the DB with `holdExpiresAt` set 10–60 min out.
4. To force expiry without waiting, open Drizzle Studio (`pnpm db:studio`), find the booking in the `bookings` table, and set `holdExpiresAt` to a past timestamp (e.g. `2020-01-01T00:00:00Z`).
5. Trigger the cron:

```bash
curl -H "Authorization: Bearer $(grep CRON_SECRET apps/web/.env.local | cut -d= -f2)" \
  http://localhost:3000/api/cron/expire-pending-bookings
```

6. Response: `{"ok":true,"cancelled":1}` (or however many were expired).
7. What happened: Stripe PaymentIntent cancelled, seats restored, booking set to `cancelled`, push notification sent to the customer email.
8. In the admin trips list, the seat count on that trip should have gone back up.

### Trip reminders

This cron fires push notifications for trips departing in the next 23–24 hours.

```bash
curl -H "Authorization: Bearer $(grep CRON_SECRET apps/web/.env.local | cut -d= -f2)" \
  http://localhost:3000/api/cron/trip-reminders
```

Response: `{"ok":true,"tripsProcessed":N,"pushSent":N}`

To see it process a real trip, you'd need a trip whose `startTime` is between `NOW() + 23h` and `NOW() + 24h` with confirmed bookings. Otherwise it processes 0 trips (which is a valid response).

---

## 9. Stripe Edge Cases

### Declined card

1. Go through checkout normally.
2. Use card **`4000 0000 0000 0002`** instead of the success card.
3. Stripe shows a "Your card was declined" error inline.
4. The booking stays `pending` — seats are still held. The customer can retry with a different card.

### 3D Secure (authentication required)

1. Use card **`4000 0025 0000 3155`**.
2. A 3DS modal appears asking you to authenticate.
3. Click "Complete authentication" in the Stripe test modal.
4. Payment succeeds, webhook fires, booking confirmed.

### Test a refund from Stripe Dashboard

1. Go to `https://dashboard.stripe.com/test/payments` (test mode).
2. Find a payment from your test session.
3. Click it → click **"Refund"** → refund the full amount.
4. In Terminal 2 you'll see `charge.refunded` → the webhook handler voids the tickets, cancels the booking, and restores seats.

### Test a dispute

1. In the Stripe Dashboard, find a payment.
2. Click **"Dispute"** → create a test dispute.
3. Terminal 2 shows `charge.dispute.created`.
4. The webhook voids the tickets (blocks boarding) but leaves the booking as `confirmed` — outcome pending.

---

## 10. Status Page

**`http://localhost:3000/status`**

A quick sanity check that shows:
- Operator name and config
- Fleet: vessel names, colors, product counts
- Milestone checklist (some items are stale from early dev — ignore)
- Planned features list

Useful to confirm the seed ran correctly.

---

## 11. Terms Page

**`http://localhost:3000/terms`**

Public-facing terms of service page. No interaction needed — just confirm it renders.

---

## Stripe Test Cards — Quick Reference

| Scenario | Card number |
|---|---|
| Success | `4242 4242 4242 4242` |
| Decline | `4000 0000 0000 0002` |
| 3DS required | `4000 0025 0000 3155` |
| Insufficient funds | `4000 0000 0000 9995` |

All test cards: expiry `12/34`, CVC `123`, ZIP `10001`.

---

## Feature Checklist

Use this to track your walkthrough:

- [ ] Status page loads, shows 4 vessels
- [ ] Web: calendar renders, trip cards appear on date click
- [ ] Web: ticket selector opens, quantities work, subtotal updates
- [ ] Web: add to cart, cart bar appears
- [ ] Web: checkout with `4242` card succeeds
- [ ] Web: `payment_intent.succeeded` appears in Stripe CLI terminal
- [ ] Web: `/booking/delivery` loads with confirmation code
- [ ] Web: `/boarding/[bookingId]` shows boarding passes with QR codes
- [ ] Web: "Print / Save PDF" triggers print dialog
- [ ] Admin: login works (admin@example.com / changeme)
- [ ] Admin: trips list shows seat progress and status badges
- [ ] Admin: manifest shows passenger list and ticket rows
- [ ] Admin: capacity edit validates and saves
- [ ] Admin: per-ticket refund works
- [ ] Admin: revenue page loads with 30/90/365 selector
- [ ] Admin: fishing report posted on a sailed trip
- [ ] Public: fishing report visible at `/fishing-reports`
- [ ] Consumer app: trips tab loads calendar
- [ ] Consumer app: checkout with test card
- [ ] Consumer app: ticket appears in wallet after payment
- [ ] Consumer app: offline boarding pass QR visible
- [ ] Consumer app: add existing booking by confirmation code + email
- [ ] Consumer app: OTP sign-in, booking history visible
- [ ] Consumer app: notification preference toggles work
- [ ] Consumer app: reports tab shows fishing reports
- [ ] Mate app: PIN login (mate@example.com / 1234)
- [ ] Mate app: trips list loads
- [ ] Mate app: manifest shows passengers
- [ ] Mate app: QR scan checks in a ticket
- [ ] Mate app: manual check-in works
- [ ] Mate app: offline queue syncs on reconnect
- [ ] Cron: expire-pending-bookings cancels a stale booking
- [ ] Stripe edge: declined card shows inline error
