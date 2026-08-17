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
    UI->>API: POST /api/auth/request { email }
    API->>DB: checkRateLimit("otp-ip:<ip>", 20, 1hr)
    API->>DB: checkRateLimit("otp-email:<email>", 5, 1hr)
    Note over API: Returns 429 with Retry-After if either limit exceeded
    API->>DB: SELECT operators LIMIT 1
    DB-->>API: operator row (single-tenant)
    API->>API: generate 6-digit OTP
    API->>API: bcrypt hash OTP (cost=10)
    API->>DB: INSERT magic_link_otps (hash, expiresAt=+15min, used=false)
    API->>E: sendOtpEmail(to=email, otp, operatorName)
    E-->>C: Email: "Your code is 123456"
    API-->>UI: 200 ok
    UI-->>C: "Check your email" screen

    Note over C,E: VERIFY OTP
    C->>UI: Enter 6-digit code
    UI->>API: POST /api/auth/verify { email, otp }
    API->>DB: checkRateLimit("otp-verify:<email>", 10, 15min)
    Note over API: Returns 429 with Retry-After if limit exceeded
    API->>DB: SELECT magic_link_otps WHERE email + used=false + expiresAt > NOW() ORDER BY createdAt DESC LIMIT 1
    DB-->>API: most recent pending OTP row
    Note over API: Returns 401 if not found or expired
    API->>API: bcrypt.compare(submitted, hash)
    Note over API: Returns 401 if code incorrect
    API->>DB: UPDATE magic_link_otps SET used=true WHERE id
    API->>DB: SELECT customers WHERE operatorId + email
    DB-->>API: existing customer row or null
    Note over API: First login — creates customer row
    API->>DB: INSERT customers (operatorId, email) if not exists
    API->>API: signCustomerToken({ customerId, operatorId, email, name, aud:"customer", exp:+90d })
    API-->>UI: { token, email, name }
    UI->>UI: store token in memory (not localStorage)
    UI-->>C: Signed in — account screen unlocked
```

## Key invariants

| Invariant                     | Where enforced                                                            |
| ----------------------------- | ------------------------------------------------------------------------- |
| OTP never stored in plaintext | bcrypt hashed at cost=10 before INSERT                                    |
| OTP expires after 15 minutes  | `expiresAt > NOW()` checked in SELECT WHERE clause                        |
| OTP single-use                | `used=true` set immediately on successful verify                          |
| Most recent code wins         | `ORDER BY createdAt DESC LIMIT 1` — re-requesting invalidates older codes |
| Customer row is upsert-safe   | SELECT then INSERT only if not found — no unique constraint race          |
| Auth is stateless             | HMAC-signed token; no server-side session table                           |
| Token audience separation     | `aud:"customer"` embedded and verified — mate tokens rejected             |
| Brute-force protected         | 5 OTP requests/hr per email; 10 verify attempts/15min per email           |
