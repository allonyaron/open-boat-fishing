# Competitive Position

## Primary Competitor: GoFish

**GoFish (`gofish.rocks`) is a live direct competitor** in this exact segment — they publish a landing page for Long Island fishing charters, and Miss Montauk runs on them. They charge $1.50/passenger, on the operator's own domain, operator as merchant of record, free migration, no setup fee. Nearly every structural advantage this platform was designed around, they already ship. **Do not position on price or on "you keep your brand."**

## Differentiation

Two things are actually differentiated.

**1. Execution.** Their production site points at `dev-api.gofish.rocks`, does seat holds over `GET` requests that mutate inventory, and runs a half-migrated payment stack (Square 404s, Stripe loads only for fingerprinting, Authorize.net seal on the page). Our `FOR UPDATE SKIP LOCKED` seat decrement is genuinely better engineering — but that advantage only exists if we actually ship something robust.

**2. The consumer mobile app with an offline tickets wallet.** No competitor in this category — GoFish, FareHarbor, AttractionSuite, or the incumbent — ships one. Captree State Park's dock is where cell coverage is worst, and a boarding pass that won't load at the gangway is the nightmare scenario. **The booking flow is table stakes; the app is the product.** Prioritize accordingly.

## Data Portability — Structural Advantage No Competitor Can Match

FareHarbor and GoFish have no exit. An operator who leaves loses their booking history, customer records, and fishing reports. We do not have this problem.

**The pitch at signup:** *"If you ever leave, we export your data and stand up a dedicated instance for you. You own your history — customers, bookings, fishing reports, everything. ~$40/month directly to Vercel and Neon, no platform fee."*

Technically this is straightforward: every table is scoped by `operator_id`, so an export is a filtered pg dump. A fresh deployment of this repo pointed at that data is fully functional.

Use this as a closing argument when an operator hesitates. It reduces perceived lock-in risk and is something neither GoFish nor FareHarbor can credibly say.

**Offer details:**
- Include data portability in contract terms as a named right
- Charge a migration fee (2–3 hours, $300–500) or waive it for operators who have been on the platform more than one year
- The standalone deployment runs on the same codebase — no custom build needed

## Deployment Tiers

Two tiers, one codebase:

**Standard (centralized)** — operator is onboarded into the shared Vercel + Neon deployment. No infrastructure to manage. Pays monthly platform fee + $1.50/ticket flows to platform via Stripe Connect.

**Enterprise / white-label** — dedicated Vercel + Neon deployment per operator. Full data isolation, no co-branding, contractually separate infrastructure. Operators who negotiate this tier pay a higher monthly fee. Same codebase, different deployment. Position as the exit option and the large-client upsell — not the default.
