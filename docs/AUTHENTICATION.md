# Authentication

## Status: development only

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

A server-side, in-memory `Map<string, DevelopmentUser>`, seeded once per server process with five fictional accounts (see `docs/DEVELOPMENT_ACCOUNTS.md`). It resets on every server restart — there is no persistence, by design (this is a prototype, not a place to accumulate real account state).

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

## Production safety

`assertNotProductionWithoutRealProvider()` (called from `getAuthProvider()`, the only way the rest of the app obtains an `AuthProvider`) throws immediately if `NODE_ENV=production` and no real provider has been wired in. This is deliberate and load-bearing, not a placeholder to relax later: it means `next start` (Next's production server) cannot silently serve the five hard-coded development accounts. It also means the E2E auth tests must run the dev server (`next dev`), not a production build — see `apps/web/playwright.config.ts`'s comment on this.

## What's not built yet

- Password reset (deliberately deferred — plan section 7 explicitly says not to build this infrastructure yet).
- Account lockout after repeated failed attempts (a "disabled" account exists as a distinct state, but nothing currently *transitions* an account into it automatically).
- CSRF protection beyond `SameSite=Lax` (adequate for same-site form/fetch submissions from this app's own pages; would need revisiting if this app ever needs to accept authenticated cross-site requests).
- Multi-factor authentication.
- Any of this surviving a server restart.
