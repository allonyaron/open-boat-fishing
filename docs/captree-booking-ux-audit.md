# OpenBoat Fishing — Booking UX Audit & Mobile Flow

Senior product design review. Target user: 45–65, booking on an iPhone, average tech comfort. Optimizing for mobile conversion and low abandonment.

---

## Competitor teardown

Six references, read for the patterns worth stealing.

**FareHarbor** (industry conversion leader, ~65% of its bookings are mobile). Two mechanics matter for us. First, a *reservation timer* that holds seat capacity for ten minutes while the customer completes checkout, with a visible countdown — this is how they prevent the "sold out at the payment screen" failure during peak booking. Second, they keep the customer on the operator's own URL through the entire flow rather than bouncing to a branded checkout, because staying on-site preserves trust and lifts conversion. They also lean on single-checkout combos (multiple items, one payment) — exactly our multi-trip cart requirement. Their booking form is a stepped, segmented flow rather than one long page.

**Incumbent (`your-domain.com/ticketmgmt`, merchant `DSLVFD8QBSNR8`)** — the thing we're replacing. The live calendar page is a JavaScript-gated month grid, color-coded by boat (Blue Wave = blue, Express = red), with species imagery on cells and a "limited capacity shows a count / otherwise no count / SOLD OUT only when full" display rule. The surrounding page carries a wall of policy text (cancellation windows, tipping norms, weather cancellations) that our flow should surface contextually rather than dumping up front. The delivery model is the one we're keeping: a printable boarding pass web page served per ticket ID, and a confirmation email that links to passes rather than embedding a QR, with an explicit "this email is sufficient for boarding" fallback. Its ugliest hack — `:01/:02/:03` minute suffixes to disambiguate same-hour trips — is a data-model workaround our materialized `trips` schema removes entirely.

**Helen H Sportfishing** (`helen-h.com`, booking via `booking.attractionsuite.com`) — the upmarket version of Captree, and the most structurally instructive of the four. Eight vessels, three departure harbors (Hyannis, Plymouth, Barnstable), and a catalog spanning a 6-hour flounder trip to a 3-day giant fluke hunt at $760. Three findings matter:

- *Their checkout is a hosted off-domain redirect.* "BOOK NOW!" punts the customer to `booking.attractionsuite.com/Attraction/ec/selectTourDate.action?sid=…` — a Java Struts action with a session ID in the query string and no Helen H branding in the URL. The engine blocks automated inspection, so this is read from the URL structure and the vendor's own marketing, not the live flow. AttractionSuite's stated differentiator is financial rather than experiential: <cite index="25-1">they transact through the operator's own account with verified processing companies, so all processed money goes straight to that account</cite> — the same Merchant-of-Record posture we get from Stripe Connect destination charges, except we deliver it on the operator's own domain.
- *Trips span days, not hours.* A 22-hour canyons tuna trip departs 10 PM and returns ~8 PM the next day; the 2-day runs 33 hours; the extended version 40 hours. Our `trips` table stores `start_time` + `end_time`, so the data survives — but a month-grid *cell* cannot render "6/10–6/12," and `(schedule_id, departure_date)` as a unique constraint cannot express a trip occupying three departure dates.
- *Add-ons are a first-class product.* Every trip lists rod rental as a separate priced line — $5 inshore, $20 offshore, $40 on tuna trips for the specialized tackle, included on striped bass. Our `product_prices` models Adult/Child/Senior; it has no concept of "Adult ticket + optional rod." That's where FareHarbor's attach-rate revenue lives.

Also: capacity *is* their marketing. Trip names carry "Limited," "Ultra Limited," "Low-Capacity," and the copy states exact caps (12, 14, 15, 25, 28, 38 passengers). Scarcity is the product differentiator, not a UI afterthought — which validates our `show_remaining` flag but suggests it's under-powered.

One caution on borrowing from them: Helen H sells $180–$760 trips to anglers who plan months ahead and will read eight minutes of copy. Captree sells $79 tickets to families deciding that morning. Their dense wall-of-text schedule page works for their buyer and would sink ours. Take the data model, not the page.

**Bounty Hunter Sportfishing** (`fishbountyhunter.com`) — a live FareHarbor deployment, and the single most useful reference of the five because it shows the pattern rather than describing it. Three boats (31–60 ft), three departure locations (Fairhaven MA, South Yarmouth, Newport RI), <cite index="34-1">public trips from $135 and private charters up to 47 anglers</cite>.

*The modal is the whole lesson.* "Book Now" opens a FareHarbor overlay **without leaving the operator's domain**. The embed URLs expose exactly how:

```
Hero CTA:  /embeds/book/fishbountyhunter/items/calendar/?full-items=yes&flow=1319288
Per-trip:  /embeds/book/fishbountyhunter/items/602295/calendar/?ref=fishbountyhunter.com&branding=yes
Footer:    /embeds/book/fishbountyhunter/?ref=fishbountyhunter.com&flow=1319288
```

Read those closely. `flow=1319288` is a Booking Flow ID — the segmented, stepped checkout FareHarbor configures per operator. `branding=yes` and the `ref` param carry the operator's identity *into* the modal so it renders in their colors. And critically, the per-trip embed deep-links to a **single item's calendar** (`items/602295/calendar/`), meaning the CTA next to a trip description opens that trip's availability directly — not a generic month grid the customer then has to navigate. Three CTAs, three different entry depths, one checkout. That's the architecture to copy.

This is the direct contrast with Captree's `ticketmgmt.dev` and Helen H's `attractionsuite.com`, both of which redirect off-domain. Bounty Hunter is the same underlying rented checkout, but *embedded* — and it reads as the operator's own site. Our advantage over Bounty Hunter is narrower than over the other two: not "we keep you on-domain" (FareHarbor already does) but "it's genuinely ours, and the mobile app is ours too."

*Two content patterns worth stealing.* Every trip card carries a scannable spec line — price-from, duration, max anglers — before any prose: "From $160 · All Ages · 8 Hours · 18 Anglers Max." That's the decision data a booker needs, rendered as an icon row, above the fold. And <cite index="34-1">their pricing is explicitly all-inclusive: no charge for rod rentals, tackle, or fish bags</cite>, stated as a selling point — with the <cite index="34-1">honest caveat that gratuities (15–20% industry standard) and fish cleaning are extra</cite>. That's the opposite of Helen H's à-la-carte rod rental, and it's a *cleaner* answer to the add-ons question in section 6: if Captree can absorb extras into the ticket price, the schema problem disappears and the pitch improves. Bounty Hunter also uses limited capacity as the core brand promise — <cite index="34-1">"Limited Load" means sailing with less than half the people of a traditional party boat, with strict limits from 12 up to 35</cite>. Same scarcity-as-differentiator as Helen H.

**GoFish (`gofish.rocks`, live at `missmontauk.com`) — not a reference to borrow from, but the company we are building against.** Everything above is an operator renting a checkout. GoFish *is* the checkout vendor, purpose-built for fishing charters, and its pitch is our pitch almost word for word: on the operator's own domain, operator is merchant of record, no percentage cut, money lands in the operator's account. It is the closest thing to a direct competitor in this document, and it targets our exact segment — they publish a landing page titled "booking software for Long Island fishing charters," and Captree is a Long Island headboat.

We have a live booking-flow HAR (`missmontauk_com.har`) — the real API, not marketing. What it shows:

- *Pricing: $1.50 per passenger, and the operator does not pay it.* The `gettripConvFee` endpoint returns exactly `{"convenfee": 1.50}`. On a $130 ticket the customer pays $135.20 — a $130 fare plus a 4% add-on that breaks down as $1.50 GoFish fee + $3.70 card processing. The operator nets the full $130; the passenger absorbs the fee. This is the model to copy *as a default* — fee as a checkout line item on the customer, not a deduction from the operator — though we make it operator-configurable (section 7). It also means price competition on the fee is nearly pointless — under pass-through neither party feels $1.50 vs. $1.00.
- *Add-ons are just a second ticket type.* Miss Montauk's rod rental is modeled as a ticket named "Person with rod" at +$10 alongside "Person" at $130 — same `tickets` array, same shape, no separate entity. This collapses the section 6 add-ons question entirely: `product_prices` does not need an `is_addon` relationship, only arbitrary named types, which it already supports. Helen H's à-la-carte rods and Bounty Hunter's all-inclusive bundle are both just pricing choices on top of the same primitive.
- *Their trip schema is richer than ours in three places.* It carries `durationDay/Hr/Min` (multi-day handled as a duration on the trip, not a spanning calendar entity — a cleaner answer than section 6's spanning-bar idea), `boardingTime` distinct from `departTime` (06:30 boarding vs. 07:00 depart — a field we lack and need), and `onlineCutOffTime` / `defaultDepositPercentage` for booking cutoffs and deposits. Worth mirroring.
- *Capacity and load are in the payload.* `totalTicket: 45`, `totalBookedSeat: 32` per trip. This is the volume data we lacked — see the revenue note below. Caveat: the capture is a forward-looking snapshot (booked-so-far on future trips), not final loads.

*The critical finding is that the product is not good.* Miss Montauk's production site points at `dev-api.gofish.rocks` and `dev-resos.gofish.rocks` — a live business running against a dev environment. Seat holds are done over `GET` requests that mutate inventory (`TripEventTempInsert?...&seats=27`); held seats come back as an unsorted comma-delimited string (`"1,10,11,12,13,18,2,..."`); a `CheckBadEgg` validation sends email and phone as query params on a `PUT`. The frontend is Angular-era jQuery/Bootstrap 3. Payment is visibly mid-migration: Square.js 301s and 404s, Stripe.js loads but only fires fraud fingerprinting, and the page shows an Authorize.net seal. So the category is commoditized but the incumbent build is fragile — the opening is reliability and speed, and our `FOR UPDATE SKIP LOCKED` seat decrement is genuinely better engineering than what runs Miss Montauk today. That opening is only defensible if we actually ship something more robust; it is not defensible on price.

**Airbnb Experiences** (mobile inspiration). The transferable move is the *persistent bottom-anchored price + CTA bar*: on a phone the price stays pinned to the bottom of the viewport at all times and the primary action ("Reserve") is always one thumb-tap away, no scrolling to find it. Their 2025 flow also emphasizes transparent all-in pricing with no surprises and the fewest possible steps to confirmation. Instant-book listings get a more prominent Reserve button and convert better purely on reduced step count — a reminder that every screen we remove is worth more than any screen we polish.

The through-line: **fewer steps, price always visible, capacity honestly shown, and never leave the operator's brand.**

**A correction to the earlier read.** Before Bounty Hunter, the pattern looked like "every party-boat operator rents an off-domain checkout" — Captree via `ticketmgmt.dev`, Helen H via `attractionsuite.com`, two for two. Bounty Hunter and GoFish both falsify that. Bounty Hunter rents FareHarbor but stays on-domain in a branded modal; GoFish is a same-segment vendor that is on-domain by design. So the real split is not *own-domain vs. rented* — it's **modern (embedded/branded/on-domain) vs. legacy (redirect to a vendor URL)**. Captree's incumbent and Helen H are legacy. Bounty Hunter and GoFish are modern.

That sharpens the competitive position and makes it uncomfortable. Against Captree's incumbent and Helen H, "you keep your customer and your brand" is a genuine differentiator. Against a FareHarbor operator or a GoFish operator it is not — they already have it, and GoFish delivers it for $1.50 on the passenger with zero setup cost and free migration. On the booking flow alone, we do not beat GoFish on price or on parity of features; we can only beat them on execution, because their build is fragile (dev environment in production, seat holds over GET, a half-migrated payment stack).

So what we actually offer, stated honestly:

- **A booking flow that works** — robust seat locking, a real payment integration, not a dev API in production. This is an execution advantage, not a structural one, and it has to be earned in the build.
- The **consumer mobile app** with an offline tickets wallet, published under the operator's name. Neither FareHarbor nor GoFish ships this. It is the one thing in the plan no competitor has.
- The **mate check-in app** — an offline QR scanner replacing the clipboard manifest.

The booking flow is table stakes; at best we out-execute a shaky incumbent on it. **The app is the product** — it is the only thing here a competitor cannot already do for less.

---

## Complete workflow diagram

*(Rendered as the interactive diagram in the chat — reproduced here in text for the doc.)*

```
1. Calendar landing ........................ BUILT → rebuild mobile-first
2. Day view / trip list .................... BUILT → rebuild mobile-first
3. Ticket selector (Adult/Child) ........... PARTIAL → rebuild as bottom sheet
       └─ "Add another trip?" → loops to step 1 (multi-trip cart)
4. Cart (edit qty, terms, total) ........... MISSING
5. Checkout details (email, phone) ......... MISSING
6. Payment element ......................... MISSING
7. Confirm + issue tickets (webhook) ....... MISSING
       └─ Confirmation email (link to passes) MISSING
8. Delivery screen (print/email/text) ...... MISSING
9. Boarding pass (printable, QR) ........... MISSING
```

The honest read: the **entire money-handling half of the funnel (steps 4–9) does not exist yet.** Steps 1–3 exist but are desktop-first, and we've accepted rebuilding them rather than patching. So the practical status of every step in this diagram is "to be written" — which is freeing, because it means the mobile flow in section 2 can be designed as a whole rather than reverse-engineered onto three existing screens.

---

## 1. Friction audit — top 5, ranked by conversion impact

Ranked by how many bookings each one silently kills for a 50-year-old on an iPhone.

**Framing note.** The built screens are not sacred — we're willing to discard them for a better flow. That changes what this section is *for*. Items 1–3 are real defects worth fixing in any version. Items 4 and 5 are not patches to apply; they are **mistakes not to repeat in the rebuild**, and the mobile flow in section 2 already designs around them. Read the audit as a list of things the new calendar and ticket sheet must not do.

The rebuild permission also resolves a tension the original draft papered over. The desktop trip modal (a right-hand summary panel beside a left-hand trip card) and the mobile flow (a bottom sheet over a day list) are *different interaction models*, not one responsive layout. Rebuilding lets us design the mobile flow first and let desktop be the adaptation — the correct order when ~65% of bookings are mobile.

**1. The checkout error screen is a dead end (screen-checkout.png) — HIGHEST IMPACT**
"Something went wrong / Missing cart or customer info" with only a "Back to calendar" link. This is a conversion catastrophe for two reasons. It throws the user all the way back to the start — losing their entire cart — for what is almost certainly a recoverable state (a dropped session, a refresh, a back-button). And the copy blames the system without telling the user what to do. A 50-year-old who hits this assumes *they* broke something and abandons. Fix: never hard-fail to a dead end. Preserve cart state in the URL/session, and if truly empty, the screen should say "Your cart is empty — here are today's trips" with the trips *right there*, not a link away.

**2. The ticket selector shows two "$79" prices and two zero-steppers with no running total (screen-trip-modal.png) — HIGH IMPACT**
The right-hand summary panel says "No tickets added yet" and the button reads "Select tickets" while disabled. A retiree booking for a family cannot tell, at a glance, what they'll pay. The incumbent's inline "IN CART: 1 TOTAL: $65.00" feedback — which the modal currently lacks — is doing real work: it confirms the tap registered and shows the money. Right now, tapping "+" changes a number from 0 to 1 with no dollar feedback and no cart confirmation. Fix: live subtotal that updates on every tap, and replace "No tickets added yet / Select tickets (disabled)" with an active running total.

**3. Adult and Child are both $79 with identical presentation — the price architecture reads as a bug — MEDIUM-HIGH IMPACT**
On the modal, "Adult $79 · 13+" and "Child $79 · 5–12" are the same price. Whether or not that's intentional for this trip, showing two identically-priced tiers with no visible reason makes a non-technical user hesitate ("did I pick the wrong one? will I be charged twice?"). Hesitation at the ticket-type step is where families stall. Fix: if child pricing genuinely equals adult for a product, either collapse to a single "Passenger" type or add a one-line reason ("same price, used for the manifest headcount"). Never show two identical prices without explanation.

**4. The calendar's empty days are indistinguishable from unselectable days (screen-home.png, screen-home-mobile.png) — MEDIUM IMPACT — *rebuild constraint, not a patch***
Days with trips show a small "trips" pill; days without are greyed. But the greyed days (1, 3, 8, 10…) look almost identical in weight to bookable days, and the pill just says "trips" with no count or time. On mobile at 390px this is a lot of near-uniform cells to parse. The incumbent at least shows time + "X Left" per cell. Our cell hides the two things that drive the decision: *what time* and *how many left*. Fix: put the earliest departure time on the cell ("7 AM +2 more"), and visually harden the difference between bookable and unavailable days (bookable = full contrast + subtle boat-color dot; unavailable = clearly recessed).

**5. "Select tickets →" as a disabled dead button is a confusing affordance — LOWER IMPACT — *rebuild constraint, not a patch***
A disabled button that looks tappable but does nothing, sitting under "No tickets added yet," reads as broken to someone who doesn't intuit disabled states. Older users frequently tap disabled buttons repeatedly and conclude the site is down. Fix: either hide the CTA until there's something in the cart, or keep it visible but label the blocker inline ("Add at least one ticket to continue") so the *why* is obvious. In the rebuilt flow this element disappears entirely — the pinned bottom bar becomes the live subtotal and the CTA at once (section 2, step 3).

---

## 2. Ideal mobile booking flow, step by step

Design principles carried throughout: **price pinned to the bottom bar at all times; one primary action per screen; every screen recoverable; native pickers over custom controls.**

**Step 1 — Calendar (landing).**
User sees a month grid, current month, days-with-trips at full contrast with the earliest departure time and a boat-color dot; unavailable days clearly recessed. Tapping a day slides in the day view. *Key decision:* show time on the cell, not just a "trips" pill — time is the single strongest booking signal for a day-tripper, and it lets people scan for "morning vs. afternoon" without opening anything.

**Step 2 — Day view (trip list).**
A vertical list of that day's departures. Each row: product display name ("Sea Bass Fishing Express"), start–end time, boat name in its color, price-from, and a capacity signal ("29 left" only when limited; "SOLD OUT" only when full; otherwise nothing). Tapping a trip opens the ticket sheet. *Key decision:* full start *and* end time on every row — fishing trips run 4–5 hours and "back by when" is a genuine purchase question for families and older customers.

*Borrowed from Bounty Hunter:* lead each row with a scannable **spec line** before any prose — `From $79 · 5 Hours · 29 Left`. Price, duration, capacity, as an icon row. That's the decision data; the trip description is secondary. Their trip cards do this and it's why they scan in a second.

*Also borrowed — a structural gap in our flow.* Bounty Hunter's per-trip CTA deep-links straight to that item's calendar (`items/602295/calendar/`), not to a generic month grid. Our flow currently assumes one entry point: land on the calendar, pick a day, pick a trip. But a customer arriving from a Google result for "sea bass trip Captree" or from a marketing page for one product should land on **that product's availability**, pre-filtered, not on a month grid they must navigate. This needs a route — `/trips/[productSlug]` opening the day view filtered to that product — and it should exist before launch, because it's the entry point paid traffic and SEO both use.

**Step 3 — Ticket sheet (bottom sheet, not full page).**
Slides up over the day view. Trip summary at top (name, boat color, departs–returns, "29 tickets available"). Adult / Child steppers, each with its price and age range. A **live subtotal updates on every tap**, shown in the pinned bottom bar as "Add to cart · $158". *Key decisions:* bottom sheet keeps the day list visible behind it, so adding tickets across trips feels continuous; the stepper uses large 44px+ targets; the bottom bar shows the money before they commit.

**Step 4 — "Added" → continue or add more (the multi-trip fork).**
After adding, the sheet confirms inline ("In cart: 2 Adult · $158") and offers two paths: "Add another trip" (dismisses sheet, back to calendar/day view with cart badge incrementing) or "Go to cart". *Key decision:* make the multi-trip loop explicit and cheap — a family often books two departures in one day. The cart badge in the header is the persistent thread tying the loop together.

**Step 5 — Cart.**
Tickets grouped by date/time. Each line: type, boat, trip, date/time, editable quantity stepper, per-line subtotal. Grand total pinned bottom. Inline terms acceptance ("Purchasing means you accept the terms") with the terms one tap away in a sheet, not a navigation-away. Remove-per-line. *Key decision:* editing quantity here must not require re-entering the trip — the stepper lives in the cart line itself.

**Step 6 — Checkout details.**
Minimal: name, email, mobile phone (labeled "for your ticket by text"). That's it — no account creation required to buy. *Key decision:* phone is collected here, framed as a *benefit* (get your pass by text), not as a data grab. Guest checkout only; account is optional and offered *after* purchase.

**Step 7 — Payment (Stripe Payment Element).**
One UI, all methods: card, PayPal, Venmo, Apple Pay, Google Pay. Apple Pay should surface first for iPhone users — it's the lowest-friction path for the target demographic who may not want to type a card number on a phone. A reservation-style hold on the seats during this step (FareHarbor's pattern) prevents the sold-out-at-payment failure. *Key decision:* wallet-first ordering; total and trip summary stay visible above the payment fields so nobody pays without seeing what they're buying.

**Step 8 — Delivery screen ("How would you like your tickets?").**
Distinct screen after success — *not* the confirmation page. Three actions: Print, Email (pre-filled, editable), Text (pre-filled from checkout phone). On mobile this is where the app diverges from web (see section 4). *Key decision:* keep it a dedicated screen because the moment of "I have my tickets, now how do I keep them" is a discrete job; burying it in a confirmation page loses people who then email support asking where their tickets are.

**Step 9 — Boarding pass.**
Printable web page, one ticket per page, boat name color-coded, departs–returns time, "Purchased by" name, QR top-right, ticket ID at the bottom. CSS `@media print` handles the download via the browser's Save-as-PDF. *Key decision:* the pass is a durable URL (`/boarding/[ticketId]`) so the emailed link, the texted link, and the in-app pass all point to the same artifact.

---

## 3. Consumer mobile app scope — what makes it worth downloading

The web flow already covers browse-and-buy. A downloaded app has to earn its home-screen slot with things a website structurally cannot do. Prioritized by customer value vs. build effort.

**Tier 1 — high value, low-to-moderate effort (build first):**

- **Tickets wallet (offline boarding pass).** The single best reason to download. Passes live in-app, wallet-style, and render *without signal* — Captree State Park's dock is exactly where cell coverage is worst, and a boarding pass that won't load at the gangway is the nightmare scenario. This alone justifies the app for repeat customers. Effort: moderate; reuses the boarding-pass data, adds local cache.
- **Push: trip reminders.** "Your Sea Bass trip departs at 7:01 AM tomorrow — arrive 15 min early at Captree State Park." Reduces no-shows (which the operator can't refund and hates) and adds real convenience. Effort: low once push infra exists. Note Captree doesn't assign slips, so the boat name and its color do the wayfinding — "look for Blue Wave Express" *is* the direction.
- **Push: weather/cancellation alerts.** The incumbent's policy text says they try to give 12 hours' notice on weather cancellations, currently by phone/email. A push is faster and higher-open-rate. High operator value. Effort: low; needs an admin trigger.

**Tier 2 — high value, moderate effort:**

- **One-tap rebook / "my trips" history.** Repeat party-boat customers fish the same trip repeatedly. "Rebook Sea Bass" pre-filling the last order is a genuine convenience the web can approximate but the app does best with stored identity. Effort: moderate.
- **Saved payment (via Stripe).** Skip re-entering card for repeat buyers. Effort: moderate.

**Tier 3 — nice-to-have, defer:**

- Species/fishing-report feed, catch photos, tide tables. Engagement candy that deepens the brand but doesn't drive bookings. Build only after Tier 1–2 prove retention.

**Explicitly out of scope:** anything cross-operator. Each app is white-labeled and single-tenant; no shared marketplace, no aggregate views.

The download pitch in one line: *"Your tickets work at the dock even with no signal, and we'll remind you before you sail."*

---

## 4. Post-purchase experience — Print / Email / Text

**Web delivery screen.** After payment succeeds, a dedicated screen: heading "How would you like to receive your tickets?", three equally-weighted cards — Print (opens the boarding pass page, triggers the browser print dialog), Email (address pre-filled from checkout, editable, "Send"), Text (phone pre-filled, "Send"). A "Done" action below. Confirmation details (order number, trips) sit at the bottom so the screen doubles as a receipt without being *labeled* as the confirmation. The three options are not either/or — a user can do all three.

**Wireframe (web):**
```
┌─────────────────────────────────────────┐
│  ✓ Payment complete                      │
│  How would you like your tickets?        │
│                                          │
│  ┌────────┐  ┌────────┐  ┌────────┐      │
│  │ Print  │  │ Email  │  │  Text  │      │
│  │  🖨     │  │ ✉      │  │  💬    │      │
│  │[Print] │  │[you@..]│  │[631..] │      │
│  │        │  │ Send   │  │ Send   │      │
│  └────────┘  └────────┘  └────────┘      │
│                                          │
│  Order #48213 · 2 tickets · Sea Bass     │
│  Thu Jul 2, 7:01 AM · Blue Wave Express  │
│                              [ Done ]     │
└─────────────────────────────────────────┘
```

**How mobile changes the flow.** In the app, the boarding pass already lives in the wallet — so "receive tickets" is largely *already solved* the moment payment clears. The mobile delivery screen therefore inverts: the primary action becomes **"View my tickets"** (opens the in-app wallet pass), and Email/Text demote to a secondary "Also send to…" row for the customer who wants a backup or is buying for someone else. Print effectively disappears on mobile (nobody prints from a phone at the dock; the QR *is* the pass). So:

- **Web:** three co-equal options, print-forward.
- **Mobile app:** "View my tickets" primary → wallet; "Also send to email/text" secondary; no print.

This matches how the demographic actually behaves: the web buyer at home may want a paper backup; the app buyer at the dock wants the QR on their screen.

### Boarding pass spec (`/boarding/[…]`)

The artifact both delivery paths point at. Two URL forms, one component:

- **`/boarding/[bookingId]`** — the whole order, every ticket stacked. This is what the confirmation email's "view boarding passes" link opens.
- **`/boarding/[ticketId]`** — a single ticket. Build this first; the booking page is a `.map()` over it.

Each ticket is one `<article>` with `page-break-after: always` — one ticket, one sheet.

**Fields, top to bottom.** Operator masthead (brand color from `operator.brand_color`, not hardcoded red — this is white-labeled); "Boarding pass" label + ticket type (Adult/Child); boat name color-coded from `vessels.color_hex` **and rendered in text**, never color alone; product display name ("Sea Bass Fishing Express"); departs *and* returns times; "Purchased by" (the buyer — four tickets from one order all carry the same name, matching the incumbent, since the manifest is a headcount not an identity check); QR top-right; ticket ID in monospace at the bottom as the human-readable fallback when a scan fails.

**The QR must encode a signed value, not a bare ID.** Either a URL to `/boarding/[ticketId]` or an HMAC of the ticket ID with a per-operator secret. A guessable sequential ID lets someone increment their own and mint a plausible pass. The mate app validates the signature offline against the cached manifest. Cheap now, painful once passes are in the wild.

**Print CSS is the whole reason this is a web page** (and why `CLAUDE.md` can say no Puppeteer, no PDF generation):

```css
@media print {
  .boarding-pass { page-break-after: always; }
  .boarding-pass:last-child { page-break-after: auto; }
  header, nav, .app-chrome, .print-button { display: none; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { margin: 0.5in; }
  body { background: #fff; }
}
```

`print-color-adjust: exact` is the non-obvious one: browsers strip background colors when printing to save ink, so without it the masthead and boat-color band vanish on paper and the color-coding you rely on is gone. The delivery screen's Print button is just `window.print()`; the browser's dialog handles Save-as-PDF, so no PDF is ever generated server-side.

**Three edge cases.** A refunded or cancelled ticket must render a "CANCELLED" state rather than a valid-looking pass — the URL is durable and effectively public, so check ticket status on render. Grayscale printing is common in this demographic, so every color cue needs a non-color twin (boat name in text handles this). And on mobile the same data renders as the in-app wallet pass, not this page — build the data layer once, two views on top.

**Resolved: no slip numbers.** Captree doesn't assign slips, so no field on the pass, no column on `vessels` or `trips`. The boat name and its color carry the wayfinding at the dock.

---

## 5. Accessibility flags — 50-year-old, iPhone, average tech comfort

**Calendar:**
- Bookable vs. unavailable days must differ by more than a grey tint — the current contrast gap is too subtle and fails for aging eyes and anyone with mild color-vision deficiency. Add a non-color cue (weight, a dot, or a border) so "can I book this day" never relies on color alone.
- The "trips" pill and boat-color dots must not encode critical info in color only. Pair every boat color with its name in text (which the design already does elsewhere — enforce it on the calendar too).
- Touch targets on day cells need to be a comfortable 44px+; a grid of small cells on a 390px screen is a mis-tap generator for less-precise taps.

**Ticket selector:**
- Stepper +/- buttons must be 44px+ with clear pressed states — older users need unambiguous feedback that a tap registered. The current small circular steppers are borderline.
- Never rely on a disabled button to communicate "you're not ready." Replace with an inline reason ("Add a ticket to continue"). Disabled-and-silent reads as broken.
- The live subtotal must be large and high-contrast — this is the number that reassures a nervous buyer, so it can't be small grey text.

**Checkout:**
- Use native iOS input types: `type="email"`, `type="tel"`, `autocomplete` for name/email/phone so iOS surfaces the right keyboard and autofill. This single change removes enormous friction for slow typists.
- Apple Pay first in the payment order — it sidesteps card entry entirely for the exact demographic least comfortable typing card numbers on glass.
- Error messages must be specific and recoverable, in plain language, next to the field — never a full-screen "Something went wrong" (see friction #1). The target user reads a system error as their own fault.
- Don't force account creation. A required signup before purchase is a top abandonment cause for this age group.
- Body text and labels at 16px minimum (also prevents iOS input-zoom); adequate line spacing; nothing critical below 16px.

---

## 6. Schema questions raised by competitors

These are data-model decisions with UX symptoms. The Miss Montauk HAR resolved several that were open when this section was first drafted against Helen H; the resolutions are noted inline.

**Add-ons — resolved: model them as ticket types, no new relationship needed.** The open question was whether `product_prices` needs an `is_addon` / parent-product relationship. The GoFish HAR answers it: Miss Montauk's rod rental is simply a second ticket type ("Person with rod" at +$10 beside "Person" at $130), same `tickets` array, no separate entity. So `product_prices` needs only arbitrary named types, which it already supports.

**Rods — resolved: optional per-product, captain-controlled.** An earlier draft framed this as an operator-level choice ("does Captree want à-la-carte or all-inclusive?"). That was a false binary. It's a **per-product** switch: most Captree trips include rods in the fare (one price row, `Passenger $79`); long-distance trips can offer rods for an extra fee (two rows, `Passenger $79` / `Passenger with rod $99`). Same operator, both models, simultaneously — which is exactly what Helen H does, with rod price varying $5/$20/$40 by trip type. Default off. No schema change required.

*Deferred UI question:* whether rods render as a second stepper (GoFish's way — simple, free from the data model) or as a checkbox on a single "Passenger" stepper (cleaner for the buyer, needs the UI to know a price row is an add-on). Decide when building the ticket sheet. Note it collides with the collapse rule below: a product with `Passenger $79` / `Passenger with rod $99` has differing prices, so it won't collapse, and the buyer sees two steppers where one plus a checkbox would read better.

**Ticket type collapse — resolved: a display rule, not a data rule.** When every active price row for a product carries the same price (Captree's Adult and Child are both $79), the ticket sheet renders a single "Passenger" stepper instead of two identical ones — resolving friction #3. The `product_prices` rows still exist in the database; the captain may diverge them next season and the UI adapts with no migration. Logic: if `DISTINCT(price)` across a product's active rows is 1, collapse. Tickets written under a collapsed product use the default type, and the boarding pass reads "Passenger" rather than "Adult."

*Unverified assumption:* collapsed products count everyone as one type on the manifest. If Coast Guard or insurance rules require children broken out regardless of pricing, this is wrong. Captain question.

**Capacity — resolved: per-trip, captain-controlled.** Capacity is not a vessel property. The same hull runs 45 on a full-day and 30 on a limited-capacity trip — Miss Montauk does exactly this, and Helen H's entire product line ("Limited," "Ultra Limited") is built on it. `CLAUDE.md` already places capacity on `schedules`, which materializes onto each `trips` row; that's correct as written. Two things follow: a materialized trip's capacity must be editable **without re-materializing the schedule** (the captain drops Saturday by 5 seats), and capacity must never be settable below tickets already sold — validate loudly. Dev seed uses **29**.

**Multi-day trips — resolved approach: duration fields on the trip, not a spanning calendar entity.** The open question was how to represent a trip that occupies several dates. GoFish's schema shows the clean answer: `durationDay` / `durationHr` / `durationMin` on the trip itself, so a 33-hour trip is one row with `durationDay: 1`, not three calendar entries. Adopt this instead of the spanning-bar idea drafted earlier. Captree's day-trips all have `durationDay: 0`; the field costs nothing now and unlocks Helen-H-style multi-day later. The only remaining UI question is how a multi-day trip renders on a month grid — deferred until an operator actually needs it.

**Boarding vs. departure time — add `boarding_time`.** GoFish carries `boardingTime` (06:30) separate from `departTime` (07:00). Our `trips` table has start/end but no boarding time, and "be at the dock by" is exactly the information an anxious first-time booker and the reminder push both need. Add it.

**Booking cutoff and deposits — mirror `onlineCutOffTime` and `defaultDepositPercentage`.** GoFish supports per-trip online booking cutoffs and partial deposits (Miss Montauk runs 100% deposit, i.e. pay-in-full, but the field exists). Deposits are likely out of scope for $79 day-trips but in scope the moment an operator sells a $760 overnight. Worth a nullable column now.

**Fee presentation — add `fee_bearer` and `fee_display` to `operators`.** Two enums (`passenger` \| `operator`, and `itemized` \| `folded`) express the four fee-presentation combinations in section 7. Add the columns now with defaults `passenger` / `itemized`; the admin toggle can wait for operator #2.

**Departure location (`vessels` has no such column).** Helen H departs from three harbors. Captree is one state park today — but the hierarchy `operators → vessels` has no `departure_location`, and adding one is trivial now and structural later. Recommend adding it regardless.

**`show_remaining` is under-powered.** Helen H puts capacity in the *product name* ("Ultra Low-Capacity"). Our flag is boolean and lives on the trip. If an operator's differentiator is scarcity, they need capacity language in the product description too — a display-string field, not just a count toggle.

---

## 7. Fee model and pricing, from the GoFish HAR

Grounded numbers, with their limits stated plainly.

**Fee model: $1.50 per passenger, only on trips that sail — with pass-through to the customer as the default, not the only option.** GoFish charges $1.50 (`convenfee: 1.50`), adds it to the passenger's total rather than deducting from the operator, and bills only realized trips. Match the amount and the pay-on-sail posture. Don't undercut to $1.00: under pass-through the operator doesn't pay the fee, so they won't feel the difference, and pricing below a fragile incumbent signals weakness in a category where the operator's real fear is reliability, not cost.

**Fee presentation is an operator setting, not a platform decision.** "Who bears the fee" and "how it's shown" are independent, giving four combinations. The captain chooses:

| Setting | Customer sees | Operator nets (per $130) | Notes |
|---|---|---|---|
| Pass-through, itemized | $130.00 + $1.50 line | $130.00 | GoFish default. Most transparent. Our default. |
| Pass-through, folded | $131.50 flat | $130.00 | Captain raises sticker to cover the fee. One clean number. |
| Absorbed, hidden | $130.00 flat | $128.50 | Operator eats it out of margin. |
| Absorbed, itemized | $130.00, fee shown as covered | $128.50 | Rare — only if advertising "we cover fees." |

Two enum columns on `operators` express all four: `fee_bearer` (`passenger` \| `operator`) and `fee_display` (`itemized` \| `folded`). Everything else derives.

**Scope is account-wide, not per-product — decided.** The fee is identical on every ticket; only its presentation varies. Per-product display would produce an incoherent multi-trip cart (one line itemizing a $1.50 fee, the next folding it invisibly) — exactly the hesitation trigger friction #3 warns about. One operator, one presentation, every trip.

**Placement: surfaced during price setup, not buried in account settings.** The captain meets the choice where he's already thinking about money — the first time he sets a trip price — and it applies everywhere thereafter. Two radio groups plus a live preview, because a captain needs to *see* what the customer will see:

```
Booking fee ($1.50/passenger)
  ( ) Show as a separate line at checkout
  ( ) Fold into my ticket price

  Preview:  Customer sees →  $80.50
```

**Two constraints on this feature.** First, a compliance caveat to verify before launch (not a blocker, and not legal advice): itemized pass-through touches surcharge and fee-disclosure rules in some states. The safe pattern — which GoFish follows — is to call it a booking/convenience fee rather than a card surcharge, apply it regardless of payment method, keep it a flat amount rather than a percentage of the card total, and disclose it before payment. Folded pricing sidesteps all of this, since a price is just a price. Second, a refund rule: **folded ⇒ always refund the full displayed amount on cancellation.** Don't claw a hidden fee out of a price the customer thinks is just the ticket.

**Recommendation for MVP:** add both columns now with defaults of `passenger` / `itemized`; hardcode Captree's captain's preference at launch and expose the admin toggle at operator #2, who will have a different opinion. Multi-tenant in code, single-tenant in config — the pattern `CLAUDE.md` already commits to.

**This breaks the current Stripe plan and must be decided before payment code.** `CLAUDE.md` specifies `application_fee_amount: 250` taken at charge time via destination charges. A "$1.50 only when the boat sails" model can't take the fee at charge time — every weather cancel becomes a fee reversal. Two paths: (a) keep `application_fee_amount`, reverse on cancellation — simple to build, messy at volume; or (b) drop `application_fee_amount`, let the full charge land with the operator, track sailed tickets in our DB, and invoice monthly — more code, but it matches the promise and mirrors GoFish. This decision touches `bookings`, `tickets`, and the webhook, and it follows directly from the cancellation policy (fee kept only on trips that sail). **Settlement mechanics are specified separately in the fee decision doc; this section covers only what the customer sees.**

**Load factor — the booking curve, which does inform the build.** The Miss Montauk HAR (captured Jul 10 for trips Jul 11–31) shows a steeply late booking curve: the T-1 trip sat at 71% while everything beyond a week was under 30%. Two design consequences follow, and they're the only reason this data matters here. Seat-hold and reservation-timer mechanics are worth less than assumed — nobody races for a seat three weeks out, so FareHarbor's countdown pattern solves a problem Captree may not have. And same-day / next-day push notifications for half-empty trips are worth more, because that's when the seats actually move.

*Revenue projections have been removed from this document.* They rested on extrapolating one competitor's boat over three forward-looking weeks, they don't inform any build decision, and a labeled estimate that nobody can verify is worse than an honest gap. Volume and capacity are business-planning questions for whenever the captain is reachable — they change nothing about what gets built.

---

## Priorities, in order

Revised given the built screens can be discarded, and given GoFish is a live direct competitor.

1. **Decide the fee mechanism** (section 7) — `application_fee_amount` + reversals, or full charge to operator plus monthly invoicing on sailed tickets. This blocks all payment code and follows directly from the "keep the fee only if it sails" policy. Highest-priority decision in the project.
2. **Add the small schema fields the GoFish HAR surfaced** — `boarding_time`, `duration_day/hr/min`, nullable `online_cutoff` and `deposit_percentage`. Cheap now, structural later, and the add-ons question is already resolved (ticket types, no new relationship). This is a short task, not the client conversation the earlier draft implied.
3. **Build the missing half well.** Cart → checkout → payment → delivery → boarding pass don't exist. Against GoFish this is table stakes we must out-execute, not a differentiator — robust seat locking and a real payment integration are the point, since their production build runs on a dev API with seat holds over GET.
4. **Ship the offline tickets wallet — this is the actual product.** It's the one thing no competitor (FareHarbor, GoFish, the legacy vendors) offers. Everything else is parity; this is the reason the app exists and the reason an operator picks us over a cheaper, adequate GoFish.
5. **Rebuild the calendar and ticket sheet mobile-first**, to the section 2 spec, rather than patching the desktop-first screens. The desktop modal and the mobile bottom sheet are different interaction models; designing the phone flow first is correct when most bookings are mobile. Friction #2, #4, and #5 evaporate in the rebuild.
6. **Never ship the error dead-end (friction #1).** Whatever replaces `screen-checkout.png` must preserve cart state and offer a path forward.
7. **Add the per-product deep-link route** (`/trips/[productSlug]`) before launch — the entry point paid traffic and SEO land on.
8. **Resolve the identical Adult/Child pricing** display question with the client — a data question with a UX symptom. Handled for now by the collapse rule (section 6).
