# Native App Handoff — Status

Tracks implementation of `design_handoff_native_app/` (a Claude Design handoff for the consumer
mobile app). Work lives on branch `design/native-app-handoff`, based off `main` at `3b4ed92`.

---

## Done

Commits `7071c40`, `6886a81`, `7c92865` on `design/native-app-handoff`.

Implemented the hull-navy/orange design language (Archivo + IBM Plex Mono) across the consumer
app, scoped to what the handoff's own README marks as buildable now:

- Tab bar (BOOK / TICKETS / CONDITIONS / ACCOUNT), boat-count glyph
- Book screen — day belt, trip cards, date sheet (month grid)
- Trip sheet — fare steppers, total, hold copy
- Your Seats — multi-trip cart, correct summed total
- Pay by Card — order summary, contact fields
- Boarding Pass — real on-device QR, stub notch, offline-capable
- Tickets tab — upcoming/past segmented, next-trip countdown card
- Conditions tab — stat tiles, tide table, alerts toggle, fishing-report card (weather/tide data
  is a stub fixture — no live provider wired in; clearly labeled in code)
- Account — reskinned around the existing email-OTP flow (no Apple/phone sign-in — not built
  server-side, so not added as dead buttons)

**Deferred**, per the handoff's own cut lines — not started:
- Live Activity / Dynamic Island (native Swift widget target)
- W1–W4 waitlist subsystem (new queue/claim backend)
- C1–C2 cancellation screens (blocked on real refund-timing copy, see Open Questions below)

**Verified by actually running it** (iOS Simulator, Maestro-driven), not just typechecking — see
`git log` on the branch for the runtime bugs this caught (tab-bar active state, trip-type color
mapping, ticket capitalization, a pushed-route back-button label). Not driven end-to-end: an
actual completed Stripe charge (stopped at the native PaymentSheet boundary).

---

## Next up

1. **Fix stale native-project identity** (in progress as of this doc). The generated `ios/`/
   `android/` projects were still `com.captree.fishing` / "Captree Fishing" from before the app
   was renamed to OpenBoat Fishing, even though `app.json` already said the new name. Fixed via
   `npx expo prebuild --clean`. Not a blocker for simulator dev testing, but was a real blocker
   for TestFlight/App Store distribution under the wrong identity.
2. **Phone testing.** No paid Apple Developer account, so: plug the phone into a Mac with Xcode
   and run `npx expo run:ios --device` (free personal-team signing; install expires after 7 days,
   re-run to refresh). EAS development-profile builds (`eas.json`'s `development` profile exists
   already) are the alternative once/if a paid account exists — no cable needed, no 7-day expiry.
3. **Answer the open design questions** (below) before picking up the C1/C2 cancellation screens.
   Needs real business/ops answers.
4. **Merge `design/native-app-handoff`** into `main` (or wherever) once reviewed.
5. Longer-term, no rush: Live Activity/Dynamic Island, the waitlist subsystem.

---

---

## Open design questions

Reconstructed from `design_handoff_native_app/OPEN_QUESTIONS.md` (the handoff source directory
was deleted after this pass shipped — its still-implemented content, like `tokens.ts` and the
glyph SVG, is now baked into the app code; this section preserves what was still unresolved).
In priority order per the original doc.

### 1. Crew-side scanning and manifest — not designed
**Blocks:** launch, not the customer app. Tickets carry a scannable code, but nothing on the crew
side has been designed; the mate currently works off a printed manifest. Options: (A) same app,
role-gated fifth surface — cheapest, but a customer binary carrying operator tooling; (B) separate
crew app — clean separation, can be TestFlight-only, iPad-friendly; (C) no app — zero cost, keeps
today's failure mode. If A/B: scanning needs to work offline at the slip (cached manifest,
check-offs sync later with conflict handling). Recommendation from the handoff: C for launch, B
once volume justifies it.

### 2. Catch log as a fifth tab — discussed, not decided
**Blocks:** nothing. Only works if other people's catches are visible (a social product, not a
log) — decide the retention job first. Tab bar should stay at four; if built, it likely lives
under Conditions or inside a past ticket. Recommendation: not v1.

### 3. What "conditional" means on the 12–24h credit — narrowed
**Blocks:** C2 copy. Resolved already: full refund at 24h notice, conditional credit at 12h
notice, nothing under 12h, nothing for no-shows, full refund whenever the operator cancels. Still
open: what the credit is conditional *on* (captain's approval case-by-case, or automatic and just
non-refundable)? Does it expire (same season / one year / never)? Tied to the same trip type or
any sailing? Transferable? Redemption — self-serve at checkout (needs a new screen) or applied
manually at the dock?

### 4. Refund timing copy — needs a real number — **blocks build**
C1/C2 currently say "5–10 business days" as a placeholder. Need: the actual processor settlement
window for card refunds; separate copy if Apple Pay refunds differ; whether operator-cancelled
refunds are automatic the instant the captain calls it or need a manual button (C2's weather card
claims "went out automatically" — that promise needs an owner). Fallback if no reliable number
exists: "refunded to your original payment method" with no timing claim.

### 4b. Notice, arrival, and early departure — from the published policy
- Arrive at least 15 minutes before sailing — the boarding pass currently shows 30 minutes, which
  is stricter and probably fine, but confirm per trip type rather than a picked number.
- Sold-out trips may depart 10 minutes early — not currently on the boarding pass; should be,
  shown only when the sailing is sold out.
- "If weather is questionable, call to confirm" — the app should make the call unnecessary, but
  the dock number belongs on Conditions anyway.
- **Confirm the real dock phone number.** `(631) 555-1234` is a placeholder used in the Conditions
  screen and was also used in prior drafts for Account/cancellation surfaces — one real number,
  used everywhere.

### 5. Live Activity scope — confirm before estimating
Confirm the 8-hour system limit is acceptable for the longest trip (overnight sailings exceed it —
what shows at hour 9?). Decide the Android ongoing-notification floor and which OEMs kill it.
Fallback if this slips: in-app pass + departure push only (the README already treats this as an
acceptable v1).

### 6. Waitlist queue edge cases — rules written, not stress-tested
What happens when the head of the queue has notifications off (does the 10-minute claim burn
silently, or do they get skipped)? Can one person hold waitlist entries on two sailings the same
day? Does a non-refunded inside-24h cancellation feed the waitlist, and if the seat resells, does
the original customer get anything back?

### 7. Guest → account claim — specified, needs a rule
Signing in must claim existing local (guest) tickets. What happens when the same Apple ID signs in
on a second device that also has guest tickets — merge, or last-write-wins? Is a booking ever
reachable by phone-number lookup at the gangway (the Account screen promises the crew can find you
by name)?

---

## Known local-dev gotchas (from getting this far)

- `apps/mobile/.env.local`'s `EXPO_PUBLIC_APP_VARIANT` decides mate vs. consumer at bundle time.
  It's **not** overridable by a shell-exported env var — Expo's `@expo/env` loader treats
  `.env.local` as authoritative regardless of `process.env`. Edit the file directly to switch,
  and use `expo start --clear` after, since Metro's transform cache doesn't bust on env-var
  value changes to the same file.
- No project-level Maestro/run skill exists yet for this app. What worked: `npx expo run:ios`
  for a genuinely fresh build, then Maestro (`curl -Ls "https://get.maestro.mobile.dev" | bash`,
  no Homebrew tap/trust gate) driven against the booted simulator's UDID
  (`xcrun simctl list devices booted`). RN often concatenates all child `Text` under one
  `Pressable` into a single accessibility label, so `tapOn` selectors usually need `.*wildcards.*`
  — check `maestro hierarchy` when a selector doesn't match.
