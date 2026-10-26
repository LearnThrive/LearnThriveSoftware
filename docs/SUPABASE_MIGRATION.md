# Supabase: schema, security rules and local development

## Status

| Piece | State |
| --- | --- |
| Postgres schema and Row Level Security (`supabase/migrations/0001` to `0009`) | **Proven twice**: in-process with PGlite (WASM Postgres, in every `npm test`), and on a **real local Supabase stack** (Postgres 17, Auth, PostgREST, Storage, the pooler), where all nine apply from nothing and the adversarial suite passes through the real API with real user tokens. See "Proof" below and `docs/SUPABASE_REAL_STACK.md`. |
| A Supabase project (hosted) | **Exists (`learnthrive-prod`, London, Postgres 17) but is empty and untouched.** Nothing has been pushed to it: that needs the owner's approval after the dry run (`docs/SUPABASE_REAL_STACK.md`, "The hosted project"). The settings the owner applies by hand are in `docs/SUPABASE_DASHBOARD_CHECKLIST.md`. |
| Local stack with the Supabase CLI (`npm run supabase:start`) | **Run.** CLI `supabase@2.121.0` (a pinned dev dependency, no install script), a reviewed `supabase/config.toml` with no keys, Docker images and versions listed in `docs/SUPABASE_REAL_STACK.md`. 174 real-stack tests: `npm run test:realstack`. |
| Library repositories (`packages/data/src/library`): accounts, resources, access facts, downloads, billing | **Built (plan19 phases C to E) and run on real Postgres.** `SqlLibraryStore` over a two-line `SqlExecutor`, and an in-memory twin, held to one 29-test contract that runs on the in-memory store, on PGlite, and on the real stack (directly, through the pooler, and as the narrow server role). See "The repositories" below. |
| Account auth against Supabase Auth | **Built and run against real Auth** (`apps/web/src/lib/account/supabaseAuth.ts`, REST over `fetch`, no SDK): sign-up, the emailed link, confirmation, sign-in, refresh, reset, sign-out, through the site's real route handlers. Found and fixed on the real service: the 72-byte password limit and a stale name after a rename (`docs/SUPABASE_REAL_STACK.md`). The in-memory provider and the development auth provider are unchanged. |
| The site's database role | **`learnthrive_server`** (`scripts/create-server-role.mjs`): proven on the real stack. See "A narrower role" below. |
| Operator tools | `promote-admin` (first administrator), `supabase-verify` (read-only probes), `supabase-smoke` (guarded end-to-end test), `check-env`, `check-bundle`: `docs/AUTHENTICATION.md`, `docs/ENVIRONMENT.md`, `docs/SUPABASE_RUNBOOK.md`. |
| Lessons, attendance, reports, notifications, availability, platform settings | **Still future.** They keep the table map further down; no migration exists for them yet. |

`packages/data`'s repository interfaces (`packages/data/src/repositories.ts`) remain the only thing application code talks to. A Supabase-backed provider implements the same interfaces.

## Migrations

All files are in `supabase/migrations/`, numbered so the Supabase CLI applies them in order. **Never edit one that has been applied** (to any project, including a developer's local stack): add a new numbered file. Each is **re-runnable** (`create ... if not exists`, `create or replace`, `drop ... if exists`): applying the whole set a second time changes nothing (tested). They need **Postgres 15 or newer** (`unique nulls not distinct`).

| File | Contents |
| --- | --- |
| `0001_core.sql` | `private` schema, default-privilege lockdown, `profiles` (+ the trigger that creates one per auth user), `tutors`, `clients`, `students`, `client_students`, `tuition_assignments`, `assignment_students`, `consents` |
| `0002_library.sql` | `resources` (with the generated full-text `search` column and GIN index), `resource_files`. Marked placeholder for the phase H pgvector chunk table (not created) |
| `0003_billing.sql` | `billing_customers`, `subscriptions`, `admin_grants`, `entitlements`, `download_events`, `stripe_webhook_events` |
| `0004_assistant.sql` | `chat_sessions`, `chat_messages`, `chat_files` (with deletion deadlines), `usage_counters` |
| `0005_rls.sql` | Grants, SECURITY DEFINER helpers, `ENABLE`/`FORCE ROW LEVEL SECURITY` and every policy |
| `0006_billing_refunds.sql` | `subscriptions.refunded_at` (a full refund ends access) and `subscriptions.ended_at` (when Stripe ended it) |
| `0007_storage_buckets.sql` | The private buckets `library` (PDF only, 25 MB) and `chat-uploads` (JPEG, PNG, PDF, 15 MB), with **no storage policy** for `anon` or `authenticated`. Re-running restores these settings |
| `0008_consent_withdrawal_time.sql` | A consent withdrawal is stamped with the database's `now()`, whatever the caller sent (found on the real stack: a device clock behind the server was refused, one ahead recorded a future withdrawal) |
| `0009_server_lookups.sql` | `public.auth_email(uuid)` and `public.auth_user_by_email(text)`: the only two things the server needs from Auth, as `SECURITY DEFINER` functions, so the site's database role never touches the `auth` schema (`postgres` has no grant option on it) |

The pgvector table for phase H is deliberately **not** created; `0002_library.sql` carries a clearly marked comment block describing it. It will be its own later migration (for example `0006_library_embeddings.sql`), service-role only.

## The repositories

`packages/data/src/library/` has one small interface per concern (`ports.ts`): `AccountRepository` (profile, the family account `clients` row, the name on downloads, the owner of a client, the sign-in email), `ResourceRepository` (published listing with full-text search, filters and facets, drafts for the import tool, file records), `AccessRepository` (what a family holds right now: enrolled, subscription, admin grant), `DownloadRepository` (counter-only audit and the hourly count) and `BillingRepository` (Stripe customer link, the subscription mirror, derived entitlements, webhook idempotency, consents, admin grants). `InMemoryLibraryStore` is used for development and tests; `SqlLibraryStore` runs the SQL below every method, and takes any driver with a `query(sql, params)` method.

- **One contract, two stores**: `src/testing/libraryContract.ts` is run by `libraryMemory.test.ts` and `librarySql.test.ts` (PGlite with these migrations). If the two ever disagree a test fails for one of them.
- **Production connection**: `apps/web/src/lib/db.ts` opens a pooled `postgres` (porsager, exact 3.4.9, no dependencies) connection from `DATABASE_URL`, with `prepare: false` for Supabase's transaction pooler (port 6543). Every statement is parameterised, and every family-scoped statement names its `client_id`, because this connection **bypasses Row Level Security**; RLS (proven in `rls.test.ts`) is the second wall, not the first. It also reads `auth.users.email` for the billing emails.
- **A narrower role** (`learnthrive_server`, made by `apps/web/scripts/create-server-role.mjs`): the site connects as this, **not** as `postgres`. The password comes from the environment and only its SCRAM verifier is sent, so the plaintext is never in a statement or a log; a host that is not this machine needs `--host` and the host typed at a real terminal. Run again after any migration that adds a table (grants are explicit, not default privileges: a test pins that on purpose). Exactly what it has:

  | | |
  | --- | --- |
  | Attributes | log in; **`bypassrls`** (the server names the family on every statement, and the policies are the second wall for the browser keys); not a superuser, cannot create roles or databases, cannot replicate; connection limit 30; statement and idle-in-transaction timeouts of 30 s |
  | Tables | `select, insert, update, delete` on every table in `public`; `usage, select` on its sequences; nothing in any other schema |
  | Functions | exactly three: `public.auth_email(uuid)`, `public.auth_user_by_email(text)` (migration 0009) and `private.tags_to_text(text[])` (the search column of `resources` calls it on every write, with the inserting role's privileges; so the role also has `usage` on `private`) |
  | Cannot | create or alter any object, role or policy; read `auth`, `storage`, `vault`, `supabase_migrations`, `pg_authid`; use `COPY ... PROGRAM`, `pg_read_file`, `SET ROLE`; signal another role's connection |

  **Result on the real local stack: `bypassrls` is allowed** (the `postgres` role may create and alter such a role; it may not even name `NOSUPERUSER` or `NOREPLICATION`, so the script omits them). The 29-test store contract passes as this role, directly. **Not yet known on the hosted project**: whether it allows the same. If it does not, the fallback is the `postgres` role through the pooler (which also bypasses row level security, so the added risk is the breadth of the role, not a different model), plus a test that fails if any repository statement lacks its family scope. One caveat that cannot be removed: **a role can change its own password** (Postgres allows it), so a compromised server could lock the site out of its database; the runbook covers recovery.
- **Tested against a real server**: the `postgres` driver's arrays (`tags`, `flags`), timestamps, `bigint` and JSON, directly and through the pooler in transaction mode with `prepare: false`, by the same contract that the in-memory store passes (`packages/data/src/realstack.store.test.ts`). The import tool (`docs/LIBRARY.md`) ran against real Storage too.

## How access is enforced

- **The family boundary is `public.clients`.** A signed-in profile owns at most one `clients` row (`owner_profile_id` is unique). A user reads and writes only rows that belong to that client, or (for `consents`) to their own profile.
- **Students under 18 never hold an account.** `students` has no email, no auth user and no login column. A student belongs to a family through `students.client_id` and `client_students` (a second guardian is linked by the server only, after verification, and can read but not change the student). `students.is_minor` defaults to true and is not user-writable; it is what the assistant and voice gates will read.
- **The billing holder is an adult.** A `clients` row can be created only by a profile whose `adult_confirmed_at` is set. That timestamp is a self-declaration made at sign-up (the sign-up route passes `adult_confirmed: "true"` in the user metadata; the `on_auth_user_created` trigger records it) and cannot be edited afterwards by the user.
- **Roles cannot be self-assigned.** The profile trigger always creates `role = 'CLIENT'`, whatever the sign-up metadata says. No API role has an `INSERT` grant on `profiles` or an `UPDATE` grant on `role`. `private.is_admin()` reads `profiles.role` for `auth.uid()` (which comes from the signed JWT) and so cannot be spoofed.
- **Column-level grants.** `authenticated` gets `INSERT`/`UPDATE` only on the exact columns listed in `0005_rls.sql`. Nothing that decides access (`role`, `owner_profile_id` after insert, `client_id` after insert, `is_minor`, `active`, `delete_after`, `granted_at`, ...) is updatable. A test pins the complete list of writable columns, so widening it is a conscious change.
- **Policies carry `USING` and `WITH CHECK` anyway**, so even if a grant were widened by mistake a row could not be moved to another family. `rls.test.ts` proves this by temporarily widening grants and trying the move.
- **Default privileges are revoked** (`anon`/`authenticated` get nothing on new tables, sequences or functions; new functions are not executable by `PUBLIC`). Supabase's default is the opposite.
- **SECURITY DEFINER helpers** (`private.is_admin`, `my_client_id`, `my_tutor_id`, `is_adult_confirmed`, `student_in_my_family`, `is_my_assignment`, `assignment_in_my_family`, `handle_new_user`, `link_student_to_owner`, `public.request_chat_deletion`) all set `search_path = ''`, use schema-qualified names, and are closed to `anon` and `PUBLIC`. The `private` schema is not in the API's exposed-schema list.
- **`FORCE ROW LEVEL SECURITY`** is set on every table that no definer helper reads; the others have RLS enabled (a forced policy would apply to the helper's own owner and break it).

### Who can do what

| Table | anon | signed-in user | service role (server) |
| --- | --- | --- | --- |
| `resources` | read **published** rows (`published_at <= now()`) | the same; admin also sees drafts and scheduled | all |
| `resource_files` | no | no | all (the only place storage paths exist) |
| `profiles` | no | read own; edit `display_name` only | all |
| `tutors`, `tuition_assignments`, `assignment_students` | no | tutor: own rows. Family: assignments with one of its students, and only the `assignment_students` rows for its own students. Admin reads all. No writes | all |
| `clients` | no | read own; insert own (adult declared); no update/delete | all |
| `students` | no | read own family's; insert/rename/delete own family's. Cannot change `client_id`, `is_minor`, `active` | all |
| `client_students` | no | read own links; no writes | all |
| `consents` | no | read own; insert own (and only about own students); set `withdrawn_at` once | all |
| `billing_customers`, `admin_grants`, `download_events`, `stripe_webhook_events` | no | **no access at all** | all |
| `subscriptions`, `entitlements`, `usage_counters` | no | read own family's; no writes | all |
| `chat_sessions` | no | read own (not those marked for deletion); create (own family, own students); edit `title`; delete via `request_chat_deletion()` | all |
| `chat_messages`, `chat_files` | no | read those of own visible chats; no writes | all |

Admins (profile role `ADMIN`) get read access for support on profiles, tutors, clients, students, links, assignments, subscriptions, entitlements and all resources. They get **no** access to chats, uploads, consents or usage, and no write access through their own session: admin actions run on the server with the service role after `requireRole(["ADMIN"])`.

### Tables and the domain model

| Domain / current | Table | Notes |
| --- | --- | --- |
| `AuthenticatedUser`, dev credential store | `auth.users` + `profiles` | `profiles.id = auth.users.id`. Roles keep the existing four values. Replaced in production by a `SupabaseAuthProvider` behind the same `AuthProvider` interface (`docs/AUTHENTICATION.md`). |
| `Tutor` | `tutors` | `profile_id` nullable. No `email` column (it is the auth user's); added with the staff migration if needed. |
| `Client` | `clients` | The family and billing account. Name lives in `profiles.display_name`, email in `auth.users`. `phone` is not stored yet (arrives with the lessons migration, if needed). |
| `Student` | `students` | Display name (first name or nickname) and year group only. |
| `ClientStudentLink` | `client_students` | Composite key `(client_id, student_id)`; the owning family is linked automatically. |
| `TuitionAssignment` | `tuition_assignments` | `title`, `subject`, `level`, `tutor_id`, `status`. The lesson defaults (`defaultDurationMinutes`, location, notes, report approval) arrive with the lessons migration, because they may hold internal notes and should not be visible to families by accident. `clientIds` is never stored: it is derived through `client_students`. |
| `TuitionAssignment.studentIds` | `assignment_students` | Normalised join table. |
| Enrolment | derived | `public.client_is_enrolled(client_id)`: true while a linked student is on an `ACTIVE` assignment. The server mirrors it into `entitlements` (`source = 'enrolled'`). |
| (new) Library | `resources`, `resource_files` | Catalogue columns are public once published; paths are in `resource_files` and are never exposed. `authorship` is mandatory and must contain a letter or digit. |
| (new) Billing | `billing_customers`, `subscriptions`, `admin_grants`, `entitlements`, `stripe_webhook_events`, `download_events` | Stripe stays the source of truth; these mirror it. Webhook payloads are not stored. `download_events` is counter-only (flags are machine tokens; a check rejects free text such as an IP address or email). |
| (new) Assistant | `chat_sessions`, `chat_messages`, `chat_files`, `usage_counters` | `delete_after` defaults: chat 30 days, uploads 7 days. |

Deleting an auth user removes the profile, the family account, its students, links, subscriptions, entitlements, chats and counters (cascade). `download_events` rows are kept with `client_id` set to null. **Storage objects are not removed by the database**: the account-deletion and retention jobs must read `chat_files.storage_path` (and delete the objects) before or as the rows go.

## What other code must call

- **Server code uses the service role** (secret key, server environment only, never sent to a browser) for everything marked "service role" above: entitlement sync, Stripe webhook, download audit and rate limit counters, chat messages and files, import tool, retention jobs. A user-scoped client (the user's JWT) is used only for the user-writable operations in the table above, so RLS stays in force.
- `public.client_is_enrolled(uuid)`: server only (execute is granted to `service_role` only).
- `public.request_chat_deletion(session_id uuid) returns boolean`: signed-in user; hides the chat at once and queues it for the retention job; returns false for someone else's chat or one already queued.
- `canAccess(account, resource)` stays a server function. The database supplies its inputs (`entitlements` windows, `subscriptions.status` and `current_period_end`, `admin_grants`, `resources.access_tier`), but access to a file is decided on the server, which then issues a 60 second signed URL.
- Retention job: delete `chat_messages` / `chat_files` whose `delete_after < now()` and chats with `deletion_requested_at` set, removing the storage objects first.
- Row counts are not a rate limit: a signed-in user with a valid token could insert many `students`, `consents` or `chat_sessions` rows directly against the API. The browser never talks to Supabase (the Content Security Policy keeps `connect-src 'self'`); all traffic goes through the site's server routes, which apply the rate limits. Do not expose the anon key to the browser.

## Proof: running the tests

**Two layers.** The fast, offline layer is PGlite (`@electric-sql/pglite` 0.5.10, a `devDependency` of `packages/data` only; Apache-2.0, installed with `--ignore-scripts`, no network use at run time, runs Postgres 18 in WASM): it runs in every `npm test`. The real layer is the local Supabase stack, below. PGlite cannot show roles and ownership as Supabase sets them, Storage, PostgREST, Auth, the pooler or real timings, which is why the real layer exists.

```
cd packages/data
npx tsx --test src/schema.test.ts src/rls.test.ts     # database tests (about 10 s)
npx tsx --test src/library*.test.ts                    # both Library stores against one contract, canAccess, the billing derivation
npx tsx --test src/inMemoryProvider.test.ts            # unchanged in-memory provider tests
npm test                                               # all of the above (tsx --test src/*.test.ts)
```

- `packages/data/src/testing/pglite.ts` is the harness: a fresh PGlite instance, a Supabase prelude (`auth.users`, `auth.uid()` reading the JWT `sub` setting, the roles `anon` / `authenticated` / `service_role` with Supabase's default grants), then every migration in order. Helpers `asUser(id, fn)`, `asAnon(fn)`, `asService(fn)` run `fn` in one transaction with `SET LOCAL ROLE` and the JWT claims set; `asOwner(fn)` is the superuser for fixtures. The API is documented in the file's header.
- `packages/data/src/testing/fixtures.ts` has `createFamily` and `createResource` for seeding.
- `schema.test.ts`: migrations apply in order and re-apply as a no-op, RLS enabled on every table, every table has a policy or is deny-all, forced RLS list, complete list of user-writable columns, definer functions pinned, constraints (authorship, enums, checksums, paths), full-text search and its GIN index, entitlement and webhook constraints, retention defaults, cascade deletion.
- `rls.test.ts`: adversarial tests as Alice, Bob, Carol, Dora, a tutor, an admin and anon. Reads are isolated per family on every family table; writes across families, re-parenting rows (also with a deliberately widened grant), role escalation, self-granting access, reading file paths, drafts and scheduled items, and calling private helpers are all refused.

Limits of the PGlite layer: PGlite is Postgres but not Supabase. Storage, PostgREST, GoTrue, the pooler and the CLI's migration bookkeeping are not exercised, and the harness connection is a superuser, so tests run SQL as a role directly. **The real layer closes that:**

### The real local stack

```bash
npm run supabase:start       # the CLI (needs Docker); first run pulls the images
npm run supabase:reset       # apply every migration from nothing (local only)
npm run test:realstack       # 174 tests, one file at a time
npm run supabase:stop        # when you are done: the stack is open to the network (docs/SUPABASE_REAL_STACK.md)
```

The same adversarial cases as `rls.test.ts` run **over HTTP with real user tokens** through PostgREST; Auth, Storage, the narrow role, the repositories, the import tool, the download route, the retention job and the operator scripts run against the real services. Every difference from PGlite and from the faked-`fetch` tests is recorded, with its fix, in `docs/SUPABASE_REAL_STACK.md` (nine migrations; three behaviours were wrong or missing and are now migrations `0008` and `0009` and code fixes). The tests are skipped without `SUPABASE_LOCAL=1`, and the harness refuses any address that is not this machine.

## Local development with the Supabase CLI

1. Install Docker Desktop. The CLI is already a pinned dependency of this repository (`supabase@2.121.0`, installed with scripts disabled): `npx supabase --version`.
2. `npm run supabase:start` brings up Postgres 17, Auth, Storage, the pooler, Studio and a mail catcher, using the committed **`supabase/config.toml`** (no keys: confirmations on, 12-character passwords, sign-in by email only, the site's own `/account/confirm` link in the emails, public-only API). It prints the local URLs and keys; they are not secrets for any real project, and `npx supabase status` prints them again.
3. `npm run supabase:reset` applies `supabase/migrations/*.sql` to the local database from scratch. The buckets come from migration `0007`, not from the config, so the hosted project gets the same ones.
4. To run the **site** on it, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` in `apps/web/.env` to the LOCAL values (`docs/ENVIRONMENT.md`). `npm run check:env` fails any value that points at the hosted project, so production keys cannot slip into development. **Never put the hosted keys in `apps/web/.env`.**
5. **Stop it when you are finished** (`npm run supabase:stop`): the CLI publishes the stack on every network interface and serves a keyless SQL endpoint (`docs/SUPABASE_REAL_STACK.md`).
6. To link the real project: `npx supabase link --project-ref <ref>` (the CLI asks for the database password, which the owner types), then `npx supabase db push --dry-run`, then, **only after the owner has seen the dry run and approved**, `npx supabase db push`. Nothing in this repository pushes anything by itself.

## Project settings the owner applies by hand

**Superseded by `docs/SUPABASE_DASHBOARD_CHECKLIST.md`**, which lists every setting with the value chosen, the dashboard path, and which probe or test confirms it (`npm run supabase:verify`). The text below is kept as the original reasoning. The project exists (London, Postgres 17). Names follow the dashboard and vary slightly between versions.

**Authentication**
- Providers: **Email on; every other provider off** (no Google or Apple until the owner configures them and the privacy and cookie pages are updated first). **Anonymous sign-ins off.**
- **Confirm email: on** (a user cannot sign in until the address is verified). Secure email change on. Secure password change on (recent sign-in required).
- Sign-ups: on, because families create their own accounts. The sign-up form enforces the adult (18 or over) declaration and the app trusts nothing else about age.
- Password rules: minimum length 12; require lower case, upper case and digits (Auth, Sign In / Providers, Email, password requirements). Leaked-password protection on, where the plan offers it.
- JWT expiry: 3600 seconds (one hour) or shorter. Refresh-token rotation on with the default reuse interval. Session time-box: set a maximum session length (for example 30 days) and an inactivity timeout where the plan allows. No "remember me" option exists in the app.
- Rate limits (Auth, Rate Limits): start at or below the defaults; for example email sent per hour as low as the app needs (needs a custom SMTP sender, below), sign-ups and sign-ins per 5 minutes per IP at 30 or fewer, token verifications and refreshes at the defaults. The site's own `rate-limit.ts` and human check stay in front of the routes as well.
- Custom SMTP (Resend or similar, under a data processing agreement) so verification and reset emails come from the LearnThrive domain; the built-in sender is for development only.
- Email templates: plain text or minimal, no tracking, in UK English; the confirmation and reset links must point to the site's own callback route.
- URL configuration: **Site URL** = the production origin. **Redirect URLs** = exactly the production callback and reset URLs (no wildcards in production) plus the local development URLs on a separate local project. A wildcard redirect is an open-redirect risk.
- CAPTCHA: leave Supabase's off. Its providers load third-party scripts, which the Content Security Policy forbids; the site's own server-side human check is used instead.
- Session cookies: Supabase tokens are held by the site's server in `httpOnly`, `Secure`, `SameSite=Lax` cookies. They are never exposed to browser JavaScript.

**Data API**
- Exposed schemas: **`public` only**. `private` must never be listed. Disable the GraphQL endpoint if not used. Keep "extra search path" at the default.
- Keys: the **service role key and the database password live only in the server environment** (Render environment variables), never in the repo, logs or a browser bundle. Rotate them if exposed.

**Storage**
- Create two buckets, both **private** (Public bucket **off**): `library` (Library PDFs) and `chat-uploads` (LearnThrive AI uploads, later phase).
- `library`: file size limit set to the import tool's maximum (for example 25 MB), allowed MIME types `application/pdf`. `chat-uploads`: limit 15 MB, allowed `image/jpeg`, `image/png`, `application/pdf`.
- **Add no storage policies** for `anon` or `authenticated`. With RLS enabled on `storage.objects` and no policy, only the service role can read or write objects: the server issues 60 second signed URLs after `canAccess`. Do not use public URLs anywhere.

**Project hygiene**
- Backups: enable daily backups (and point-in-time recovery if the plan allows); record the retention period in the privacy notice. Chat deletion deadlines (30 and 7 days) apply to backups only as they age out; say so.
- Network restrictions or SSL enforcement on the database: SSL enforced on; restrict direct database access to the Render outbound addresses if the plan allows.
- Owners and access: use named accounts with MFA for the Supabase organisation; no shared logins.
- Record the DPA, the processing region and sub-processors in `LEGAL_REVIEW.md` (the privacy page must name Supabase) before any account is created for a real person.

## Not done, and why

- **Nothing has run on the hosted project.** It is empty. Hosted-only behaviour is unverified: whether it allows the `bypassrls` role, the hosted pooler's behaviour on a password change, the leaked-password check, the Pro-plan session limits, rate limits, the email sender and the advisors. The steps and the owner's approval points are in `docs/SUPABASE_REAL_STACK.md`.
- `supabase/config.toml` **is** committed now (a minimal, reviewed file with no keys), replacing the earlier decision not to: the CLI accepted it, and the real-stack tests depend on it.
- Staff multi-factor sign-in for the website's own administrators is not built (`docs/SUPABASE_DASHBOARD_CHECKLIST.md`, Decisions).

## Table map for what is still future

These entities have no migration yet. They keep the original map so the lessons migration has a starting point.

| Current (in-memory) | Future Supabase table | Notes |
| --- | --- | --- |
| `Lesson` | `lessons` | `startAt` stays a real `timestamptz` (never a naive local column); `classroomRoomId` stays a random UUID, never derived from the row's own `id`. |
| `LessonAttendanceRecord` | `lesson_attendance` | Composite key `(lesson_id, student_id)`, matching the in-memory repository's own key shape. |
| `LessonReport` | `lesson_reports` | `internalTutorNotes`/`confidence` need a column-level or row-level policy that a Client/Student role can never select. The highest-stakes table to get RLS right on; use the same pattern as above (column grants plus policies plus a test that tries to read the internal columns). |
| `TutorAvailabilityBlock` | `tutor_availability` | |
| `Notification` | `notifications` | |
| `LessonActivityEvent` | `activity_events` | Append-only in the in-memory model; add a trigger or `REVOKE UPDATE, DELETE` so the database keeps that guarantee too. |
| `PlatformSettings` | `platform_settings` | A single-row config table unless multi-tenancy is ever added. |
| tuition assignment lesson defaults | columns on `tuition_assignments` | `defaultDurationMinutes`, `defaultLocationType`, `defaultLessonNotes`, `requireReportApproval`; keep the notes column out of any family-readable grant. |

What does not map one to one: the in-memory provider uses `crypto.randomUUID()` and Postgres `gen_random_uuid()` is a direct match; the `SEED_IDS` fixed demo ids are a development convenience with no equivalent in a real seed; `resetDataProvider()` becomes `supabase db reset` plus a seed script.
