# Admin Console Handoff — Status

Tracks implementation of `design_handoff_admin_console/` (the "Merchant" redesign handoff for the
operator-facing admin console).

---

## Done — verified against code, 2026-09-26

7 of the handoff's 8 screens shipped, across commits `145fbc6` (Phase 0/1: backend gaps + shared
chrome) through `8c7fea8` (Phase 9: Settings, final phase):

- Today (alerts, stats row, trip rows, Coming up, phone preview)
- Calendar
- Weekly schedule
- Reports (two-list layout: waiting-on-a-report / on-your-website-now)
- Money (payout banner, Earned/Held/Given back buckets)
- Settings (four cards: Your boats, Trips you sell, Your people, Your business)
- Passenger list

Plus the full shared component kit the handoff's dialog table calls for, in
`apps/web/src/components/admin/merchant/`: `Chrome.tsx`, `DensityContext.tsx` (the Dock/Desk
toggle), and every dialog (Boat, Person, Report, Schedule, Trip, TripType).

Verified by reading the actual page/component source and diffing it against the handoff README's
copy and structure line-by-line — not just checking that files exist.

**One intentional deviation, already decided — not a gap:** the Today screen's weather alert
("small craft advisory... ") was deliberately dropped. See the comment above the `Alerts` function
in `apps/web/src/app/admin/page.tsx`: no real weather data source exists, and firing that copy off
departure time alone would show captains false safety information on days with normal weather.

---

## Not done — Sign-in screen (screen 8 of the handoff)

`apps/web/src/app/admin/login/page.tsx` is still the pre-redesign page — navy/gold branding, plain
email+password form. None of the Merchant redesign's sign-in screen was built.

This was never scheduled, not missed: there is no "Phase 2" commit anywhere in history, and Phase 9
(Settings) is explicitly labeled "(final phase)" in its own commit message. The 9-phase plan simply
never included a sign-in redesign.

**Full design spec**, copied here from `design_handoff_admin_console/README.md` section "8. Sign
in" so this doc is self-sufficient once that directory is deleted:

> Full-screen `#1a1a1a` overlay, centered white card (380px, radius 16px, padding 24px,
> `box-shadow: 0 10px 40px rgba(0,0,0,0.4)`).
>
> "Open Boat" 14px/700 + operator name 13px `#616161`. A two-option segmented control on `#f1f1f1`:
> **Captain or office** (email + password) and **Mate** (PIN only, 20px text,
> `letter-spacing: 8px`, numeric input mode). Error: bg `#fee9e8`, fg `#8e1f0b`, radius 8px. Submit
> is a full-width 46px `#303030` button that reads "Signing in…" while busy. Hint under it: office
> = "Full access — schedule, money, settings."; mate = "A mate only sees who's aboard and checks
> them in."

Relevant API grounding (also from the handoff): `POST /api/admin/auth/login`, `/logout`,
`GET /me` for session.

**Open question the spec doesn't resolve:** the existing `/api/admin/auth/login` route only accepts
email+password and rejects non-admin roles with 403 — there is currently no PIN-based login route
for the web admin. Mates already authenticate through the separate native mobile app (see
`docs/native-app-handoff-status.md`). Implementing the "Mate" segmented option as designed would
need either a new API route, or a product decision that it's out of scope for the web admin (mates
have their own app already) and the control should just be dropped down to the office/admin path
alone.

## Next up

1. Decide whether the "Mate" PIN option belongs on the web admin's sign-in screen (see open
   question above) — this determines whether a new API route is needed or the design simplifies to
   admin-only.
2. Implement the redesigned `/admin/login` page per the spec above, reusing the existing
   `apps/web/src/components/admin/merchant/` kit (`Card`, `Button`, `Input`) for visual consistency
   with the rest of the redesigned admin.
3. Verify in a real browser session — static typecheck doesn't catch rendering/UX bugs.
4. Delete `design_handoff_admin_console/` once this lands and is verified. Everything else in that
   handoff is already implemented and verified (see "Done" above) — no need to re-review it.
