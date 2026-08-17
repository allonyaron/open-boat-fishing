# Admin Auth Flow — Sequence Diagram

```mermaid
sequenceDiagram
    participant A as Admin
    participant UI as Web UI
    participant API as API Routes
    participant DB as Postgres
    participant S as Session Cookie

    Note over A,S: LOGIN
    A->>UI: Enter email + password
    UI->>API: POST /api/admin/auth/login { email, password }
    API->>DB: checkRateLimit("admin-login:<ip>", 10, 15min)
    Note over API: Returns 429 with Retry-After if limit exceeded
    API->>DB: SELECT operators LIMIT 1
    DB-->>API: operator row (single-tenant)
    API->>DB: SELECT staff WHERE email = ? AND operatorId = ?
    DB-->>API: staff row
    Note over API: Returns 401 if not found or no passwordHash set
    Note over API: Returns 403 if role != "admin"
    Note over API: Returns 403 if active = false
    API->>API: bcrypt.compare(password, passwordHash) — constant-time
    Note over API: Returns 401 if password incorrect
    API->>S: getIronSession(cookies, { password: SESSION_SECRET })
    API->>S: session.staffId = id, operatorId, role="admin", name
    API->>S: session.save() — AES-256 encrypts + signs cookie
    S-->>A: Set-Cookie: openboat_admin (HttpOnly, SameSite=Lax, 8h)
    API-->>UI: { name, role }
    UI-->>A: Admin dashboard

    Note over A,S: SUBSEQUENT REQUESTS
    A->>UI: Any admin action
    UI->>API: request with session cookie (automatic browser behaviour)
    API->>S: getIronSession — AES-decrypt + verify cookie integrity
    S-->>API: { staffId, operatorId, role, name }
    Note over API: requireAdmin returns 401 if staffId missing or role != "admin"
    API->>DB: scoped query WHERE operatorId = session.operatorId
    DB-->>API: result
    API-->>UI: response

    Note over A,S: LOGOUT
    A->>UI: Click sign out
    UI->>API: POST /api/admin/auth/logout
    API->>S: session.destroy
    S-->>A: Set-Cookie clears iron-session
    API-->>UI: ok
    UI-->>A: Redirect to login
```

## How this differs from mate auth

|                  | Admin                                     | Mate                            |
| ---------------- | ----------------------------------------- | ------------------------------- |
| Credential       | Email + password                          | Email + PIN                     |
| Session storage  | iron-session encrypted cookie             | HMAC-signed JWT (Bearer header) |
| Session lifetime | Cookie expiry (browser session)           | Token lifetime in payload       |
| Role required    | `admin` only                              | `mate` or `admin`               |
| Stateless        | No — server reads cookie on every request | Yes — JWT self-contained        |

## Key invariants

| Invariant                               | Where enforced                                                   |
| --------------------------------------- | ---------------------------------------------------------------- |
| Password never stored in plaintext      | bcrypt hash stored in `staff.passwordHash`                       |
| Session tamper-proof                    | iron-session AES-256 encrypts + signs with `SESSION_SECRET`      |
| All admin queries are operator-scoped   | `requireAdmin` returns `session.operatorId`; every query uses it |
| Role checked at login, not just session | `role !== "admin"` check before session is written               |
| Brute-force protected                   | 10 login attempts/15min per IP; returns 429 with Retry-After     |
