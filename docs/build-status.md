# Build Status

Full narrative of what has been built per step. See `CLAUDE.md` for the current step and active blockers.

---

## Web App (Steps 1–6 — complete)

Full booking flow live end-to-end — BookingCalendar → cart → checkout (Stripe PaymentElement) → post-payment delivery screen → printable boarding passes at `/boarding/[bookingId]`. Webhooks handle `payment_intent.succeeded` (confirm booking + send Resend email + send confirmation push) and `payment_intent.canceled` (restore seats). Seat inventory uses `FOR UPDATE` row-lock inside a transaction (race-condition-safe). Confirmation email sends via Resend with ticket list, boarding pass link, and "this email is sufficient for boarding" fallback.

---

## Security Hardening (2026-08-05)

- ✅ Rate limiting on `GET /api/bookings` wallet lookup — 5 attempts/15 min per email and IP, 15-min lockout, 150ms response floor on misses (prevents brute-force of 16.7M-combination confirmation code and email-existence timing oracle)
- ✅ Auth on `POST/DELETE /api/push/register` — both handlers now require `requireCustomer` Bearer token; `customerEmail`/`customerId` sourced from verified token, not request body; DELETE scoped to token owner's email
- ✅ Orphaned pending booking cleanup — `GET /api/cron/expire-pending-bookings` runs every 10 min; cancels bookings stuck in `pending` >30 min with no payment row, cancels any open Stripe PaymentIntent, restores seats via `FOR UPDATE` re-check inside transaction (closes crash window between DB commit and PaymentIntent creation)
- ✅ Webhook idempotency — both `payment_intent.succeeded` and `payment_intent.canceled` handlers now use `SELECT … FOR UPDATE` inside their transactions so concurrent Stripe retries can't double-send emails/pushes or double-restore seats
- ✅ Webhook response timing — `sendBookingConfirmation()` extracted to helper and called via `waitUntil()` (from `@vercel/functions`); push also wrapped in `waitUntil()`; Stripe gets a 2xx immediately, background work completes after response

Full audit findings in `security-audit-2026-08-05.md`.

---

## Expo Consumer App (Step 7 — complete)

Trips tab (month calendar, vessel dots, trip cards, ticket bottom sheet, cart bar). Tickets tab (SQLite wallet, add-by-code+email, offline boarding pass QR at `/boarding/[ticketId]`, brightness boost, cancelled state). Account tab (email OTP sign-in, booking history, per-type notification preference toggles). Checkout flow (Reserve → `/checkout` → Stripe Payment Sheet → confirmation + wallet sync). Push notifications wired: cancellation push on trip cancel, booking confirmation push on webhook success, 24h reminder via Vercel cron.

**Remaining:** EAS build + store submission (configure `eas.json submit.consumer` section, then `eas submit`).

---

## Expo Mate Check-In App (Step 8 — complete)

Separate EAS build profile (`mate`, `EXPO_PUBLIC_APP_VARIANT=mate`). PIN-based staff auth (HMAC-SHA256 token, 24h expiry). Offline-first: trips list + full manifests prefetched into SQLite at login. QR scanner (expo-camera CameraView) + keyboard mode (hidden TextInput for Tera HW0002 Bluetooth scanner). Check-in events queue locally and sync when online (`POST /api/mate/checkins` with ON CONFLICT DO NOTHING idempotency). Manual check-in per ticket. useFocusEffect syncs queue and refreshes counts on every screen focus. Timezone fix: client sends local date as `?date=YYYY-MM-DD` to avoid UTC midnight edge cases.

**Native module setup resolved:** `expo-linking`, `react-native-safe-area-context`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-screens` all installed at SDK 53-compatible versions. `metro.config.js` has a custom `resolveRequest` to force singleton resolution of these packages (pnpm virtual store otherwise bundles duplicates, causing "Tried to register two views with the same name" crash).

---

## Database (Migration 0003)

Added `magic_link_otps` (6-digit OTP for customer sign-in) and `push_tokens` (Expo push tokens with per-device notification prefs) tables. `customers.firstName/lastName` made nullable to support OTP-only sign-in without a name.

---

## Admin Dashboard (Step 9 — complete)

- ✅ Staff auth (iron-session + bcrypt, `/admin/login`, `/api/admin/auth/*`)
- ✅ Trips list (`/admin/trips`) — vessel color, seat progress, status badges, cancel modal
- ✅ Trip cancellation (`POST /api/admin/trips/[tripId]/cancel`) — full/partial refund, fee reversal, seats restored, cancellation push sent to all passengers
- ✅ Trip manifest (`/admin/trips/[tripId]`) — passenger list, ticket types, check-in status, per-ticket refund
- ✅ Per-ticket refund (`POST /api/admin/tickets/[ticketId]/refund`) — exact $1.50 fee reversal via `applicationFees.createRefund()`
- ✅ Webhook stores `applicationFeeId` + `stripeTransferId` from charge (needed for exact fee reversal)
- ✅ Lazy sail-signal transition (`lib/settle-trips.ts`) — `scheduled→pending_settlement→sailed`, tickets `held→earned`
- ✅ Revenue reporting page (`/admin/revenue`) — earned/held/reversed summary cards + per-trip breakdown with 30/90/365-day range selector; settlement runs on every page load
- ✅ Per-trip capacity edit (inline on manifest page, validates ≥ tickets sold, shifts seatsRemaining by delta)

---

## Fishing Reports (Step 10 — complete)

Captain posts a report after each trip. One report per trip (unique constraint on `trip_id`). Only postable when trip status is `sailed` or `pending_settlement`.

**Schema (migration 0007):** `fishing_reports` table — `catch_summary` (text), `fish_counts` (jsonb `[{species, count}]`), `photo_urls` (text[]), FKs to trips/vessels/staff/operators, indexes on `operator_id` and `vessel_id`.

**API routes:**

- `POST/GET /api/mate/trips/[tripId]/report` — JWT Bearer auth (mate + admin); upserts on the `trip_id` unique constraint so re-posting updates rather than errors
- `POST/GET /api/admin/trips/[tripId]/report` — iron-session auth for the web dashboard; same upsert logic
- `GET /api/reports` — public, paginated (cursor on `created_at`), optional `vesselId` filter
- `GET /api/reports/[reportId]` — public detail
- `POST /api/reports/upload` — Vercel Blob client-side `handleUpload` for web admin photo uploads
- `POST /api/reports/upload-photo` — server-side Blob `put()` accepting raw image body for native (mate) app uploads

**Web admin:** Report form added to the trip detail page (`/admin/trips/[tripId]`). Catch summary textarea, fish count pairs (add/remove), photo upload via Vercel Blob with thumbnail grid. Loads existing report on mount; submit either creates or updates. Requires `BLOB_READ_WRITE_TOKEN` env var.

**Marketing site (SSR + ISR):** `/fishing-reports` (list, 20/page) and `/fishing-reports/[reportId]` (detail). `revalidate = 300` (5 min ISR). `generateMetadata` on detail page builds title from vessel + date + fish counts and sets `og:image` from first photo.

**Mate app:** Post-trip report screen at `/(mate)/report/[tripId]`. Same form as web — catch summary, fish count pairs, photo picker via `expo-image-picker` (library access, multi-select, 0.8 quality). Photos upload to `/api/reports/upload-photo` as raw body with `Content-Type` and `X-Filename` headers. "Post Report" button appears on the manifest screen header when `trip.status === 'sailed' || 'pending_settlement'`.

**Consumer app:** Reports tab added (4th tab, fish icon). Paginated `FlatList` with pull-to-refresh and infinite scroll. Detail screen at `/report/[reportId]` with fish count cards, captain's report text, photo grid.

**Known gaps:** `BLOB_READ_WRITE_TOKEN` must be added to Vercel env before photo upload works in production.

---

## Booking Flow Backlog — Deferred (post-Batch 3)

These items were scoped during the booking-flow UX review but deferred beyond Batch 3 (items 14–18).

**Item 19 — Magic-link account creation at confirmation.** After a successful payment, prompt on the confirmation screen to create an account (magic link, no password). The purchase is complete so there's zero conversion risk. On return, a recognized email + saved Stripe payment method enables one-tap rebooking. Pairs with the "Book this trip again" deep link in post-trip email.

**Item 20 — Post-purchase passenger name capture ("Who's coming?").** Add a name-entry step on the confirmation screen. Ticket 1 pre-fills with purchaser name; remaining tickets get name + optional age fields for children. Form stays editable from the booking link. 24h-out reminder email includes a one-tap link to fill in stragglers. Once names are known, print them on passes so the mate reads rather than types. Depends on Item 19 (account link) for the edit-after-purchase flow, and on COI requirements from the captain before marking required vs. optional.
