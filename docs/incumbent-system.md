# Incumbent System

Reference record of the system being replaced. Used to understand migration scope and data model being inherited.

---

## Incumbent Platform

- Booking platform: `ticketmgmt.dev`, merchant ID `DSLVFD8QBSNR8`
- HAR files at project root contain the full API response shape from the incumbent — use these to understand the data model being migrated
- `captree-6-23.com.har` — calendar page with full API responses (boats, products, schedule, overrides)
- `captree_com.har` — full checkout flow
- Incumbent departure time hack: `:01/:02/:03` minute suffixes disambiguate multiple products at the same hour on the same boat — our materialized `trips` model does not need this

---

## Incumbent Booking Flow (observed from live purchase)

The full flow the client uses today. Our platform must match or improve on every step. See also `docs/captree-booking-ux-audit.md` for UX analysis.

**1. Calendar** — Month view, color-coded by boat. Each trip cell shows time + "X Left" (remaining tickets). Fish species images on each cell. Legend distinguishes "Limited Capacity" trips (show count) from open trips (no count shown). A trip only says "SOLD OUT" when fully booked.

**2. Trip detail modal** (opens over calendar) — Shows trip type, date, start time AND end time, boat name, product display name (e.g. "Sea Bass Fishing Express"), tickets available count. Ticket types (Adult/Child) each have their own quantity dropdown + individual "Add to Cart" button. After adding, inline feedback appears: "IN CART: 1 TOTAL: $65.00" with a remove icon.

**3. Cart** — Groups tickets by date/time. Shows ticket type + boat + trip + date/time, editable quantity dropdown, price per ticket, subtotal per line, grand total, terms & conditions link. Payment method choice: PayPal, Venmo, or Debit/Credit Card (separate "Add to Cart" per type means multi-trip cart is possible — buying across multiple departures in one checkout).

**4. Payment** — PayPal popup OR inline card form (email, card, expiry, CVV, billing name, ZIP, mobile phone). Phone is collected here for SMS delivery.

**5. Post-payment delivery screen** — "How Would You Like To Receive Your Tickets?" — three actions: "Print Tickets" (immediate PDF download), "Email Tickets" (pre-filled with PayPal email, editable), "Text Tickets" (phone field). Done button. This is a distinct screen, not just a confirmation page.

**6. Boarding pass PDF** — One ticket per page. Header: "CAPTREE FISHING TICKETS" (red). Fields: "Boarding Pass" + ticket type, boat name (color-coded), trip type + date/time, "Purchased By: [name]", QR code (top-right), ticket ID string at bottom (e.g. `34P33704GT014254Y-48ADULT1782860460-1`). Served from `interface.ticketmgmt.dev/info/{merchant_id}/passes/{ticket_id}`.

**7. Confirmation email** — From `office@captreefishingticket.com` via `mg.captree.com`. Subject: "Tickets Purchased". Body lists tickets ordered + "Click Here" link to download boarding passes. Includes: "If you have a problem printing your ticket (or boarding pass) This email will be sufficient for boarding." — showing the email at the gangway is an accepted fallback.

**Check-in reality:** QR codes are generated and on boarding passes but the mate currently checks people in off a printed clipboard manifest — the QR scanner is not in use yet. The boat goes out 3x/day so the manifest must be printed per departure (likely from the admin dashboard or a boat-side printer). Our PDF manifest + mate app QR scanner is a direct upgrade from the clipboard.
