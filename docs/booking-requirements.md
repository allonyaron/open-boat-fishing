# Booking Flow Requirements

Requirements discovered by observing the incumbent flow that were not in the original architecture docs. Most are now built — this is the authoritative record of why decisions were made.

See `docs/booking-flow-spec.md` for the current as-built spec with screenshots.

---

- **End time required on trips** — display start + end time on the trip modal and boarding pass
- **Two-level product naming** — show both category ("Sea Bass") and display name ("Sea Bass Fishing Express") in UI
- **Per-type "Add to Cart"** — Adult and Child have separate quantity selectors and separate "Add to Cart" buttons; inline cart feedback ("IN CART: 1 TOTAL: $65.00") appears on the modal after adding
- **Multi-trip cart** — a customer can add tickets across multiple departures and pay in one checkout; bookings table must support this
- **Editable cart** — quantity is adjustable in the cart view; items can be individually removed
- **Terms acceptance** — "Purchasing tickets means you accept the terms and conditions" inline at cart; need a `/terms` page
- **Phone number at checkout** — collect mobile number during payment for SMS delivery (Stripe Payment Element supports this)
- **Post-payment delivery screen** — after payment succeeds, show a dedicated screen with three options: Print Now (browser print dialog on `/boarding/[ticketId]`), Email to address, Text to phone. This is separate from the confirmation page.
- **Boarding pass (printable page)** — two URL forms, one component: `/boarding/[bookingId]` (whole order, every ticket stacked — this is what the confirmation email links to) and `/boarding/[ticketId]` (single ticket; build this first, the booking page maps over it). Each ticket is one `<article>` with `page-break-after: always`. Fields: operator masthead in `operator.brand_color` (white-labeled, not hardcoded red), "Boarding pass" + ticket type, boat name color-coded from `vessels.color_hex` **and in text** (never color alone — half these print in grayscale), product display name, departs AND returns, "Purchased by" (the buyer; all tickets in an order carry the same name), QR top-right, ticket ID in monospace at the bottom as the scan-failure fallback.
- **The QR must encode a signed value, not a bare ticket ID** — a URL to `/boarding/[ticketId]` or an HMAC of the ticket ID with a per-operator secret. A guessable ID lets someone increment their own and mint a plausible pass. The mate app validates the signature offline against the cached manifest.
- **Print CSS is why this is a web page** — `@media print` sets `page-break-after: always` per pass, hides chrome, and critically sets `print-color-adjust: exact` (browsers strip background colors when printing; without it the boat-color coding vanishes on paper). Print button is `window.print()`; the browser's dialog handles Save-as-PDF. No Puppeteer, no server-side PDF.
- **A cancelled/refunded ticket must render a CANCELLED state** — the pass URL is durable and effectively public. Check ticket status on render.
- **Confirmation email is a link, not inline QR** — email sends a "click here to view boarding passes" link to `/boarding/[bookingId]`; QR is on the printable page. Include: "this email is sufficient for boarding" fallback line.
- **"Tickets Available" display logic** — some trips show remaining count (limited capacity), others just show as bookable; only show "SOLD OUT" when fully booked. Implement a `show_remaining` flag on products or trips.
- **Email domain** — configure Resend with `captreefishingticket.com` (incumbent uses `office@captreefishingticket.com`)
- **Fee presentation is operator-configurable, account-wide** — `operators.fee_bearer` (`passenger` | `operator`) and `operators.fee_display` (`itemized` | `folded`) produce four combinations. Defaults: `passenger` / `itemized` (matching GoFish). Scope is account-wide, never per-product: the fee is identical on every ticket and only its presentation varies; per-product display would make a multi-trip cart show a fee on one line and hide it on the next. Surface the setting in the pricing setup screen (where the captain is already thinking about money), not in account settings. Include a live preview: "Customer sees → $80.50".
- **Rod rental is an optional per-product ticket type** — most Captree trips include rods in the fare (one price row); long-distance trips may offer rods for an extra fee (a second row, e.g. `Passenger with rod`). Captain enables and prices it per product. Default off. No `is_addon` flag and no parent-product relationship — a rod is just another named ticket type.
- **Customer cancellation cutoff is 48 hours** before departure (`operators.cancel_window_hrs`, default 48). Inside 48h the customer's self-service cancel is closed. **The captain's manual refund has no time limit** — it is a separate, always-available admin power, not an override of the 48h rule.
- **The platform fee always reverses on cancellation** — weather, customer self-cancel, or captain discretion. No exceptions. A **no-show earns the fee** (the passenger didn't cancel; the boat sailed with the seat sold).
- **No slip/dock numbers** — Captree doesn't assign them. Boat name + boat color do the wayfinding on the pass and in reminder pushes.
