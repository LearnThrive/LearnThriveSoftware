# The LearnThrive Library

Living document for the Library programme (`plan19.md`). Built so far: the public information pages and the waitlist (B2), the account and database foundations (C) and the Library for enrolled families (D: catalogue, search, resource pages, watermarked downloads, the import tool). Billing, the LearnThrive AI and voice are not built yet. Extend this file as you go, and keep it true.

## Purpose

A Library of company-made worksheets, exam-style papers, mark schemes and notes. Enrolled students get it included. Anyone else will be able to pay a subscription for all of it. Until accounts and billing exist, two public pages and a waitlist tell people it is coming.

## What the owner has confirmed

These are the only claims the public pages may make about the Library. Do not add to them without the owner:

- The Library holds company-made worksheets, exam-style papers, mark schemes and notes.
- It is included for enrolled students.
- A paid subscription for anyone else is planned.
- It is coming soon.

The plan (`plan19.md`, Phase B2) also allows the pages to say, because they are facts about scope and not claims about quality:

- The subjects and levels: Maths, English, Science and 11+ Preparation (the site's own subject list), Key Stage 2 to A Level.
- How it will work: sign in, browse and download, and that none of this is open yet.

Also decided by the plan (`plan19.md`, sections 3 and 9), none of which is built yet unless stated: content is company-authored and exam-board past papers are not redistributed; access is decided in one server function, `canAccess(account, resource)`; subjects and levels are Maths, English, Science and 11+, KS2 to A Level; payments will be Stripe Billing with hosted Checkout, in pounds, and prices live in Stripe; there is no free trial (free samples instead); the billing account holder is an adult. **The owner has not supplied prices, plan names, document counts, sample previews or a launch date.** The pages show none of them, and make no claim about quality, results or exam-board alignment.

## Phases and status

| Phase | What | Status |
| --- | --- | --- |
| A | Baseline and branch | Built (baseline recorded in `docs/PLAN19_REPORT.md`) |
| B | UI components from `UI Components/` (`/dev/ui-components`) | Built |
| B2 | Public `/library` and `/pricing` pages and the waitlist (no backend) | Built |
| C | Backend foundations (Supabase schema + RLS, accounts, the route carve-out) | Built, proven on PGlite and a faked Supabase; **not run against a real Supabase project** |
| **D** | **Library with enrolled access first** | **Built**, same caveat |
| E | Subscriptions and billing (Stripe) | Not yet |
| F | LearnThrive AI (text and uploads), development only | Not yet |
| G | Voice mode | Not yet |
| H | Answers grounded in the Library (optional) | Not yet |
| I | Hardening, accessibility, deployment notes | Not yet |

Nothing may take a payment, a pre-order or a deposit before Phase E. The gates in `plan19.md` section 6 (legal, AI and children, production provider, owner approvals) must be complete before any production exposure of accounts, billing or the assistant.

## The `LIBRARY_PHASE` flag

`LIBRARY_PHASE` is `info`, `enrolled` or `live`. It defaults to `info`, and so does anything missing or unrecognised (`src/lib/library-config.ts`). `/library` is rendered for each request, so the phase is read when the page is asked for; `/pricing` is still static and reads it (and the prices) when the site is built.

| Value | What it does |
| --- | --- |
| `info` | The coming-soon information pages and the waitlist. No catalogue, no sign-in link, no download. The shipped default. |
| `enrolled` | The catalogue is open (`/library`, `/library/search`, subject, topic, free-sample and resource pages). Accounts can sign in (when `LIBRARY_ENABLED` is on and the backend is configured), enrolled families can download, and anyone with an account can download free samples. The hero says "Open to enrolled students"; subscriptions are still "coming soon" and the waitlist stays open. |
| `live` | Reserved for Phase E (subscriptions). **Until Phase E it reads as `enrolled`.** |

The catalogue also needs a backend: in production the Supabase settings (`docs/DEPLOYMENT.md`), in development the in-memory one. With the phase open but no backend, the `/library/**` pages other than `/library` itself are 404s and `/library` shows the coming-soon content.

## Public routes

| Route | What it is |
| --- | --- |
| `/library` | Overview (what it is, who it is for, subjects and levels, how it works, FAQ, waitlist) with the **catalogue** after the "who it is for" and subjects sections once the phase is `enrolled`: a GET search form (words, subject, level, type), 12 results a page, previous and next links, a subject list. Sets no cookie and uses no browser storage. |
| `/library/search` | The same view on its own page (the icon menu's Search). Not indexed. |
| `/library/subject/<subject>` and `/library/subject/<subject>/<topic>` | One subject (its topics listed) or one topic. A name nobody has published is a 404. |
| `/library/free-samples` | Every published free sample. |
| `/library/<slug>` | A resource: title, description, facts, who made it, and the download box. Anyone can read it; the box offers sign-in, the download button, or says the resource is for enrolled students. Drafts and scheduled resources are 404s. |
| `POST /api/library/download/<slug>` | The download. See below. |
| `/pricing` | The pricing card in a coming-soon state. No payment of any kind. |
| `POST /api/library-waitlist` | The waitlist (unchanged from B2). Stores nothing. |

The waitlist's data flow, retention and lawful basis are in `apps/web/LEGAL_REVIEW.md` ("Library waitlist (plan19 phase B2)") and `docs/RETENTION_AND_DELETION.md`.

## Content model

One row in `resources` per document set (`supabase/migrations/0002_library.sql`), and one or more rows in `resource_files` for its PDFs:

| Field | Rules |
| --- | --- |
| `slug` | The address: lowercase letters, digits and single hyphens, up to 120. Not `search`, `subject`, `free-samples` or `study-buddy` (those are pages). |
| `title`, `description` | 1 to 200 characters, and up to 2000. |
| `subject`, `topic` | Free text, 1 to 80 and 1 to 120 characters. Subject and topic pages come from these exactly. |
| `level` | `KS2`, `KS3`, `GCSE`, `A Level` or `11+`. |
| `examBoard` | Optional, up to 40 characters. Shown in the facts; the public pages make no claim of alignment. |
| `type` | `worksheet`, `exam paper`, `mark scheme` or `notes`. |
| `yearGroup`, `tags` | Optional; up to 20 tags, lower-cased. |
| `version` | Starts at 1. Moves up by one when the import finds a changed file. |
| `accessTier` | `members` (the default) or `free_sample`. |
| `authorship` | **Required.** Who made it. The import refuses a resource without it, and refuses an author that is an exam board or publisher (AQA, Edexcel, Pearson, OCR, WJEC, Eduqas, CCEA, SQA, Cambridge, DfE, CGP, Collins, BBC and a few more): past papers and other people's material are not redistributed. |
| `publishedAt` | Absent or null means a draft, hidden everywhere. A future date means scheduled. Public once the date has passed. |

Files live in the **private** storage bucket `library`, at `<slug>/v<version>/<file>.pdf`, so a new version never overwrites the old one (the old file stays; delete it by hand when you are sure). A file's size, type and SHA-256 are recorded, and the download refuses a file whose bytes no longer match.

## Import tool

`npm run library:import` (`apps/web/scripts/library-import.mjs`, logic in `src/lib/library/import.ts`). A folder holds the PDFs and a `library.json`:

```json
{
  "resources": [
    {
      "file": "quadratics-worksheet.pdf",
      "title": "Quadratic equations",
      "description": "Factorising and the formula, with worked answers.",
      "subject": "Maths",
      "level": "GCSE",
      "topic": "Algebra",
      "type": "worksheet",
      "tags": ["algebra", "quadratics"],
      "accessTier": "members",
      "authorship": "LearnThrive Tuition",
      "publishedAt": "2026-11-01"
    }
  ]
}
```

(`"files": ["a.pdf", "b.pdf"]` instead of `file` for a resource with several PDFs; `slug` defaults to the title.)

```bash
npm run library:import -- --dir ./library-content            # dry run: checks everything, writes nothing
npm run library:import -- --dir ./library-content --apply    # uploads, then writes the rows
```

- Every file is checked with the same code the careers uploads use (a real PDF, not encrypted, no scripting, launch actions or embedded files) plus a 25 MB limit. Every resource must have `authorship`. **One problem anywhere stops the whole run**: nothing is half imported.
- It needs `DATABASE_URL` (a dry run uses it too, to see what is already imported), and for `--apply` also `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Values come from the environment only and are never printed (it prints the database host name, nothing more). Do a staging project first.
- Files go up first and rows second, so a row never points at a missing file. Running it again with nothing changed uploads nothing; a changed file is a new version.
- There is no admin screen in this plan. This is how content goes in.

## Entitlement rules

`canAccess(account, resource, facts, now)` (`packages/data/src/library/access.ts`) is the only place access is decided; the download route and the resource page both call it. In order:

1. An `ADMIN` account can reach everything, drafts included.
2. Anything unpublished (a draft, or scheduled for later) is closed to everyone else, even a free sample, even to someone who holds every entitlement.
3. A free sample is open to any signed-in adult account.
4. Otherwise a members resource needs one of: **enrolled** (an active `TuitionAssignment` links one of the family's students; paused and ended assignments do not count), an open **subscription** entitlement, or an open **admin grant**.

Subscription and grant entitlements are rows in `entitlements` with a window (`starts_at` to `ends_at`, open ended if null); Phase E writes the subscription ones from Stripe state. Every combination is tested in `packages/data/src/libraryAccess.test.ts`.

### Giving an enrolled family access today

There is no admin screen, and the dashboards still run on in-memory development data, so enrolment records go in with SQL in the Supabase SQL editor, by someone who owns the project. The family signs up first (so a profile exists), then for each family:

```sql
-- the family account (safe to repeat) and a student under it
insert into public.clients (owner_profile_id)
  select id from auth.users where email = 'parent@example.com'
  on conflict (owner_profile_id) do nothing;
insert into public.students (client_id, display_name)
  select c.id, 'Student first name' from public.clients c join auth.users u on u.id = c.owner_profile_id
  where u.email = 'parent@example.com';
-- an assignment linking the student (needs a row in public.tutors)
insert into public.tuition_assignments (title, subject, tutor_id, status) values ('Maths tuition', 'Maths', '<tutor id>', 'ACTIVE') returning id;
insert into public.assignment_students (assignment_id, student_id) values ('<assignment id>', '<student id>');
```

Setting the assignment's `status` to `PAUSED` or `ENDED` removes access at once. The alternative that needs no tutor or student rows is an admin grant (Phase E adds a script for it).

## Downloads

`POST /api/library/download/<slug>` (`src/lib/library/download.ts`), in this order: Origin check; signed-in session; the resource must be published; `canAccess`; the hourly cap; the stored file and its checksum; the watermark; then the audit row. Refusals are JSON (`401 signed_out`, `403 no_access`, `404 not_found`, `429 rate_limited` with `Retry-After`, `503 unavailable`), or, for a browser form post (`Accept: text/html`), a redirect back to the resource page with a reason.

- **Cap**: 60 downloads an hour per family account, set by `LIBRARY_DOWNLOADS_PER_HOUR` (1 to 1000). A refused request is not counted.
- **Watermark**: every page of every PDF carries a footer line and a faint diagonal line: "Licensed to (name, or email address if none) on (date and time) UTC. LearnThrive Library: not for sharing or resale." The same line is in the PDF's metadata. It is drawn in standard Helvetica, so characters it cannot draw print as "?". If the stamp cannot be made the download fails: an unstamped file is never sent. This is a deterrent and evidence, not DRM.
- **Audit row** (`download_events`): the family account, the resource, the time and anomaly flags (`near_limit` at 80% of the cap, `repeat_5m` for the same file within five minutes). No name, address, file or IP. The account becomes null if the account is deleted.
- **A deliberate deviation from the plan**: the plan asks for 60-second signed URLs *and* a watermark on every PDF. A signed URL points at the stored original, which has no watermark, and a per-person copy cannot exist before the person asks. So the server reads the original through a 60-second signed URL, stamps it, and sends the stamped copy itself. The browser never receives a storage URL, which is what the signed URL was for.

## Environment variables

Full table in `docs/DEPLOYMENT.md`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LIBRARY_PHASE` | `info` | See above. |
| `LIBRARY_ENABLED` | unset (closed) | Opens the account and Library routes in production (`docs/DEPLOYMENT.md`). |
| `LIBRARY_DOWNLOADS_PER_HOUR` | `60` | Per family account. |
| `LIBRARY_PRICE_MONTHLY`, `LIBRARY_PRICE_ANNUAL` | unset | Display only; `/pricing` reads them at build time. |
| `LIBRARY_WAITLIST_EMAIL` | `ENQUIRY_EMAIL`, then the site address | Where waitlist sign-ups are delivered. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | unset | The account backend, the database and private storage (`docs/AUTHENTICATION.md`, `docs/SUPABASE_MIGRATION.md`). Server only. |
| `LIBRARY_DEV_STORAGE_DIR` | `.library-dev-storage` | Development only: where the dev server keeps seeded PDFs (git-ignored). |

The waitlist also needs the variables every form needs: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CAPTCHA_SECRET` (without them the route answers 503 "email us") and, for a staging host, `ALLOWED_ORIGINS`. No secret appears in the repo or in logs.

## Local development

With no Supabase settings the dev server runs the in-memory backend: sign-up works (the "emails" are at `/api/dev/account-outbox`), and the Library is empty until seeded. Set `LIBRARY_PHASE=enrolled`, then seed (a 404 in production):

```bash
curl -X POST localhost:3000/api/dev/library-seed -H "content-type: application/json" -d '{"action":"catalogue"}'
curl -X POST localhost:3000/api/dev/library-seed -H "content-type: application/json" -d '{"action":"enrol","email":"you@example.com"}'   # or "subscribe" / "grant"
```

Every seeded title says "dev seed" and every file is a one-page synthetic PDF. Nothing here is real content.

## How to run the checks

From `apps/web`:

```bash
npm run lint
npm run typecheck
npm test                                       # all unit and route tests (node --test)
node --test tests/libraryDownload.test.mjs     # download route, watermark, storage
node --test tests/libraryImport.test.mjs       # metadata rules, import plan and apply, the command line
node --test tests/libraryCatalogue.test.mjs    # catalogue address bar, phases, copy
npm run build
```

From `packages/data` (needs no Docker or database: Postgres runs in-process as PGlite):

```bash
npm test      # the schema, the Row Level Security attacks, and the repository contract on memory and Postgres
```

Browser checks run against dev servers. The Playwright config starts both the default one and one on port 3101 with `LIBRARY_PHASE=enrolled` (the `library-open` project):

```bash
npx playwright test tests-e2e/library-open.spec.ts tests-e2e/account.spec.ts --reporter=line --retries=0
npm run test:e2e          # the whole suite
npm run test:prod-smoke   # against a production build (next start); see playwright.prod.config.ts
```

Do not weaken or delete an existing test.

## Tested, and not

Tested: the schema and Row Level Security on PGlite; both stores against one contract; `canAccess` for every combination; the download route (no access, expired, unpublished, rate limit, flags, checksum, watermark present, no unstamped file, no personal data in logs); the import tool including its command line; the catalogue pages and a download in a real browser (axe, 360 px, keyboard, no cookies or storage on public pages, no third-party requests).

**Not** tested: a real Supabase project (Auth emails, Storage, the pooler), the `postgres` driver against a real server, Render, real phones and screen readers. Do the staging run before `LIBRARY_ENABLED` is switched on.
