# Admin Auth Flow — How to Read the Sequence Diagram

Read this alongside `admin-auth-flow-sequence.md`.

---

## The Participants (columns)

```
A        →  Admin          (the staff member at a computer)
UI       →  Web UI         (Next.js admin dashboard, running in the browser)
API      →  API Routes     (Next.js serverless functions on the server)
DB       →  Postgres       (the database — stores staff records)
S        →  Session Cookie (iron-session encrypted cookie — NOT Stripe)
```

**Important:** `S` here stands for **Session Cookie**, not Stripe. This diagram has nothing to do with payments. The `S` column represents the `iron-session` library, which encrypts and signs browser cookies.

This flow has three distinct phases: **Login**, **Subsequent Requests**, and **Logout**. Each is its own annotated section in the diagram.

---

## Arrow Types

**Solid `->>` ** — an active request or command.

**Dotted `-->>`** — a reply or response.

**Self-arrow `A->>A`** — internal computation with no external call. In this diagram: the `API->>API` bcrypt comparison is a self-arrow.

---

## Section 1 — Login

This is the credential exchange. The admin provides email and password; if correct, a signed encrypted cookie is set in their browser.

1. **`A->>UI`** — Admin types email and password into the login form.

2. **`UI->>API: POST /api/admin/auth/login { email, password }`** — Browser sends the credentials to the server over HTTPS.

3. **`API->>DB: checkRateLimit("admin-login:<ip>", 10, 15min)`** — Before anything else, the API checks whether this IP has made too many login attempts. Limit is 10 per 15 minutes.
   - The Note says: returns `429` with `Retry-After` if exceeded. No further processing.

4. **`API->>DB: SELECT operators LIMIT 1`** — Fetches the single operator row to scope all subsequent queries.

5. **`DB-->>API: operator row`** — Postgres returns the row. *(dotted — reply)*

6. **`API->>DB: SELECT staff WHERE email = ? AND operatorId = ?`** — Looks up the staff record using both email and `operatorId`. This scoping means an admin account from one deployment can never authenticate against another.

7. **`DB-->>API: staff row`** — Postgres returns the record. *(dotted — reply)*
   - Three Notes fire here in sequence:
     - Returns `401` if the staff row doesn't exist or has no `passwordHash` set.
     - Returns `403` if the `role` is not `"admin"`. A mate account cannot log into the admin dashboard even with the correct password.
     - Returns `403` if `active = false`. Deactivated accounts are rejected before the password is even checked.

8. **`API->>API: bcrypt.compare(password, passwordHash) — constant-time`** — Self-arrow. The submitted password is compared against the stored bcrypt hash. Constant-time comparison means the function doesn't short-circuit on early mismatches, preventing timing attacks.
   - The Note says: returns `401` if the password is incorrect.

9. **`API->>S: getIronSession(cookies, { password: SESSION_SECRET })`** — The API opens an iron-session instance, keyed by `SESSION_SECRET`. This is the step that prepares the encrypted cookie.

10. **`API->>S: session.staffId = id, operatorId, role="admin", name`** — Session data is written into the iron-session object. This data will be AES-256 encrypted before it leaves the server.

11. **`API->>S: session.save() — AES-256 encrypts + signs cookie`** — The session is persisted to the cookie. `iron-session` encrypts the payload with AES-256 and signs it with an HMAC, so the cookie cannot be read or forged by anyone without `SESSION_SECRET`.

12. **`S-->>A: Set-Cookie: openboat_admin (HttpOnly, SameSite=Lax, 8h)`** — The encrypted cookie is sent to the browser. *(dotted — the browser receives a `Set-Cookie` header)*
    - `HttpOnly` — JavaScript on the page cannot read this cookie. XSS attacks can't steal it.
    - `SameSite=Lax` — The cookie is not sent on cross-site requests, blocking CSRF attacks.
    - `8h` — The cookie expires after 8 hours.

13. **`API-->>UI: { name, role }`** — The API returns the admin's name and role to the browser for display purposes. *(dotted — reply)*

14. **`UI-->>A: Admin dashboard`** — The browser navigates to the dashboard. *(dotted — UI render)*

---

## Section 2 — Subsequent Requests

Every admin page load and every admin action (cancel trip, issue refund, view manifest) goes through this exact same short path.

1. **`A->>UI`** — Admin clicks something or navigates to a page.

2. **`UI->>API: request with session cookie (automatic browser behaviour)`** — The browser automatically attaches the `openboat_admin` cookie to every request to the same domain. The admin doesn't do anything special — the browser handles it.

3. **`API->>S: getIronSession — AES-decrypt + verify cookie integrity`** — The API decrypts the cookie and verifies its HMAC signature. If the cookie has been tampered with or is missing, iron-session returns an empty session object.

4. **`S-->>API: { staffId, operatorId, role, name }`** — The decrypted session payload is returned. *(dotted — reply)*
   - The Note says: `requireAdmin` returns `401` if `staffId` is missing (session invalid or expired) or `role != "admin"` (wrong role). This check runs on **every** protected endpoint.

5. **`API->>DB: scoped query WHERE operatorId = session.operatorId`** — Every database query uses the `operatorId` from the verified session, never from the request body or URL. This ensures an admin can only ever see their own operator's data, even if they somehow manipulate a URL.

6. **`DB-->>API: result`** — Postgres returns the data. *(dotted — reply)*

7. **`API-->>UI: response`** — The API returns the result to the browser. *(dotted — reply)*

This section has no Note boxes because there are no conditional branches — it either passes `requireAdmin` and proceeds, or it 401s immediately.

---

## Section 3 — Logout

Simple and explicit. The session is destroyed on the server before the browser is redirected.

1. **`A->>UI`** — Admin clicks "Sign out."

2. **`UI->>API: POST /api/admin/auth/logout`** — The browser sends a logout request.

3. **`API->>S: session.destroy`** — iron-session clears the session data.

4. **`S-->>A: Set-Cookie clears iron-session`** — A new `Set-Cookie` header is sent that overwrites the existing cookie with an expired, empty value. The browser deletes it. *(dotted — browser receives the header)*

5. **`API-->>UI: ok`** — The API confirms the logout. *(dotted — reply)*

6. **`UI-->>A: Redirect to login`** — The browser navigates to the login page. *(dotted — navigation)*

---

## How this differs from Customer Auth (OTP flow)

The customer auth diagram uses a magic-link OTP: no password, no server-side session, stateless JWT token stored in browser memory. This admin flow uses a password and an encrypted **cookie** that the server issues and can effectively revoke by destroying the session.

| | Admin (this diagram) | Customer (auth-flow) |
|---|---|---|
| Credential | Email + password | Email + 6-digit OTP |
| What gets stored on the server | Nothing — cookie is self-contained encrypted blob | OTP hash in `magic_link_otps` table |
| What the browser holds | Encrypted `HttpOnly` cookie | JWT token in memory (JS variable) |
| Session lifetime | 8 hours (cookie expiry) | 90 days (JWT expiry) |
| How subsequent requests are authenticated | Cookie sent automatically by browser | Bearer token sent manually in `Authorization` header |
| Role required | `admin` only | No role — any customer |

---

## Key things to notice

**Why is the role checked at login AND on every request?**
The login check sets `role="admin"` into the session. The `requireAdmin` check on every subsequent request re-reads that role from the decrypted session. This means changing a staff member's role in the database takes effect immediately — they'll get a `403` on the next request even if their cookie is still valid.

**Why does the `operatorId` come from the session rather than the URL?**
If the `operatorId` came from a URL parameter like `/api/admin/trips?operatorId=abc`, an admin could potentially swap it to access a different operator's data. Coming from the session, it's baked in at login time and AES-encrypted — there's no way to change it without `SESSION_SECRET`.

**What does `HttpOnly` actually prevent?**
It prevents JavaScript — including third-party scripts, browser extensions, and XSS payloads — from reading the cookie via `document.cookie`. The cookie is only ever sent as an HTTP header, never accessible to code running on the page.
