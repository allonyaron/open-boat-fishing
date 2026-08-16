# Check-in Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant M as Mate
    participant App as Mate App
    participant DB as SQLite
    participant API as API Routes
    participant PG as Postgres

    Note over M,PG: LOGIN
    M->>App: Enter email + PIN
    App->>API: POST /api/mate/auth
    API->>PG: SELECT staff WHERE email
    PG-->>API: staff row
    API->>API: bcrypt compare PIN + sign HMAC JWT
    API-->>App: token + name + role

    Note over M,PG: TRIPS SCREEN - on every focus
    App->>DB: getCachedTrips
    DB-->>App: cached trip list
    App-->>M: show trips immediately (offline-safe)
    App->>DB: getUnsyncedCheckIns
    DB-->>App: queued events
    App->>API: POST /api/mate/checkins
    API->>PG: INSERT checkIns ON CONFLICT DO NOTHING
    PG-->>API: results per event
    API-->>App: ok / ticket_voided / ticket_not_found
    App->>DB: markCheckInSynced or markCheckInError
    App->>API: GET /api/mate/trips
    API->>PG: SELECT trips + vessels + checkin counts
    PG-->>API: trip rows
    API-->>App: trip list
    App->>DB: cacheTrips
    loop each trip
        App->>API: GET /api/mate/manifest
        API->>PG: SELECT trip + bookings + tickets + checkIns
        PG-->>API: manifest
        API-->>App: manifest
        App->>DB: cacheManifest
    end
    App-->>M: updated trip list with check-in counts

    Note over M,PG: MANIFEST SCREEN - on focus
    App->>DB: getCachedManifest
    DB-->>App: manifest
    App->>DB: getLocalCheckedInTickets
    DB-->>App: locally queued ticket IDs
    App-->>M: passenger list (offline-safe)

    Note over M,PG: QR SCAN
    M->>App: scan boarding pass QR
    App->>App: look up qrPayload in cached manifest
    alt ticket not found
        App-->>M: error overlay
    else already checked in
        App-->>M: warning overlay
    else valid ticket
        App->>App: optimistic UI update
        App->>DB: queueCheckIn status=unsynced method=qr
        App-->>M: success overlay for 1.5s
    end

    Note over M,PG: MANUAL CHECK-IN
    M->>App: search by name or confirmation code
    App-->>M: filtered passenger list
    M->>App: tap Check In on a ticket row
    App->>App: optimistic UI update
    App->>DB: queueCheckIn status=unsynced method=manual

    Note over M,PG: CAPACITY ADJUSTMENT
    M->>App: tap plus or minus on capacity bar
    App->>App: optimistic update
    App->>API: PATCH /api/mate/trips/capacity
    API->>PG: validate against certificateCapacity ceiling
    PG-->>API: ok or error
    alt rejected
        API-->>App: 400 + reason
        App->>App: revert optimistic update
        App-->>M: Alert with reason
    else accepted
        API-->>App: 200
    end
```

## Key invariants

| Invariant                          | Where enforced                                                     |
| ---------------------------------- | ------------------------------------------------------------------ |
| Works fully offline                | All check-ins write to SQLite first; network is best-effort        |
| No double check-in                 | `ON CONFLICT DO NOTHING` on server; scanLocked for 1.5s on device  |
| Manifest always current on open    | syncAndRefresh flushes queue then re-fetches on every screen focus |
| Optimistic UI stays correct        | localCheckedIn merges server state and queued-but-unsynced events  |
| Capacity cannot exceed certificate | API enforces ceiling; optimistic update reverts on rejection       |
| Auth is stateless                  | HMAC-signed JWT verified on every request — no server session      |
