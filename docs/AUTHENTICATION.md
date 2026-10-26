# Authentication

## Status: one sign-in (the account layer), plus a development-only staff provider

There is **one sign-in page, `/login`**, and it is the Library's account sign-in (the one LearnThrive AI always used): real sign-up with a verified email, lockout, Supabase Auth in production, an in-memory stand-in in development. Tutors, administrators, enrolled families and Library members all use it; what a person finds afterwards follows from who they are ("One sign-in" below). The development provider described under "The abstraction" still exists for local work, but nothing in the UI posts to it any more.

Everything from "The abstraction" down to "Route protection" describes the **development-only** provider. It is not production-ready, and the code itself refuses to run as production auth — see "Production safety" below. The real thing is the account layer under "Library accounts"; what is still missing for the signed-in app in production is its *data* (the dashboard runs on in-memory demo records), not its sign-in — see "One sign-in" below.

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

- `requireSession()` — redirects to `/login?next=<the page asked for>` if there's no valid session (through `/api/account/refresh` first if an account session has merely lapsed). Used by the dashboard layout, so every route under `/dashboard/**` is automatically protected.
- `requireRole(allowed: Role[])` — as above, plus redirects to `/403` (not back to `/login`) if the signed-in user's role isn't in the allowed list. A logged-in Student hitting an Admin-only page should see "you don't have access", not be bounced back to a sign-in form they already used successfully.
- `requireRoleForApi(allowed: Role[])` — the same check for a Route Handler, where `redirect()` doesn't apply; returns `null` so the caller shapes its own JSON error response.

`/dashboard/admin` is the first real role-restricted route, proving this end to end (see `docs/ROLE_PERMISSIONS.md`).

## One sign-in

`/login` is the account sign-in. A person signs in once and the same session serves the dashboard, the classroom, the Library and LearnThrive AI.

| Who | What they find | Lands on |
| --- | --- | --- |
| `ADMIN`, `TUTOR` | the dashboard, lessons, classroom. An administrator also holds the whole Library and LearnThrive AI by role; a tutor only what their own standing gives | `/dashboard` |
| Enrolled family (an active tuition assignment) | **everything**: the dashboard, lessons, classroom, the Library, LearnThrive AI | `/dashboard` |
| Library subscriber, or a granted account, not enrolled | the Library and LearnThrive AI **only**, never the dashboard | `/library/study-buddy` (`/library` where LearnThrive AI is closed) |
| Signed in with nothing yet | their account page; LearnThrive AI says what it is included with | `/account` |

**One rule decides it:** `platformAccess(role, facts)` in `packages/data/src/library/access.ts`, over the same facts `canAccess` reads (enrolled, subscription, admin grant). It is pure and has a table test, including a test that it agrees with `canAccess` for every role and combination of facts. The sign-in routes (`destinationFor`/`homePath`), the dashboard and member navigation, the LearnThrive AI page and the assistant's routes all call it, so what a menu offers and what a route allows cannot drift. Enrolment beats a subscription: an enrolled family that also subscribes simply has everything.

**How the dashboard gets its user.** `getSession()` (`lib/auth/session.ts`, behind `requireSession`/`requireRole` and all 87 call sites) answers from the development provider's session first, then from the account session (`lib/access/current.ts`), and only for someone whose access includes the dashboard. A Library subscriber therefore has an account session but no dashboard session, whatever URL they type. The account's id is the user's id; `profileId` (the link to the tutor, parent or student record the dashboard looks people up by) is the development seed record for the development accounts and **nothing in production** until the domain data is real and carries its own link (`docs/SUPABASE_MIGRATION.md`).

**Where you land.** `handleSignIn` returns `next`: the page asked for (`/login?next=`, reduced to a path on this site) if the person's access includes it, otherwise their home. A signed-in person who opens `/login` is sent on at once. `requireSession` redirects a signed-out visitor to `/login?next=<the page they asked for>` (the proxy stamps the path on the request, since a Server Component cannot read its own URL); a lapsed access token (about an hour) goes through `/api/account/refresh` and comes straight back.

**Closed doors stay closed.** The dashboard session exists only where the signed-in app is open: always in development and tests, in production only once `NEXT_PUBLIC_APP_PORTAL_ENABLED=true` (`PORTAL_ENABLED`). Until then a real sign-in cannot reach the in-memory demo data, and an enrolled family lands on LearnThrive AI or the Library instead of the "Portal opening soon" page. Opening the portal is still the owner's decision, and it still needs the domain data behind the dashboard to be real (`docs/PRODUCTION_GAPS.md`).

**Sign-out** (`lib/access/signout.ts`, behind both buttons) ends every kind of session this browser holds and revokes the account tokens at the provider. **A disabled account** gets its own answer only from the in-memory sign-in (after a correct password). With Supabase a banned user reads as any wrong password, deliberately: its docs do not say whether `user_banned` is reported only after a correct password, and a distinct message before that would show a guesser which addresses are banned.

**Navigation.** The dashboard menu gains a "Learning" section (LearnThrive AI, Library) for anyone whose access includes them, shown only where the page behind the link is open (LearnThrive AI configured and approved; the Library catalogue open). The member area (`/library/**`, `/account`) gains a "Dashboard" link for staff and enrolled families. They are two frames over one account, not one embedded in the other. The Library's old address, `/account/sign-in`, redirects to `/login` and keeps `next`.

## Library accounts (plan19 phase C)

The Library has real sign-up. It is a **separate layer** from the development accounts above: the development provider and `/api/auth/**` still exist only for local work and still refuse to run in production; the account layer lives in `apps/web/src/lib/account/` and is reached only through `AccountAuth` (`types.ts`).

| Piece | File | Notes |
| --- | --- | --- |
| Interface | `types.ts` | `signUp`, `signIn`, `verifyEmailLink`, `requestPasswordReset`, `resendVerification`, `updatePassword`, `getUser`, `refresh`, `signOut`. |
| Supabase Auth | `supabaseAuth.ts` | Eight calls to the project's `/auth/v1` REST API with `fetch`. No SDK, no new dependency. Supabase stores the password hashes, sends the emails and signs the tokens. |
| In-memory | `memoryAuth.ts` | Development and tests only; `runtime.ts` never selects it in production. "Emails" go to an outbox that `/api/dev/account-outbox` shows (404 in production). |
| Routes | `app/api/account/*`, logic in `handlers.ts` | `signup`, `login`, `logout`, `verify`, `forgot`, `resend`, `password`, `me`, `refresh`. |
| Pages | `app/(auth)/account/*`, `app/(member)/account` | Sign in, sign up, forgot, confirm, reset, and the signed-in account page, built on `AuthCard`. `/account/sign-in` redirects to `/login`, which is where every sign-in happens. |

### What the owner sets in the Supabase dashboard

**The complete, current list is `docs/SUPABASE_DASHBOARD_CHECKLIST.md`** (every setting, the value, the dashboard path, and which probe confirms it: `npm run supabase:verify`). The notes below are the account-specific reasoning; the checklist wins where they differ. (Documented, not done by the code.)

1. **Authentication > Providers > Email**: enabled; **Confirm email: ON** (sign-in must not work before the address is confirmed); **Secure email change: ON**. Leave Google, Apple and every other provider **off** (the privacy and cookie notices have not been updated for them).
2. **Authentication > Policies**: minimum password length **12** and **no composition rules** (the site's own rule is length only, 12 to **72 bytes**: Supabase hashes with bcrypt and refuses more, which the real stack showed, so the site refuses first); **Prevent use of leaked passwords: ON** where the plan allows it (the site shows a friendly message when Supabase refuses a password).
3. **Authentication > Sessions**: time-box sessions (checklist default **30 days**) and set an inactivity timeout (default **7 days**). "Remember me" is not offered; the browser cookies are session cookies.
4. **Authentication > URL Configuration**: Site URL `https://www.learnthrivetuition.co.uk`; add the staging host to the redirect allow-list only on the staging project.
5. **Authentication > Email Templates**: replace the **Confirm signup** and **Reset password** links so they open the site's confirm page and carry the one-time token hash, which the page spends with a button press (a POST), so a mail scanner opening the link cannot use it up:
   - Confirm signup: `{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=signup`
   - Reset password: `{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=recovery`
   Ready-made files are `supabase/templates/confirmation.html` and `recovery.html` (the local stack uses them, and a real-stack test reads the actual email and checks the link). The link is built from the dashboard's **Site URL**, so a wrong Site URL breaks every email: the smoke test fails if the link points at a local address. Keep the wording plain and do not include the person's password or any other data. Set a **custom SMTP** sender (Resend works) from the verified domain so the emails are not sent from Supabase's shared address.
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

### The first administrator, and the other roles

Roles cannot be self-assigned: the sign-up trigger always creates `CLIENT`, whatever the sign-up metadata says (proved on the real stack with metadata that names `ADMIN`), and no browser key can write `profiles.role`. There is no admin screen that promotes anyone. The one way in is the script `apps/web/scripts/promote-admin.mjs`, run by a person who holds the database connection string:

```bash
cd apps/web
DATABASE_URL=<the server connection string> npm run db:promote-admin -- --email person@example.com --host <the database host>
```

It refuses unless **all** hold: `--host` is given and is the host of `DATABASE_URL` (even for a local database, `--host 127.0.0.1`); the address already has an account whose email is **confirmed**; the operator **types the email address again** at the prompt; and, for a database that is not on this machine, also types the host, at a real terminal. It writes `profiles.role` through the server connection and prints one counter-only JSON line to the console (host, outcome, how many administrators there are now): never the email or a name. The person must sign in again for it to take effect. An administrator's reach (read accounts for support, never conversations or consents) is proved by a real-stack test.

**A tutor** is a `public.tutors` row with a display name and the person's `profile_id`, not a login role of its own. Link one with a single SQL statement in the dashboard's SQL editor, as `postgres`, after the person has signed up and confirmed:

```sql
update public.profiles set role = 'TUTOR' where id = '<the profile id>';
insert into public.tutors (profile_id, display_name) values ('<the profile id>', '<the name families see>');
```

To take a role away: `update public.profiles set role = 'CLIENT' where id = '<the profile id>'`, then ban and sign the person out (`docs/SUPABASE_RUNBOOK.md`). **Multi-factor sign-in for administrators is not built**: until it is, keep the administrator list very short.

### Tested, and not

Tested here: validation, lockout, both providers (Supabase against a faked `fetch` that checks request shapes and every error-code mapping), every route's logic, the cookie flags, and a full browser journey (sign up, confirm, sign out, sign in, reset) with axe. **Also run against a real local Supabase stack** (`docs/SUPABASE_REAL_STACK.md`): the real emails and their links, sign-in before and after confirmation, refresh-token rotation, sign-out, reset, and the password rules. That found three things the fakes could not: the 72-byte limit, the stale name after a rename, and a consent-withdrawal clock problem (all fixed). **Not** tested: the hosted project (the leaked-password check, the Pro-plan session limits, the email sender on the real domain, hosted rate limits) and a real browser on a phone. Run the smoke test (`npm run supabase:smoke`) against the hosted project, with the owner, before switching `LIBRARY_ENABLED` on.

## Production safety

`assertNotProductionWithoutRealProvider()` (called from `getAuthProvider()`, the only way the rest of the app obtains an `AuthProvider`) throws immediately if `NODE_ENV=production` and no real provider has been wired in. This is deliberate and load-bearing, not a placeholder to relax later: it means `next start` (Next's production server) cannot silently serve the five hard-coded development accounts. It also means the E2E auth tests must run the dev server (`next dev`), not a production build — see `apps/web/playwright.config.ts`'s comment on this.

## What's not built yet

- Password reset (deliberately deferred — plan section 7 explicitly says not to build this infrastructure yet).
- Account lockout after repeated failed attempts (a "disabled" account exists as a distinct state, but nothing currently *transitions* an account into it automatically).
- CSRF protection beyond `SameSite=Lax` (adequate for same-site form/fetch submissions from this app's own pages; would need revisiting if this app ever needs to accept authenticated cross-site requests).
- Multi-factor authentication, **including for the website's own administrators** (see the checklist's decisions).
- Any of this surviving a server restart (that is the development provider; the Supabase-backed accounts do).
