# Customer Auth Flow — How to Read the Sequence Diagram

Read this alongside `auth-flow-sequence.md`.

---

## The Participants (columns)

```
C        →  Customer       (the person in the browser)
UI       →  Web UI         (Next.js frontend, running in the browser)
API      →  API Routes     (Next.js serverless functions on the server)
DB       →  Postgres       (the database — stores OTP hashes and customer records)
E        →  Email          (Resend email service — external)
```

This flow has no Stripe and no Notifications column. It is purely about proving identity — nothing else happens here.

---

## Arrow Types

**Solid `->>` ** — an active request or command. The sender is initiating something.

**Dotted `-->>`** — a reply or response. Data is flowing back to whoever asked.

**Self-arrow `A->>A`** — a participant doing internal computation. No network call, no external system. In this diagram, all `API->>API` arrows are things the server calculates on its own: generating a random number, running a hash function, or signing a token.

---

## Section 1 — Request OTP

This is the first half of the login. The customer provides their email and the server sends them a one-time code.

1. **`C->>UI`** — Customer types their email address into the login form in the browser.

2. **`UI->>API: POST /api/auth/request { email }`** — The browser sends the email to the server. No OTP has been generated yet.

3. **`API->>DB: checkRateLimit("otp-request:ip:<ip>", 20, 1hr)`** — Before doing any work, the API checks whether this IP address has made too many OTP requests. Limit is 20 per hour. The rate limit record lives in Postgres.

4. **`API->>DB: checkRateLimit("otp-request:email:<email>", 5, 1hr)`** — A second rate limit check, this time keyed on the email address itself rather than the IP. Limit is 5 per hour. This prevents someone from hammering one user's inbox.
   - The Note says: if either limit is exceeded, the API returns `429` with a `Retry-After` header immediately. Nothing else runs.

5. **`API->>API: getOperatorContext(req)`** — The API reads the `x-operator-id` header set by Edge middleware (`apps/web/src/middleware.ts`) and looks up that operator's row. In single-deploy mode the middleware short-circuits on the `OPERATOR_ID` env var; in centralized mode it resolves the hostname against the `domains` table. There is no per-request `SELECT operators LIMIT 1` — operator resolution already happened before this route ran. The operator name is used in the email body.

6. **`API->>API: generate 6-digit OTP`** — Self-arrow. The API generates a cryptographically random 6-digit number internally. No database or network involved.

7. **`API->>API: bcrypt hash OTP (cost=10)`** — Self-arrow. The plaintext OTP is immediately hashed using bcrypt at cost 10. The raw number is never stored anywhere — only the hash goes into the database. This means even if the database is compromised, an attacker can't recover OTP values.

8. **`API->>DB: UPDATE magic_link_otps SET used=true WHERE operatorId + email + used=false`** — Before inserting the new code, the API hard-invalidates every still-unused prior OTP for this email. This closes a small window where an intercepted old code would otherwise remain valid after the user requests a fresh one.

9. **`API->>DB: INSERT magic_link_otps (hash, expiresAt=+15min, used=false)`** — The hashed OTP is stored with a 15-minute expiry window and a `used=false` flag.

10. **`API->>E: sendOtpEmail(to=email, otp, operatorName)`** — The API calls the email service (Resend), passing the plaintext OTP. This is the only time the raw code is transmitted — directly to the customer's inbox.

11. **`E-->>C: Email: "Your code is 123456"`** — The email arrives in the customer's inbox. *(dotted — async delivery; the API doesn't wait for this to confirm delivery)*

12. **`API-->>UI: 200 ok`** — The API responds to the browser. *(dotted — reply)*

13. **`UI-->>C: "Check your email" screen`** — The browser renders the "enter your code" screen. *(dotted — UI update)*

At this point, the customer has a code in their email. Nothing is authenticated yet.

---

## Section 2 — Verify OTP

This is the second half. The customer types in the code they received and, if it's correct, they get a session token.

1. **`C->>UI`** — Customer types the 6-digit code from the email.

2. **`UI->>API: POST /api/auth/verify { email, otp }`** — The browser sends both the email address and the code to the server.

3. **`API->>DB: checkRateLimit("otp-verify:ip:<ip>", 20, 15min)` + `checkRateLimit("otp-verify:<email>", 10, 15min)`** — Two rate limits, same shape as the request step: a coarse IP bucket (20/15min, stops one host from parallelizing guesses across many emails) plus a tight email bucket (10/15min) that caps brute-force attempts against a single code. Either tripping returns `429`.
   - The Note says: returns `429` if exceeded.

4. **`API->>API: getOperatorId(req)`** — Same header-based resolution as the request step; no DB round trip.

5. **`API->>DB: SELECT magic_link_otps WHERE operatorId + email + used=false + expiresAt > NOW() ORDER BY createdAt DESC LIMIT 1`** — The API fetches the most recent valid OTP for this email. The query filters to:
   - `used=false` — OTP hasn't been consumed yet
   - `expiresAt > NOW()` — the 15-minute window hasn't passed
   - `ORDER BY createdAt DESC LIMIT 1` — if the user requested multiple codes, only the newest one matters

6. **`DB-->>API: most recent pending OTP row`** — Postgres returns the record. *(dotted — reply)*
   - The Note says: returns `401` if no row is found (wrong email, expired, already used).

7. **`API->>API: bcrypt.compare(submitted, hash)`** — Self-arrow. The submitted code is compared against the stored hash using bcrypt's constant-time comparison function. "Constant-time" means the comparison always takes the same amount of time regardless of how many characters match — this prevents timing attacks.
   - The Note says: returns `401` if the code is incorrect.

8. **`API->>DB: UPDATE magic_link_otps SET used=true WHERE id`** — The OTP is immediately marked as used. Even if someone captures the code, replaying it will fail because `used=false` is now false.

9. **`API->>DB: SELECT customers WHERE operatorId + email`** — The API checks whether this email address already has a customer record.

10. **`DB-->>API: existing customer row or null`** — Postgres returns the row or nothing. *(dotted — reply)*
    - The Note says: if nothing comes back, this is the customer's first login — a new row is created next.

11. **`API->>DB: INSERT customers (operatorId, email) if not exists`** — Upsert-safe: if the customer already exists, this is a no-op. If they don't, a new record is created. There's no unique-constraint race here because the prior SELECT already determined which path to take.

12. **`API->>API: signCustomerToken({ customerId, operatorId, email, name, aud:"customer", exp:+90d })`** — Self-arrow. The API generates a JWT (JSON Web Token) signed with `SESSION_SECRET`. Key fields:
    - `aud:"customer"` — the audience claim that prevents mate tokens from being accepted here and vice versa
    - `exp:+90d` — the token is valid for 90 days; no refresh needed

13. **`API-->>UI: { token, email, name }`** — The token is sent back to the browser. *(dotted — reply)*

14. **`UI->>UI: store token in memory (not localStorage)`** — Self-arrow on the UI side. The token is stored in React state or a context variable, never in `localStorage` or `sessionStorage`. This means it's wiped on page close, reducing the exposure window for a stolen token.

15. **`UI-->>C: Signed in — account screen unlocked`** — The browser unlocks the account tab. *(dotted — UI update)*

---

## Key things to notice

**Why IP + email rate limits on both request and verify?**
Both steps face the same two attack shapes: one host hammering many emails (stopped by the IP bucket) and one attacker guessing against a single email (stopped by the tight email bucket). Request uses 20/hr IP + 5/hr email; verify uses 20/15min IP + 10/15min email — verify's window is shorter because a 6-digit code is a live brute-force target, not a spam-cost problem.

**Why bcrypt for a 6-digit OTP?**
A 6-digit number is small enough that if stored in plaintext a database breach immediately exposes every active code. Bcrypt makes each hash unique (via salting) and computationally expensive to reverse. The 15-minute expiry also limits the useful window.

**Why does the request step hard-invalidate old codes instead of relying on `ORDER BY ... LIMIT 1`?**
If a customer clicks "resend," the newest code is what they'll actually use — but until recently the older code stayed valid too (just outranked by `ORDER BY createdAt DESC`). The request route now sets `used=true` on every prior unused code for that email before inserting the new one, so an intercepted old code can't be replayed after a resend. `ORDER BY createdAt DESC LIMIT 1` in the verify query is now a defense-in-depth detail, not the actual invalidation mechanism.

**Why is the token stored in memory, not localStorage?**
`localStorage` persists across browser closes and is accessible to any JavaScript on the page (including third-party scripts). In-memory storage clears on page close and is invisible to `localStorage`-based attacks.
