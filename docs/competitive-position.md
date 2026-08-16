# Competitive Position

## Primary Competitor: GoFish

**GoFish (`gofish.rocks`) is a live direct competitor** in this exact segment — they publish a landing page for Long Island fishing charters, and Miss Montauk runs on them. They charge $1.50/passenger, on the operator's own domain, operator as merchant of record, free migration, no setup fee. Nearly every structural advantage this platform was designed around, they already ship. **Do not position on price or on "you keep your brand."**

## Differentiation

Two things are actually differentiated.

**1. Execution.** Their production site points at `dev-api.gofish.rocks`, does seat holds over `GET` requests that mutate inventory, and runs a half-migrated payment stack (Square 404s, Stripe loads only for fingerprinting, Authorize.net seal on the page). Our `FOR UPDATE SKIP LOCKED` seat decrement is genuinely better engineering — but that advantage only exists if we actually ship something robust.

**2. The consumer mobile app with an offline tickets wallet.** No competitor in this category — GoFish, FareHarbor, AttractionSuite, or the incumbent — ships one. Captree State Park's dock is where cell coverage is worst, and a boarding pass that won't load at the gangway is the nightmare scenario. **The booking flow is table stakes; the app is the product.** Prioritize accordingly.
