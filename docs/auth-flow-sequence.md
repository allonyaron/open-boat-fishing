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
    API->>DB: checkRateLimit("otp-request:ip:<ip>", 20, 1hr)
    API->>DB: checkRateLimit("otp-request:email:<email>", 5, 1hr)
    Note over API: Returns 429 with Retry-After if either limit exceeded
    API->>API: getOperatorContext(req) — reads x-operator-id header set by Edge middleware
    Note over API: Single-deploy: OPERATOR_ID env var. Centralized: domains table lookup at the edge.
    API->>API: generate 6-digit OTP
    API->>API: bcrypt hash OTP (cost=10)
    API->>DB: UPDATE magic_link_otps SET used=true WHERE operatorId + email + used=false
    Note over API: Invalidates any still-valid prior codes before issuing a new one
    API->>DB: INSERT magic_link_otps (hash, expiresAt=+15min, used=false)
    API->>E: sendOtpEmail(to=email, otp, operatorName)
    E-->>C: Email: "Your code is 123456"
    API-->>UI: 200 ok
    UI-->>C: "Check your email" screen

    Note over C,E: VERIFY OTP
    C->>UI: Enter 6-digit code
    UI->>API: POST /api/auth/verify { email, otp }
    API->>DB: checkRateLimit("otp-verify:ip:<ip>", 20, 15min)
    API->>DB: checkRateLimit("otp-verify:<email>", 10, 15min)
    Note over API: Returns 429 with Retry-After if either limit exceeded
    API->>API: getOperatorId(req) — reads x-operator-id header
    API->>DB: SELECT magic_link_otps WHERE operatorId + email + used=false + expiresAt > NOW() ORDER BY createdAt DESC LIMIT 1
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
| Old codes hard-invalidated     | Requesting a new OTP sets `used=true` on all prior unused codes for that email — not just superseded by `ORDER BY` |
| Customer row is upsert-safe   | SELECT then INSERT only if not found — no unique constraint race          |
| Auth is stateless             | HMAC-signed token; no server-side session table                           |
| Token audience separation     | `aud:"customer"` embedded and verified — mate tokens rejected             |
| Operator resolved from Edge middleware | `getOperatorContext`/`getOperatorId` read `x-operator-id` header — never DB `LIMIT 1` or request body |
| Brute-force protected         | Request: 20/hr per IP + 5/hr per email. Verify: 20/15min per IP + 10/15min per email |
