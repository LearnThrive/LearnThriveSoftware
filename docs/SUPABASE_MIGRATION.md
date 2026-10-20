# Supabase: schema, security rules and local development

## Status

| Piece | State |
| --- | --- |
| Postgres schema and Row Level Security (`supabase/migrations/0001` to `0006`) | **Written and proven in-process** with PGlite (WASM Postgres). See "Proof" below. |
| A Supabase project (hosted) | **Not created.** The owner creates it and applies the settings under "Project settings the owner applies by hand". |
| Local stack with the Supabase CLI (`supabase start`) | **Not run here**: this machine has no Docker daemon and no Supabase CLI. The SQL is plain Postgres 15+ written for Supabase, and is exercised through PGlite with a Supabase prelude, but it has not been run on the real stack. |
| Library repositories (`packages/data/src/library`): accounts, resources, access facts, downloads, billing | **Built (plan19 phases C to E).** `SqlLibraryStore` over a two-line `SqlExecutor`, and an in-memory twin, held to one contract suite that runs on both (the SQL one on PGlite). See "The repositories" below. |
| Account auth against Supabase Auth | **Built** (`apps/web/src/lib/account/supabaseAuth.ts`, REST over `fetch`, no SDK), tested against a faked `fetch`. **Not run against a real project.** The in-memory provider and the development auth provider are unchanged. |
| Lessons, attendance, reports, notifications, availability, platform settings | **Still future.** They keep the table map further down; no migration exists for them yet. |

`packages/data`'s repository interfaces (`packages/data/src/repositories.ts`) remain the only thing application code talks to. A Supabase-backed provider implements the same interfaces.

## Migrations

All files are in `supabase/migrations/`, numbered so the Supabase CLI applies them in order. Each is **re-runnable** (`create ... if not exists`, `create or replace`, `drop ... if exists`): applying the whole set a second time changes nothing (tested). They need **Postgres 15 or newer** (`unique nulls not distinct`).

| File | Contents |
| --- | --- |
| `0001_core.sql` | `private` schema, default-privilege lockdown, `profiles` (+ the trigger that creates one per auth user), `tutors`, `clients`, `students`, `client_students`, `tuition_assignments`, `assignment_students`, `consents` |
| `0002_library.sql` | `resources` (with the generated full-text `search` column and GIN index), `resource_files`. Marked placeholder for the phase H pgvector chunk table (not created) |
| `0003_billing.sql` | `billing_customers`, `subscriptions`, `admin_grants`, `entitlements`, `download_events`, `stripe_webhook_events` |
| `0004_assistant.sql` | `chat_sessions`, `chat_messages`, `chat_files` (with deletion deadlines), `usage_counters` |
| `0005_rls.sql` | Grants, SECURITY DEFINER helpers, `ENABLE`/`FORCE ROW LEVEL SECURITY` and every policy |
| `0006_billing_refunds.sql` | `subscriptions.refunded_at` (a full refund ends access) and `subscriptions.ended_at` (when Stripe ended it) |

The pgvector table for phase H is deliberately **not** created; `0002_library.sql` carries a clearly marked comment block describing it. It will be its own later migration (for example `0006_library_embeddings.sql`), service-role only.

## The repositories

`packages/data/src/library/` has one small interface per concern (`ports.ts`): `AccountRepository` (profile, the family account `clients` row, the name on downloads, the owner of a client, the sign-in email), `ResourceRepository` (published listing with full-text search, filters and facets, drafts for the import tool, file records), `AccessRepository` (what a family holds right now: enrolled, subscription, admin grant), `DownloadRepository` (counter-only audit and the hourly count) and `BillingRepository` (Stripe customer link, the subscription mirror, derived entitlements, webhook idempotency, consents, admin grants). `InMemoryLibraryStore` is used for development and tests; `SqlLibraryStore` runs the SQL below every method, and takes any driver with a `query(sql, params)` method.

- **One contract, two stores**: `src/testing/libraryContract.ts` is run by `libraryMemory.test.ts` and `librarySql.test.ts` (PGlite with these migrations). If the two ever disagree a test fails for one of them.
- **Production connection**: `apps/web/src/lib/db.ts` opens a pooled `postgres` (porsager, exact 3.4.9, no dependencies) connection from `DATABASE_URL`, with `prepare: false` for Supabase's transaction pooler (port 6543). Every statement is parameterised, and every family-scoped statement names its `client_id`, because this connection **bypasses Row Level Security**; RLS (proven in `rls.test.ts`) is the second wall, not the first. It also reads `auth.users.email` for the billing emails.
- **A narrower role, recommended**: instead of the `postgres` user, create a login role for the server with only what these repositories touch (verify the exact grants on the staging project, and that your plan allows a `bypassrls` role). Sketch:

  ```sql
  create role learnthrive_server login password '<generated>' bypassrls;
  grant usage on schema public to learnthrive_server;
  grant select, insert, update, delete on all tables in schema public to learnthrive_server;
  grant usage, select on all sequences in schema public to learnthrive_server;
  grant select (id, email) on auth.users to learnthrive_server;
  ```
- **Not tested against a real server**: the `postgres` driver's handling of arrays (`tags`, `flags`), timestamps and `bigint` was reasoned from its documentation, not run. A staging run of the import tool (`docs/LIBRARY.md`) and one sign-in covers it.

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

There is no Docker and no `psql` here, so the database behaviour is proven in-process with PGlite (`@electric-sql/pglite` 0.5.10, a `devDependency` of `packages/data` only; Apache-2.0, installed with `--ignore-scripts`, no network use at run time, runs Postgres 18 in WASM).

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

Limits of this proof: PGlite is Postgres but not Supabase. Storage, PostgREST, GoTrue, realtime and the CLI's migration bookkeeping are not exercised. The harness connection is a superuser, so tests run SQL as a role directly; PostgREST callers cannot run arbitrary SQL at all. Before launch the same suite should be run once against a local Supabase stack (`supabase start`) by someone with Docker.

## Local development with the Supabase CLI (needs Docker; not run here)

1. Install Docker Desktop and the Supabase CLI. Check `supabase --version`.
2. From the repo root run `supabase init` once. It creates `supabase/config.toml` next to the existing `supabase/migrations/`. Answer no to the editor-settings prompts. Review the generated file; do not commit keys.
3. `supabase start` brings up Postgres, Auth, Storage and Studio and prints local URLs and keys (local keys only; they are not secrets for any real project).
4. `supabase db reset` applies `supabase/migrations/*.sql` to the local database from scratch.
5. In `supabase/config.toml` set, for local use, `[auth.email] enable_confirmations = true` (so sign-up needs a verified address; local mail appears in Inbucket/Mailpit) and set the site URL and redirect URLs to the local site.
6. Create the buckets locally, either in Studio or in `config.toml` (`[storage.buckets.library]` with `public = false`; the exact key names depend on the CLI version).
7. To link a real project later: `supabase link --project-ref <ref>`, then `supabase db push`. The owner reviews the SQL first; nothing in this repo pushes anything.

## Project settings the owner applies by hand

The project is created by the owner (region: a UK or EU region; check the processing location against the privacy notice). Suggested starting points, owner and legal to confirm. Names follow the dashboard and vary slightly between versions.

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
- Create two buckets, both **private** (Public bucket **off**): `library` (Library PDFs) and `chat-uploads` (Study Buddy uploads, later phase).
- `library`: file size limit set to the import tool's maximum (for example 25 MB), allowed MIME types `application/pdf`. `chat-uploads`: limit 15 MB, allowed `image/jpeg`, `image/png`, `application/pdf`.
- **Add no storage policies** for `anon` or `authenticated`. With RLS enabled on `storage.objects` and no policy, only the service role can read or write objects: the server issues 60 second signed URLs after `canAccess`. Do not use public URLs anywhere.

**Project hygiene**
- Backups: enable daily backups (and point-in-time recovery if the plan allows); record the retention period in the privacy notice. Chat deletion deadlines (30 and 7 days) apply to backups only as they age out; say so.
- Network restrictions or SSL enforcement on the database: SSL enforced on; restrict direct database access to the Render outbound addresses if the plan allows.
- Owners and access: use named accounts with MFA for the Supabase organisation; no shared logins.
- Record the DPA, the processing region and sub-processors in `LEGAL_REVIEW.md` (the privacy page must name Supabase) before any account is created for a real person.

## Not done, and why

- No live Supabase project exists, so nothing here ran on the real service. Everything depending on it is untested: PostgREST behaviour, Auth emails, Storage buckets, rate limits and the CLI.
- `supabase/config.toml` is not committed: it is generated by `supabase init`, and a hand-written file with a key the installed CLI does not know makes the CLI fail. Use the settings above.
- The repositories and the Supabase Auth provider exist (above) but were never run against a real project; see "The repositories".

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
