# Admin Console Handoff — Status

Tracked implementation of the "Merchant" redesign handoff for the operator-facing admin console
(originally `design_handoff_admin_console/`, deleted 2026-09-26 now that all 8 screens are done and
verified — this doc is self-sufficient).

---

## Done — verified against code, 2026-09-26

All 8 of the handoff's screens shipped, across commits `145fbc6` (Phase 0/1: backend gaps + shared
chrome) through `8c7fea8` (Phase 9: Settings, final phase), plus Sign-in (this batch):

- Today (alerts, stats row, trip rows, Coming up, phone preview)
- Calendar
- Weekly schedule
- Reports (two-list layout: waiting-on-a-report / on-your-website-now)
- Money (payout banner, Earned/Held/Given back buckets)
- Settings (four cards: Your boats, Trips you sell, Your people, Your business)
- Passenger list
- Sign-in (`apps/web/src/app/admin/login/`)

Plus the full shared component kit the handoff's dialog table calls for, in
`apps/web/src/components/admin/merchant/`: `Chrome.tsx`, `DensityContext.tsx` (the Dock/Desk
toggle), and every dialog (Boat, Person, Report, Schedule, Trip, TripType).

Verified by reading the actual page/component source and diffing it against the handoff README's
copy and structure line-by-line — not just checking that files exist.

**One intentional deviation, already decided — not a gap:** the Today screen's weather alert
("small craft advisory... ") was deliberately dropped. See the comment above the `Alerts` function
in `apps/web/src/app/admin/page.tsx`: no real weather data source exists, and firing that copy off
departure time alone would show captains false safety information on days with normal weather.

**Second intentional deviation — Sign-in's "Mate" PIN option was dropped from the design.** The
spec called for a two-option segmented control (Captain/office vs. Mate PIN), but the existing
`/api/admin/auth/login` route only accepts email+password and rejects non-admin roles with 403 —
there was no PIN-based login route for the web admin, and mates already authenticate through the
separate native mobile app (see `docs/native-app-handoff-status.md`). Product decision: out of
scope for the web admin rather than building a new PIN route just for this screen. The shipped
page is the office/admin-only path — email + password, full-width `#303030` submit button, the
"Full access — schedule, money, settings." hint — with the segmented control and PIN path
skipped entirely.

`apps/web/src/app/admin/login/page.tsx` is now an async Server Component (`getOperatorRecord()` for
the operator-name subtitle) rendering `apps/web/src/app/admin/login/LoginForm.tsx` (the interactive
`"use client"` piece), reusing `Card`, `Button` (`variant="primary"`), `Input`, and `Label` from the
`merchant/` kit. Verified in a real browser via an ad hoc Playwright script (dev server +
`chromium.launch()`): empty state, invalid-credentials error state, mobile viewport, and a full
successful sign-in redirecting to `/admin`.
