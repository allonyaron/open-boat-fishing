# Check-in Flow — How to Read the Sequence Diagram

Read this alongside `checkin-flow-sequence.md`.

---

## The Participants (columns)

```
M        →  Mate           (the deckhand / dock worker using the app)
App      →  Mate App       (the React Native app running on the mate's phone)
DB       →  SQLite         (local database stored ON THE DEVICE — not the server)
API      →  API Routes     (Next.js serverless functions on the server)
PG       →  Postgres       (the server database — the canonical source of truth)
```

**This diagram has two databases.** That is the most important thing to understand before reading any of the arrows.

- `DB` = **SQLite on the mate's phone**. Every read and write to `DB` is happening locally, without a network request. This is what makes the app work offline.
- `PG` = **Postgres on the server**. Every read and write to `PG` requires the phone to have a network connection.

When you see `App->>DB`, the phone is talking to itself.
When you see `App->>API` or `API->>PG`, data is going over the network.

---

## Arrow Types

**Solid `->>` ** — active request or command.

**Dotted `-->>`** — reply or response.

**Self-arrow `X->>X`** — internal computation. `App->>App` means the app is doing something internally — UI logic, state updates, data lookups in memory — with no external call.

**`alt` block** — a conditional branch (if/else). The condition is written at the top of the block. `else` separates the branches. `end` closes it. Exactly one branch runs.

**`loop` block** — a repeating sequence. Runs once per item in the loop condition at the top.

---

## Section 1 — Login

The mate authenticates with email and PIN. A short-lived token is returned that the app uses for all subsequent API calls.

1. **`M->>App`** — Mate opens the app and types their email and PIN into the login screen.

2. **`App->>API: POST /api/mate/auth { email, pin }`** — The app sends credentials to the server. This requires a network connection — login cannot happen offline.

3. **`API->>DB: checkRateLimit("mate-auth:<email>", 5, 15min)`** — Note: even though `DB` is labeled as SQLite in this diagram's legend, the rate limit is stored server-side in Postgres. Think of this arrow as "the API checks the server database for rate limit state." The labeling here is a diagram shorthand; the rate limit record is not on the device. Limit: 5 attempts per 15 minutes per email address.
   - The Note says: returns `429` with `Retry-After` if exceeded.

4. **`API->>PG: SELECT staff WHERE email = ? AND operatorId = ? AND active = true`** — The API looks up the staff record. The `active = true` filter means deactivated accounts are rejected before the PIN is even checked.

5. **`PG-->>API: staff row (includes pinHash)`** — Postgres returns the record including the bcrypt hash of the PIN. *(dotted — reply)*
   - The Note says: returns `401` if the staff row isn't found or the role isn't allowed.

6. **`API->>API: bcrypt.compare(pin, pinHash) — constant-time`** — Self-arrow. The submitted PIN is compared against the stored hash using bcrypt's constant-time comparison function.
   - The Note says: returns `401` if the PIN is incorrect.

7. **`API->>API: signMateToken({ staffId, operatorId, role, name, aud:"mate", exp:+24h })`** — Self-arrow. A JWT is created with:
   - `aud:"mate"` — the audience claim that prevents customer tokens from being used here
   - `exp:+24h` — the token expires after 24 hours (a shift's length)

8. **`API-->>App: { token, name, role }`** — The token is returned to the app. *(dotted — reply)* The app stores this in memory and includes it as a `Bearer` header on every subsequent API request.

---

## Section 2 — Trips Screen (on every focus)

This is the sync cycle that runs every time the mate navigates to the trips screen. It does two things in order: flush any locally queued check-ins to the server, then pull fresh data from the server.

**Phase A — Push queued check-ins first**

1. **`App->>DB: getCachedTrips`** — The app reads the locally cached trip list from SQLite. This is instant.

2. **`DB-->>App: cached trip list`** — SQLite returns what's cached. *(dotted — reply)*

3. **`App-->>M: show trips immediately (offline-safe)`** — The mate sees trip data right away, before any network calls complete. *(dotted — UI render)* Even if the phone has no signal, the last-known trip list is visible.

4. **`App->>DB: getUnsyncedCheckIns`** — The app reads any check-in events that were recorded locally but haven't been sent to the server yet.

5. **`DB-->>App: queued events`** — SQLite returns the unsynced queue. *(dotted — reply)*

6. **`App->>API: POST /api/mate/checkins`** — The app sends the queued events to the server in a batch.

7. **`API->>PG: INSERT checkIns ON CONFLICT DO NOTHING`** — The server inserts each check-in. `ON CONFLICT DO NOTHING` is the server-side idempotency guard — if a check-in for the same ticket was already recorded (e.g. from a different device or a duplicate sync), the duplicate is silently ignored.

8. **`PG-->>API: results per event`** — Postgres returns one result per event: success, `ticket_voided`, or `ticket_not_found`. *(dotted — reply)*

9. **`API-->>App: ok / ticket_voided / ticket_not_found`** — The server's response tells the app whether each queued event was accepted. *(dotted — reply)*

10. **`App->>DB: markCheckInSynced or markCheckInError`** — The app updates each queued event in SQLite to reflect the server's verdict.

**Phase B — Pull fresh data from server**

11. **`App->>API: GET /api/mate/trips`** — The app requests the current trip list from the server.

12. **`API->>PG: SELECT trips + vessels + checkin counts`** — The server queries Postgres for trips with their check-in totals.

13. **`PG-->>API: trip rows`** — Postgres returns the data. *(dotted — reply)*

14. **`API-->>App: trip list`** — The app receives fresh trip data. *(dotted — reply)*

15. **`App->>DB: cacheTrips`** — The fresh data is written to SQLite, replacing the stale cache.

**The `loop each trip` block**

This inner loop runs once per trip. For each trip, the app pulls the full passenger manifest:

```
loop each trip
    App->>API: GET /api/mate/manifest
    API->>PG: SELECT trip + bookings + tickets + checkIns
    PG-->>API: manifest
    API-->>App: manifest
    App->>DB: cacheManifest
end
```

Each manifest includes every passenger, every ticket, and every check-in recorded so far. Caching it in SQLite means the QR scanner can work offline — every lookup during scanning reads from the local cache, not the network.

16. **`App-->>M: updated trip list with check-in counts`** — The mate now sees current counts. *(dotted — UI update)*

---

## Section 3 — Manifest Screen (on focus)

When the mate taps into a specific trip to see the passenger list:

1. **`App->>DB: getCachedManifest`** — Reads the cached manifest from SQLite. Instant, offline-safe.

2. **`DB-->>App: manifest`** — SQLite returns the cached data. *(dotted — reply)*

3. **`App->>DB: getLocalCheckedInTickets`** — Reads any check-ins that are queued locally but not yet synced. These are in the unsynced queue, not yet in the cached manifest.

4. **`DB-->>App: locally queued ticket IDs`** — SQLite returns the IDs. *(dotted — reply)*

5. **`App-->>M: passenger list (offline-safe)`** — The app merges server-cached manifest with locally queued check-ins and renders the passenger list. The mate sees an accurate real-time picture even without network. *(dotted — UI render)*

---

## Section 4 — QR Scan

This is the primary boarding flow. The mate scans a passenger's QR code from the app's camera.

1. **`M->>App: scan boarding pass QR`** — Mate points the camera at the passenger's phone.

2. **`App->>App: look up qrPayload in cached manifest`** — Self-arrow. The scanned value is looked up directly in the locally cached manifest. **No network call.** The result comes back in milliseconds. This is why the scan works at the dock with no signal.

**The `alt` block — three possible outcomes:**

Each `alt` branch represents a mutually exclusive result. Exactly one runs.

```
alt ticket not found
    App-->>M: error overlay
```
The scanned value doesn't match any ticket in the manifest for this trip. Could be a different trip's ticket, a voided ticket, or an invalid QR. The mate sees a red error overlay.

```
else already checked in
    App-->>M: warning overlay
```
The ticket exists but has already been checked in (either confirmed by the server in the manifest, or present in the local unsynced queue). The mate sees an amber warning overlay — a second scan of the same ticket is not allowed through.

```
else valid ticket
    App->>App: optimistic UI update
    App->>DB: queueCheckIn status=unsynced method=qr
    App-->>M: success overlay for 1.5s
end
```
The ticket is valid and hasn't been checked in yet.
- `App->>App: optimistic UI update` — Self-arrow. The passenger is immediately marked as checked in on screen, before any network call. This keeps the flow fast at the gangway.
- `App->>DB: queueCheckIn status=unsynced method=qr` — The check-in is written to SQLite with `method=qr` so the server knows how it was recorded.
- `App-->>M: success overlay for 1.5s` — The mate sees a green success overlay. *(dotted — UI update)* After 1.5 seconds the scanner resets for the next passenger.

The server sync happens the next time the trips screen is focused (Section 2, Phase A).

---

## Section 5 — Manual Check-in

Used when a passenger doesn't have the app or their QR won't scan (dead phone, sun glare).

1. **`M->>App: search by name or confirmation code`** — The mate types into a search box.

2. **`App-->>M: filtered passenger list`** — The app filters the locally cached manifest in real time. *(dotted — UI update)* No network call.

3. **`M->>App: tap Check In on a ticket row`** — The mate taps the passenger.

4. **`App->>App: optimistic UI update`** — Self-arrow. The row immediately shows as checked in.

5. **`App->>DB: queueCheckIn status=unsynced method=manual`** — Written to SQLite with `method=manual`. Server sync is deferred.

Unlike QR scan, there's no `alt` block here — the app doesn't check for duplicates on manual check-in at the point of tapping. The server handles duplicate detection via `ON CONFLICT DO NOTHING` when the queue syncs.

---

## Section 6 — Capacity Adjustment

The mate can adjust the trip's working capacity (not the vessel's legal certificate capacity).

1. **`M->>App: tap plus or minus on capacity bar`** — Mate taps the +/- controls.

2. **`App->>App: optimistic update`** — Self-arrow. The displayed number changes immediately.

3. **`App->>API: PATCH /api/mate/trips/capacity`** — Unlike check-ins, capacity changes go to the server immediately — there's no local queue. This call requires network.

4. **`API->>PG: validate against certificateCapacity ceiling`** — The server checks whether the new capacity would exceed the vessel's legal maximum.

5. **`PG-->>API: ok or error`** — Postgres returns the validation result. *(dotted — reply)*

**The `alt` block — two outcomes:**

```
alt rejected
    API-->>App: 400 + reason
    App->>App: revert optimistic update
    App-->>M: Alert with reason
```
The capacity change was rejected (would exceed the certificate limit). The app reverts the number shown on screen back to the previous value and shows an alert explaining why.

```
else accepted
    API-->>App: 200
end
```
Accepted. The optimistic update was already correct — nothing more to do on the client side.

---

## Key things to notice

**Two databases, two different purposes.**
Every check-in writes to SQLite first. The server is updated later in batch. This inversion — local first, server second — is what makes boarding work in a cellular dead zone.

**`ON CONFLICT DO NOTHING` is the idempotency guarantee.**
Because syncs can happen multiple times (every time the trips screen is focused), the same check-in event might be sent to the server more than once. The `ON CONFLICT` clause ensures the second insert is a no-op, not a duplicate.

**Optimistic UI updates appear before the server is involved.**
For both QR scan and manual check-in, the passenger is shown as checked in on screen the moment the mate taps. The server only finds out during the next sync. This means the UI is always one sync cycle ahead of the server, which is intentional — responsiveness at the dock matters more than real-time server consistency.

**Capacity adjustment is the exception — it goes to the server immediately.**
Unlike check-ins, capacity changes are not queued locally. This is because the server needs to enforce the certificate ceiling, which it can only do if it knows the current value. A queued capacity change could be applied in the wrong order relative to other changes.

**The `alt` block in QR scan prevents double check-ins on the device.**
The server also prevents double check-ins via `ON CONFLICT DO NOTHING`. Both layers protect against it independently — the device catches it immediately so the mate gets instant feedback; the server catches it as a final backstop.
