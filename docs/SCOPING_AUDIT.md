# Per-role scoping on the SQL provider: the audit, page by page

Written 4 November 2026 (launch checklist 2.5). Until this, the staff dashboards' per-role scoping had been checked by the repository
contracts and by the in-memory end-to-end suite only; the ledger listed "the staff dashboards' per-role scoping on the SQL provider was
not re-audited page by page". This page records that audit: what was run, what it proved, and what it did not.

**Where it lives.** `apps/web/tests-e2e-realstack/scoping.spec.ts`, run by
`npm run test:e2e:realstack --workspace=apps/web` against a dev server started on the **real local Supabase stack**
(`LEARNTHRIVE_SUPABASE_USE=1`): real GoTrue, real Postgres 17 through the production connection code (`apps/web/src/lib/db.ts`), the real
SQL data provider (`packages/data/src/sqlProvider.ts`). Not part of `npm run test:e2e`, which must pass with no Docker.

## What it runs against

`apps/web/tests-e2e-realstack/global-setup.ts` builds, on the local stack only, through the real Auth Admin API and the real
`provision_account` transaction (migration 0017):

| | Ashford | Brenner |
| --- | --- | --- |
| Parent (CLIENT) | `rs-ashford-<run>` | `rs-brenner-<run>` |
| Enrolled child, with their own login (STUDENT) | Amara | Bea |
| Sibling, in the family, no lessons, no login | Arun | Bo |
| Tutor (TUTOR) | Ashford Tutor | Brenner Tutor |
| Assignment, ACTIVE | Maths | English |
| Lessons | one past (COMPLETED, attendance marked, APPROVED report), one upcoming | the same |
| Notifications | one to the parent, one to the tutor | the same |
| Availability | one block | one block |

Plus an **administrator who does not teach** (`rs-admin-<run>`) and an **administrator who does** (`rs-teachadmin-<run>`, with a tutor
record of its own: task 3.11). Every record carries its family's surname, so a leak shows up as that word on a page it has no business
being on. A tutor's private notes are seeded as `PRIVATE NOTE Ashford` / `PRIVATE NOTE Brenner`.

## The pages, and what each role may see

Every row was opened as every role listed. "Own" means the page showed that person's own records (asserted by name, so "nothing of the
other family" cannot pass on an empty page); "none" means the page was opened and the other family's child, sibling, lesson titles,
report text and private notes were all absent from it.

| Page | Guard | Admin | Tutor | Parent | Learner |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | `requireSession` | everything | own | own | own |
| `/dashboard/calendar` | `requireSession` | everything | own | own | own |
| `/dashboard/lessons` | `requireSession` | everything | own | own | own |
| `/dashboard/lessons/[id]` | `requireSession` + `canView` | either family | own; other → **/403** | own; other → **/403** | own; other → **/403** |
| `/dashboard/reports` | `requireSession` | everything | own | own | own |
| `/dashboard/notifications` | `requireSession` | everything | own | own | own |
| `/dashboard/settings` | `requireSession` | "Report approval" shown | **not shown** | **not shown** | n/a |
| `/dashboard/children` | `requireRole(["CLIENT"])` | **/403** | **/403** | both own children | **/403** |
| `/dashboard/progress/[studentId]` | `requireSession` + `studentProgressFor` | either | own; other → **not found** | own; other family and the other family's sibling → **not found** | own; **their own sibling** and the other family → **not found** |
| `/dashboard/students` (my students) | `requireTutor` | **/403** (does not teach) | own only | **/403** | **/403** |
| `/dashboard/tutor/availability` | `requireTutor` | **/403** (does not teach) | own | **/403** | **/403** |
| `/dashboard/activity` | `requireRole(["ADMIN"])` | everything | **/403** | **/403** | **/403** |
| `/dashboard/admin/people/{students,clients,tutors}` | `requireRole(["ADMIN"])` | everything | **/403** | **/403** | **/403** |
| `/dashboard/admin/assignments`, `/dashboard/admin/assignments/[id]` | `requireRole(["ADMIN"])` | everything | **/403** | **/403** | — |
| `/dashboard/admin/clients/[id]`, `students/[id]`, `tutors/[id]` | `requireRole(["ADMIN"])` | everything | **/403** | **/403** (their own client page too) | — |
| `/dashboard/admin/lessons/new` | `requireRole(["ADMIN"])` | yes | **/403** | **/403** | — |

`/dashboard/admin` and `/dashboard/admin/people` hold no data: both redirect.

Signed out, every one of `/dashboard`, `/dashboard/lessons`, a lesson, `/dashboard/children`,
`/dashboard/admin/people/students` and a progress page sends the visitor to `/login`.

## Guessing an id in the URL

Every id below is a real id belonging to the **other** family or the **other** tutor, taken from the fixtures, so these are not
"does a made-up id 404" checks: they are "does a real record someone else owns open".

| Asked for | Answer |
| --- | --- |
| The other family's past and upcoming lesson, as a parent, a tutor or a learner | `/403` |
| The other family's child, and their sibling, on the progress page | the same "not found" page as an id that does not exist |
| A learner asking for **their own sibling's** progress | "not found" |
| The other family's client, student, tutor and assignment admin pages | `/403` |
| A parent asking for **their own** client admin page | `/403` (the admin screens are not a family's) |
| `GET /api/reports/pdf?report=<the other family's report>` | 404 |
| `GET /api/reports/pdf?student=<the other family's child>` | 404 |
| `GET /api/lessons/<the other family's lesson>/ics` | 404 |
| The same two for **own** records, as a control | 200 |
| `POST /api/learners/<the other family's child>/{status,access,invite}` | refused (4xx) |
| Either download while signed out | 401 |

## The two rules that are not about ownership

- **A tutor's private notes** (`lesson_reports.internal_tutor_notes`) never reached a family or a learner: not on the lesson page, the
  reports list, the progress page, the dashboard, the calendar or the notifications page, and not even about their own child. The
  tutor who wrote them does read them on their own lesson page, which is the point of the field.
- **An administrator who teaches** (3.11) has the tutor tools *and* the admin screens, scoped to their own teaching: `/dashboard/students`
  showed neither family's child, because they teach neither. They may open another tutor's lesson as an administrator, and the page
  offers them **no way to join it** as its tutor. An administrator who does **not** teach has no "Your teaching" section and both tutor
  pages are shut as well as hidden.

## What this audit found

1. **No cross-family or cross-tutor leak.** Every page and every route handler above answered correctly on the SQL provider, first
   time. No test had to be added for a gap in scoping, because none was found.
2. **A real defect, elsewhere, now fixed.** On the student and tutor profile pages, "Create login" generated the temporary password and
   then threw it away: the action called `revalidatePath`, which in Next 16 "re-renders the current route server-side and includes a
   newly rendered RSC Payload in the action's response", and the form that shows the password is rendered only while the person has no
   login — so the re-render replaced it with the login card before the administrator could read a password that is stored nowhere.
   It did not show up on the development backend, whose student and tutor records keep no login reference, so the form happened to
   survive. Fixed in `apps/web/src/lib/actions/accounts.ts` (no `revalidatePath` in those two actions) and covered by
   `tests-e2e-realstack/admin-created-flow.spec.ts`.

## Two things to know when reading the tests

- **A refusal's status code.** The dashboard streams its loading shell (`app/(app)/dashboard/loading.tsx`), so the `200` is already on
  the wire by the time a page calls `notFound()`: the body carries the not-found page but the status is 200. The audit therefore checks
  what the page *says*, which is what decides whether a guessed id is distinguishable from one that does not exist. `/403` is a
  redirect and is checked by the URL.
- **Rate limits are real.** The site's own limits are per visitor address and held in memory (10 password changes in 15 minutes, 6
  emailed links an hour), and this dev server outlives a single run, so each test takes its own address
  (`tests-e2e-realstack/_browser.ts`). A run that shares one address is refused with "Too many requests from this connection" — the
  limit working, not a bug.

## What this audit does **not** cover

- **Direct Server Action POSTs.** Each action re-checks the role in its own code (`docs/ROLE_PERMISSIONS.md`, and
  `setReportApprovalAction` is the worked example), and the unit suites cover that; a browser test cannot post one without the action id
  from the page's bundle. What is proved here is that no page *offers* a control to a role that may not use it.
- **The classroom routes and the Library and LearnThrive AI routes.** Out of launch scope (both switches stay off), and the Library's
  own cross-family rules are proved by the row-level-security suite and the Library contract on the real stack.
- **The hosted project.** Nothing here ran against `learnthrive-prod`. Phase 4 repeats what matters there.
- **Row-level security as the second wall.** The site connects as a role that bypasses it by design, so this audit is about the
  repositories' own scoping. The policies are proved separately through the real Data API in `packages/data/src/realstack.test.ts`.
