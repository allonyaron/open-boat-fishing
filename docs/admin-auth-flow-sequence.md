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
    UI->>API: POST /api/admin/auth/login
    API->>DB: SELECT operator
    DB-->>API: operator row
    API->>DB: SELECT staff WHERE email
    DB-->>API: staff row
    Note over API: Returns 401 if not found or no passwordHash
    Note over API: Returns 403 if role is not admin
    Note over API: Returns 403 if account disabled
    API->>API: bcrypt compare password vs passwordHash
    Note over API: Returns 401 if password incorrect
    API->>S: getSession - read iron-session cookie
    API->>S: set staffId + operatorId + role + name
    API->>S: session.save - write encrypted cookie
    S-->>A: Set-Cookie iron-session (HttpOnly, signed with SESSION_SECRET)
    API-->>UI: name + role
    UI-->>A: Admin dashboard

    Note over A,S: SUBSEQUENT REQUESTS
    A->>UI: Any admin action
    UI->>API: request with session cookie
    API->>S: getSession - decrypt + verify cookie
    S-->>API: staffId + operatorId + role
    Note over API: requireAdmin returns 401 if no staffId in session
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
| Session tamper-proof                    | iron-session encrypts + signs with `SESSION_SECRET`              |
| All admin queries are operator-scoped   | `requireAdmin` returns `session.operatorId`; every query uses it |
| Role checked at login, not just session | `member.role !== "admin"` check before session is written        |
