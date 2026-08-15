# Customer Auth Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Customer
    participant UI as Web UI
    participant API as API Routes
    participant DB as Postgres
    participant E as Email

    Note over C,E: REQUEST OTP
    C->>UI: Enter email address
    UI->>API: POST /api/auth/request
    API->>DB: SELECT operator
    DB-->>API: operator row
    API->>API: generate 6-digit OTP
    API->>API: bcrypt hash OTP (cost=10)
    API->>DB: INSERT magicLinkOtps (hash, expiresAt=+15min)
    API->>E: sendOtpEmail (to, otp, operatorName)
    E-->>C: Email with 6-digit code
    API-->>UI: ok
    UI-->>C: Check your email screen

    Note over C,E: VERIFY OTP
    C->>UI: Enter 6-digit code
    UI->>API: POST /api/auth/verify (email + otp)
    API->>DB: SELECT magicLinkOtps WHERE email + unused + not expired
    DB-->>API: most recent pending OTP row
    Note over API: Returns 401 if not found or expired
    API->>API: bcrypt compare submitted code vs hash
    Note over API: Returns 401 if code incorrect
    API->>DB: UPDATE magicLinkOtps SET used=true
    API->>DB: SELECT customers WHERE operatorId + email
    DB-->>API: existing customer or null
    Note over API: Creates new customer row if first login
    API->>DB: INSERT customers if not exists
    API->>API: sign HMAC JWT (customerId, operatorId, email, name)
    API-->>UI: token + email + name
    UI->>UI: store token in memory
    UI-->>C: Signed in - account screen unlocked
```

## Key invariants

| Invariant | Where enforced |
|---|---|
| OTP never stored in plaintext | bcrypt hashed at cost=10 before INSERT |
| OTP expires after 15 minutes | `expiresAt` checked in SELECT WHERE clause |
| OTP single-use | `used=true` set immediately on successful verify |
| Most recent code wins | `ORDER BY createdAt DESC LIMIT 1` — re-requesting invalidates older codes |
| Customer row is upsert-safe | SELECT then INSERT only if not found — no unique constraint race |
| Auth is stateless | HMAC-signed JWT; no server-side session table |
