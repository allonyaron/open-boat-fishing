# Check-in Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant M as Mate
    participant App as Mate App
    participant DB as SQLite (local)
    participant API as API Routes
    participant PG as Postgres

    rect rgb(235, 245, 255)
        Note over M,PG: Login
        M->>App: Enter email + PIN
        App->>API: POST /api/mate/auth
        API->>PG: SELECT staff WHERE email
        PG-->>API: staff row
        API->>API: bcrypt compare PIN
        API->>API: sign HMAC JWT (staffId, role)
        API-->>App: token + name + role
        App->>App: store token in context
    end

    rect rgb(240, 255, 240)
        Note over M,PG: Trips screen (on every focus)
        App->>DB: getCachedTrips
        DB-->>App: cached trip list
        App-->>M: show trips immediately (offline-safe)

        App->>DB: getUnsyncedCheckIns
        DB-->>App: queued events
        App->>API: POST /api/mate/checkins (flush queue)
        API->>PG: validate tickets + INSERT checkIns ON CONFLICT DO NOTHING
        PG-->>API: results per event
        API-->>App: results (ok / ticket_voided / ticket_not_found)
        App->>DB: markCheckInSynced or markCheckInError

        App->>API: GET /api/mate/trips?date=TODAY
        API->>PG: SELECT trips + vessels + products + checkin counts
        PG-->>API: trip rows
        API-->>App: trip list
        App->>DB: cacheTrips

        loop each trip
            App->>API: GET /api/mate/manifest?tripId=X
            API->>PG: SELECT trip + bookings + tickets + checkIns
            PG-->>API: manifest
            API-->>App: manifest
            App->>DB: cacheManifest
        end

        App-->>M: updated trip list with check-in counts
    end

    rect rgb(255, 250, 235)
        Note over M,PG: Manifest screen (on focus)
        App->>DB: getCachedManifest
        DB-->>App: manifest
        App->>DB: getLocalCheckedInTickets
        DB-->>App: locally queued ticket IDs
        App-->>M: passenger list (offline-safe)
        Note over App: same sync + refresh as trips screen
    end

    rect rgb(250, 235, 255)
        Note over M,PG: QR scan - camera mode
        M->>App: tap Camera button
        App->>App: request camera permission if needed
        M->>App: point camera at boarding pass QR
        App->>App: processQrPayload - look up ticket in cached manifest
        alt ticket not found in manifest
            App-->>M: error overlay - Ticket not found on this trip
        else ticket already checked in
            App-->>M: warning overlay - Already checked in
        else valid ticket
            App->>DB: getLocalCheckedInTickets (optimistic check)
            App->>App: optimistic UI update - add to localCheckedIn
            App->>DB: queueCheckIn (status=unsynced)
            App-->>M: success overlay for 1.5s
            Note over App: scanLocked for 1.5s to prevent double-scan
        end
    end

    rect rgb(255, 243, 243)
        Note over M,PG: Manual check-in (name search or list)
        M->>App: search by name or confirmation code
        App-->>M: filtered passenger list
        M->>App: tap Check In on a ticket row
        App->>App: optimistic UI update - add to localCheckedIn
        App->>DB: queueCheckIn (status=unsynced, method=manual)
    end

    rect rgb(235, 250, 255)
        Note over M,PG: Capacity adjustment
        M->>App: tap + or - on capacity bar
        App->>App: optimistic update to capacity + seatsRemaining
        App->>API: PATCH /api/mate/trips/tripId/capacity
        API->>PG: validate against certificateCapacity ceiling
        PG-->>API: ok or error
        alt server rejected
            API-->>App: 400 + reason
            App->>App: revert optimistic update
            App-->>M: Alert with reason
        else accepted
            API-->>App: 200
        end
    end
```

## Key invariants

| Invariant | Where enforced |
|---|---|
| Works fully offline | All check-ins write to SQLite first; network is best-effort |
| No double check-in | `ON CONFLICT DO NOTHING` on server; scanLocked for 1.5s on device |
| Manifest always current on open | syncAndRefresh flushes queue then re-fetches on every screen focus |
| Optimistic UI stays correct | localCheckedIn set merges server state and queued-but-unsynced events |
| Capacity cannot exceed certificate | API enforces ceiling; optimistic update reverts on rejection |
| Auth is stateless | HMAC-signed JWT verified on every request — no server session |
