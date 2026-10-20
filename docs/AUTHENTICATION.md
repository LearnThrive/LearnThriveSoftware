# Authentication

## Status: development accounts, plus the Library account layer

The staff/portal sign-in below is **development only**. The Library has its own real account layer: see "Library accounts" further down.

Everything in this document describes a **development-only** authentication system. It is not production-ready, and the code itself refuses to run as production auth — see "Production safety" below. Real production authentication (almost certainly Supabase Auth, per `docs/SUPABASE_MIGRATION.md`) is future work.

## The abstraction

Nothing outside `apps/web/src/lib/auth/` talks to a concrete credential store. Everything goes through one interface:

```ts
interface AuthProvider {
  verifyCredentials(email: string, password: string): Promise<LoginResult>;
}
```

Today there is exactly one implementation, `DevelopmentAuthProvider` (`apps/web/src/lib/auth/devProvider.ts`). A future `SupabaseAuthProvider` implements the same interface — the login route, session issuance, and every role guard stay unchanged when that happens.

## Development credential store

A server-side, in-memory `Map<string, DevelopmentUser>`, seeded once per server process with five development-only accounts (see `docs/DEVELOPMENT_ACCOUNTS.md`). It resets on every server restart — there is no persistence, by design (this is a prototype, not a place to accumulate real account state).

```ts
interface DevelopmentUser {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  name: string;
  profileId?: string;
  active: boolean;
}
```

**Passwords are never stored in plaintext.** `apps/web/src/lib/auth/passwords.ts` hashes with `scrypt` (via `node:crypto`, no third-party dependency): a random 16-byte salt per password, a 64-byte derived key, stored as `scrypt:<saltHex>:<keyHex>`. Verification uses `timingSafeEqual`, not a plain `===`, to avoid leaking timing information about how much of the hash matched.

## Sessions

Server-issued, not client-declared. `apps/web/src/lib/auth/session.ts` holds an in-memory `Map<sessionId, { user, expiresAt }>` (same reset-on-restart behaviour as the user store). On successful login:

1. A random session id is generated (`crypto.randomUUID()`).
2. The session record is stored server-side.
3. An HTTP-only, `SameSite=Lax` cookie carrying only the session id is set on the response — never the user's role or identity directly. `secure` is set whenever `NODE_ENV=production` (conditionally, since local development over plain `http://localhost` needs a non-secure cookie to work at all).

Every subsequent request that needs to know who's signed in reads the cookie, looks up the session in the server-side store, and checks its expiry — the cookie's mere presence proves nothing by itself. This is the direct fix for what the plan behind this migration explicitly warns against: authenticating by trusting a client-supplied `role=tutor` query parameter. That pattern existed in the classroom prototype for local dev role-switching and is **not** connected to platform identity — see `apps/classroom`'s own docs for what that mechanism is for (a classroom-only dev/test convenience, unrelated to this auth system).

"Remember me" changes session lifetime, not the mechanism: unchecked, the cookie has no `maxAge` (an ordinary browser-session cookie, gone when the browser closes) and the server-side record expires in 12 hours; checked, both the cookie and the server-side record last 30 days.

## Route protection

Three helpers in `apps/web/src/lib/auth/guard.ts`, used from Server Components and Route Handlers (never from the client — role/identity is always resolved server-side):

- `requireSession()` — redirects to `/login` if there's no valid session. Used by the dashboard layout, so every route under `/dashboard/**` is automatically protected.
- `requireRole(allowed: Role[])` — as above, plus redirects to `/403` (not back to `/login`) if the signed-in user's role isn't in the allowed list. A logged-in Student hitting an Admin-only page should see "you don't have access", not be bounced back to a sign-in form they already used successfully.
- `requireRoleForApi(allowed: Role[])` — the same check for a Route Handler, where `redirect()` doesn't apply; returns `null` so the caller shapes its own JSON error response.

`/dashboard/admin` is the first real role-restricted route, proving this end to end (see `docs/ROLE_PERMISSIONS.md`).

## Library accounts (plan19 phase C)

The Library has real sign-up. It is a **separate layer** from the development accounts above: the development provider and `/api/auth/**` still exist only for local work and still refuse to run in production; the account layer lives in `apps/web/src/lib/account/` and is reached only through `AccountAuth` (`types.ts`).

| Piece | File | Notes |
| --- | --- | --- |
| Interface | `types.ts` | `signUp`, `signIn`, `verifyEmailLink`, `requestPasswordReset`, `resendVerification`, `updatePassword`, `getUser`, `refresh`, `signOut`. |
| Supabase Auth | `supabaseAuth.ts` | Eight calls to the project's `/auth/v1` REST API with `fetch`. No SDK, no new dependency. Supabase stores the password hashes, sends the emails and signs the tokens. |
| In-memory | `memoryAuth.ts` | Development and tests only; `runtime.ts` never selects it in production. "Emails" go to an outbox that `/api/dev/account-outbox` shows (404 in production). |
| Routes | `app/api/account/*`, logic in `handlers.ts` | `signup`, `login`, `logout`, `verify`, `forgot`, `resend`, `password`, `me`, `refresh`. |
| Pages | `app/(auth)/account/*`, `app/(member)/account` | Sign in, sign up, forgot, confirm, reset, and the signed-in account page, built on `AuthCard`. `/login` redirects to `/account/sign-in` when `LIBRARY_ENABLED` is on. |

### What the owner sets in the Supabase dashboard

(Documented, not done by the code. A person with the project does these once, in a staging project first.)

1. **Authentication > Providers > Email**: enabled; **Confirm email: ON** (sign-in must not work before the address is confirmed); **Secure email change: ON**. Leave Google, Apple and every other provider **off** (the privacy and cookie notices have not been updated for them).
2. **Authentication > Policies**: minimum password length **12**; require upper, lower and digits is optional (the site's own rule is length only, 12 to 128); **Prevent use of leaked passwords: ON** where the plan allows it (the site shows a friendly message when Supabase refuses a password).
3. **Authentication > Sessions**: time-box sessions (for example **7 days**) and set an inactivity timeout (for example **24 hours**). "Remember me" is not offered; the browser cookies are session cookies.
4. **Authentication > URL Configuration**: Site URL `https://www.learnthrivetuition.co.uk`; add the staging host to the redirect allow-list only on the staging project.
5. **Authentication > Email Templates**: replace the **Confirm signup** and **Reset password** links so they open the site's confirm page and carry the one-time token hash, which the page spends with a button press (a POST), so a mail scanner opening the link cannot use it up:
   - Confirm signup: `{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=signup`
   - Reset password: `{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=recovery`
   Keep the wording plain and do not include the person's password or any other data. Set a **custom SMTP** sender (Resend works) from the verified domain so the emails are not sent from Supabase's shared address.
6. **Authentication > Rate Limits**: leave Supabase's limits on; the site adds its own (below).
7. Confirm in **Auth > Users** that a new sign-up gets a row in `public.profiles` (the trigger in `0001_core.sql`) with `adult_confirmed_at` set. If it does not, the account page redirects to sign-in rather than crash.

### Session cookies

Two cookies, set only after a person signs in or opens an emailed link, never on a public page: `learnthrive_acct` (the access token, about an hour) and `learnthrive_acct_r` (the refresh token). Both are **httpOnly, SameSite=Lax, Path=/, Secure in production, and session cookies** (no Max-Age: gone when the browser closes). Nothing is kept in `localStorage` or `sessionStorage`. A Server Component cannot set cookies, so a page that finds an expired access token redirects through `/api/account/refresh`, which renews (refresh tokens are single use and rotate) or clears the session and sends the browser back (`next` must be a path on this site: `safeNextPath`).

### Limits

- Sign-in: **8 failed attempts per email address and 20 per visitor address in 15 minutes** (`lockout.ts`; failures only, so a good sign-in never counts; a correct password during a lockout is still refused). Supabase applies its own limits too.
- Sign-up: 5 per visitor address per hour; password-reset and resend: 6 per hour; email-link spending: 30 per 15 minutes; set-password: 10 per 15 minutes; each also has a whole-route ceiling (`handlers.ts`). In-process, so right for one Render instance (see `docs/RENDER.md`).
- Sign-up, forgot and resend carry the site's human check, a honeypot and a minimum time. Sign-in does not (the lockout is its guard).
- Every state-changing route checks the request's Origin first (`originAllowed`).
- Sign-up, reset and resend give the **same answer for an address that has an account and one that does not**; a wrong password and an unknown address give the same 401 message and take the same time.
- Logs hold counters and reason codes only: no address, name, token or password (`logOutcome`).

### Tested, and not

Tested here: validation, lockout, both providers (Supabase against a faked `fetch` that checks request shapes and every error-code mapping), every route's logic, the cookie flags, and a full browser journey (sign up, confirm, sign out, sign in, reset) with axe. **Not** tested: a real Supabase project (email delivery, the dashboard settings above, the email templates, the leaked-password check) and a real browser on a phone. Do the staging run in `docs/DEPLOYMENT.md` before switching `LIBRARY_ENABLED` on.

## Production safety

`assertNotProductionWithoutRealProvider()` (called from `getAuthProvider()`, the only way the rest of the app obtains an `AuthProvider`) throws immediately if `NODE_ENV=production` and no real provider has been wired in. This is deliberate and load-bearing, not a placeholder to relax later: it means `next start` (Next's production server) cannot silently serve the five hard-coded development accounts. It also means the E2E auth tests must run the dev server (`next dev`), not a production build — see `apps/web/playwright.config.ts`'s comment on this.

## What's not built yet

- Password reset (deliberately deferred — plan section 7 explicitly says not to build this infrastructure yet).
- Account lockout after repeated failed attempts (a "disabled" account exists as a distinct state, but nothing currently *transitions* an account into it automatically).
- CSRF protection beyond `SameSite=Lax` (adequate for same-site form/fetch submissions from this app's own pages; would need revisiting if this app ever needs to accept authenticated cross-site requests).
- Multi-factor authentication.
- Any of this surviving a server restart.
