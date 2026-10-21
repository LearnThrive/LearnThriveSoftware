# Supabase: what ran on the real stack, and what it found

Written 21 October 2026 (plan20). Until this, the schema, the row level security and the repositories were proved on PGlite (Postgres compiled to WASM) and the Auth and Storage code against a faked `fetch`. This page records the run on a **real local Supabase stack** (Postgres 17, Auth, PostgREST, Storage, the pooler, a mail catcher), what differed from the fakes, and how each difference was fixed. **Nothing here ran against the hosted project: that waits for the owner** (see the last section).

## The stack

Run with `npm run supabase:start` (the Supabase CLI, installed as a pinned npm dependency, `supabase@2.121.0`: its Windows binary ships as an ordinary optional package, so **no install script runs**; the choice and the `--ignore-scripts` install are recorded in the commit). The configuration is `supabase/config.toml`, committed with no keys (it replaces the earlier decision not to commit one).

| Component | Version / image |
| --- | --- |
| Supabase CLI | 2.121.0 |
| Postgres | 17.11 (`supabase/postgres:17.11.0.004`), matching the hosted project's major version |
| Auth (GoTrue) | v2.197.0 |
| PostgREST | v16.4 |
| Storage API | v1.82.1 |
| Pooler (Supavisor) | 2.9.13 |
| Mail catcher (Mailpit) | v1.31.3 |
| Gateway (Kong) | 2.8.1 |
| Studio | 2026.10.12 |

Everything not used is off (realtime, edge functions, analytics, the S3 protocol, vector, GraphQL exposure). Auth is: email confirmation required, sign-in by email only, anonymous sign-ins off, no external provider, passwords of 12 characters or more with no composition rules (the site's own rule), email links that open the site's own `/account/confirm` page with the one-time token (`supabase/templates/`).

**Run when finished: `npm run supabase:stop`.** See "The local stack is open to the network" below.

## What ran

`npm run test:realstack` runs everything below, one file at a time (the store test empties the local tables). **174 tests, 174 passed.**

| What | Tests | Where |
| --- | --- | --- |
| All nine migrations (`0001` to `0009`) applied from nothing (`supabase db reset`) on real Postgres 17, each first time | n/a | CLI |
| `packages/data/src/realstack.test.ts`, **66 tests in four groups**: (1) the adversarial row level security suite through PostgREST with **real user tokens** (cross-family reads, writes, re-parenting with and without a deliberately widened grant, role escalation, server-only tables, file paths, drafts, private helpers, the admin's limits); (2) Auth for real: sign-up, the emailed link, confirmation, password rules, reset, refresh rotation, sign-out, no anonymous sign-in, no social login; (3) Storage for real: private buckets, MIME and size limits, nobody but the server can list, read, write, delete, move or sign, a signed URL works and a changed, missing, swapped or expired one fails; (4) what the Data API exposes: only `public`, no GraphQL, the schema description shows an anonymous caller only the catalogue | 66 | `packages/data/src/realstack.test.ts` |
| The Library store's 29-test contract on real Postgres through the production connection code, **directly, through the pooler, and as the narrow `learnthrive_server` role** | 87 | `realstack.store.test.ts` |
| The narrow role: attributes, what it can and cannot do, exact grants, three functions only | 8 | `realstack.role.test.ts` |
| The site's real route handlers over real Auth, the production database connection and the mail catcher (sign-up, link, session, rename, token renewal and rotation, sign-out, reset) | 4 | `apps/web/tests/realstack.app.test.mjs` |
| The real import script as a child process (dry run, one bad file stops everything, apply with the new and the legacy key formats through the pooler, re-apply, version 2), the download route from real Storage, the entitlement sync, the retention job (storage first, then rows) | 4 | `realstack.library.test.mjs` |
| `promote-admin`: refusals change nothing, a promoted account really has administrator reach | 3 | `realstack.admin.test.mjs` |
| `supabase-smoke`: 11 steps pass, nothing is left behind, an existing account is never touched | 2 | `realstack.smoke.test.mjs` |

The probes (`scripts/supabase-verify.mjs`) against the stack: 15 pass, 0 fail, 5 notes. The unit suites stay green without the stack (PGlite 168, web 621).

## What differed from the fakes, and the fix

| # | Finding | Fix |
| --- | --- | --- |
| 1 | **A password over 72 bytes is refused by Auth** (`validation_failed`, bcrypt's limit, counted in bytes: 36 two-byte letters are fine, 37 are not). The site allowed 128 characters, and `supabaseAuth.ts` mapped `validation_failed` to "invalid email". | The site refuses over 72 bytes in its own words; a password problem from the service now maps to a password message. |
| 2 | **The name shown after a rename was stale.** `public.profiles` is the source of truth (the account page and the download stamp use it), but the sign-in response and `/me` used the name Auth stored at sign-up. | Both now use the profile, falling back to Auth's name if it cannot be read. |
| 3 | **A consent withdrawal time came from the person's device**: slightly behind the database clock it was refused by the check constraint, and in the future it recorded a withdrawal that had not happened. | Migration `0008`: the first withdrawal is stamped with the database's `now()`. |
| 4 | **`postgres` has no grant option on the `auth` schema**, so granting the narrow role access to `auth.users` silently did nothing (Postgres only warns). | Migration `0009`: two `SECURITY DEFINER` functions, `auth_email` and `auth_user_by_email`. The role never touches the auth schema; the repository and `library:grant` use them. |
| 5 | **A generated column runs with the inserting role's privileges.** The search column of `resources` calls `private.tags_to_text`, so the narrow role could not insert a resource. | The script grants `usage` on `private` and `execute` on that one function, and a test pins the exact list of three functions the role may run. |
| 6 | The local config demanded upper case, lower case and a digit (copied from the old docs), so the stack refused passwords the site accepts, with a message ("too easy to guess or in a breach") that did not fit. | Config aligned: 12 characters, no composition rules, as plan20 says. |
| 7 | **Key formats.** A legacy JWT key sent only as `apikey` is refused (401); it must also be the bearer. The new `sb_publishable_` and `sb_secret_` keys work as the `apikey` alone. | See "The key-format decision". |
| 8 | **Refresh tokens**: GoTrue tolerates a token being presented again for the 10 s reuse interval and keeps the newest predecessors usable; an older one is refused (`refresh_token_already_used`). The earlier assumption of strict single use was too simple. | Documented; the site's own renewal is unaffected. |
| 9 | Sign-up with an address that already has an account returns `422 user_already_exists` (the faked tests assumed it, the real service confirms it). | None needed: `supabaseAuth.ts` already hides it, and a test proves the route answers identically. |
| 10 | Storage answers an authorisation failure with HTTP 400 and the real code (403 or 404) in the body. | None needed: the site only tests `response.ok`. |
| 11 | PostgREST refuses an anonymous caller with 401 and a signed-in one with 403, both SQLSTATE `42501`; an update RLS hides returns an empty list, not an error. | The suite asserts each. |
| 12 | `postgres` (not a superuser) may **create and alter a `bypassrls` role**, but Postgres refuses even the words `NOSUPERUSER` or `NOREPLICATION` unless you are a superuser. | The script writes only the attributes it needs. |
| 13 | The **local gateway exposes Studio's database tool**: `/pg/query` runs SQL as `postgres` with no key. | Local only (see below); `supabase-verify` fails it on a hosted project. |

## The key-format decision

**The site should use the new keys: a publishable key (`sb_publishable_...`) and a secret key (`sb_secret_...`), sent as the `apikey` header alone.** `apps/web/src/lib/supabaseKeys.ts` decides: a legacy JWT key goes as the `apikey` and the bearer; an `sb_` key goes as the `apikey` only, because a non-JWT string is not a valid bearer token and the hosted gateway may refuse it (the local one happens to accept it). A signed-in person's own token is always the bearer for a call made for them. Why the new keys: they can be created and revoked one at a time without rotating the project's JWT secret (which would sign every user out), they are not JWTs so they carry no claims to decode, and Supabase is retiring the legacy `anon` and `service_role` keys. **Both formats are tested** against the real stack (the import tool ran once with each) and against fakes. Still to verify on the hosted project: `supabase-verify` reports whether the hosted gateway also accepts the key as a bearer; the site does not depend on it.

## The narrow database role

`scripts/create-server-role.mjs` makes `learnthrive_server` (see `docs/SUPABASE_MIGRATION.md` for the exact grants). **Outcome on the real stack: `bypassrls` is allowed**, the role works directly and through the pooler, and the whole 29-test store contract passes as that role. The password goes in as a SCRAM verifier so the plaintext is never in a statement or a log. **Not yet known for the hosted project**: whether it allows the same (Postgres permits it for a `createrole` role with `bypassrls`, which the hosted `postgres` role is; the first hosted run shows). If it does not, the fallback is the `postgres` role through the pooler, which bypasses row level security too, so the extra risk is the breadth of the role, not a different security model; then add a test that fails if any repository statement lacks its family scope.

Two behaviours of the **pooler** worth knowing before rotating the password (`docs/SUPABASE_RUNBOOK.md`):

- After a role's password changes, Supavisor keeps the old verifier cached and refuses **both** passwords for about **10 to 16 seconds** (measured).
- A burst of refused attempts trips a **tenant-wide circuit breaker** ("too many authentication failures, new connections are temporarily blocked") that blocked every pooled connection, including `postgres`, for about **a minute**. Do not retry in a tight loop.

## The local stack is open to the network

`supabase start` publishes its ports (the gateway 54321, Postgres 54322 with the password `postgres`, the pooler, Studio 54323 and the mail catcher 54324) on **all network interfaces**, not just this machine, and the gateway serves Studio's database tool at `/pg/` **without any key**: `POST /pg/query` runs SQL as `postgres`. On a trusted network with the laptop's firewall that is a development convenience; on a café or hotel network it is a hole into a database of synthetic data (and a foothold on the machine's Docker). The CLI has no option to bind to the loopback address.

What to do: **stop the stack when you are not using it** (`npm run supabase:stop`), never run it on a public network, and if you want it closed at the source set Docker's default bind address to `127.0.0.1` (Docker Desktop, Settings, Docker Engine: `"ip": "127.0.0.1"`). That is a system setting, so it was left for the owner. `scripts/dev-services.mjs`'s own containers (Ollama and the voice sidecar) are already published on `127.0.0.1` only.

## Where PGlite and the real stack differ (kept honest)

PGlite stays as the fast, offline proof and runs in every `npm test`. The real stack adds: roles and their attributes as Supabase sets them, `bypassrls`, ownership and grant options, the Auth and Storage services, PostgREST's error codes, the pooler, the mail templates and real timings. The harness connection on PGlite is a superuser, which hides everything in the 4th, 5th and 12th rows above; that is why the narrow role is tested only on the real stack.

## The hosted project: not done, and what it needs

The hosted project (`learnthrive-prod`, London, Postgres 17) is **empty and was not touched**. Plan20's section 5 needs the owner:

1. **Link:** `npx supabase link --project-ref vwsjvdpkgjhwmqmufmrh`. The CLI asks for the database password; the owner types it (or sets `SUPABASE_DB_PASSWORD` for that shell session only).
2. **Dry run:** `npx supabase db push --dry-run` lists the nine migrations that would be applied (`0001` to `0009`). **Show it to the owner and stop for approval.** Then `npx supabase db push`.
3. **Advisors:** run the Security and Performance advisors (dashboard, Database, Advisors, or the CLI) and resolve every security warning in a new migration. The local stack cannot show hosted-only warnings.
4. **The server role:** the owner generates the password (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), then, in one shell session, `DATABASE_ADMIN_URL=... LEARNTHRIVE_SERVER_PASSWORD=... node scripts/create-server-role.mjs --host <host>` (typed confirmation). Re-run it after any migration that adds a table.
5. **Probes:** `SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run supabase:verify` (read only).
6. **Smoke test:** `SMOKE_EMAIL=you+smoke@your-domain npm run supabase:smoke -- --host <api host> --mailbox prompt` (writes one test account, one resource and one file, and removes them).
7. **First administrator:** `DATABASE_URL=... npm run db:promote-admin -- --email ... --host ...` after that person has signed up and confirmed.

`LIBRARY_ENABLED` and the portal switch stay unset in production throughout.
