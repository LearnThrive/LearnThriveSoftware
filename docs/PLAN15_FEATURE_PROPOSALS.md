# Plan 15 — feature proposals for the authenticated app

Plan15 section 15.3. A vetted shortlist of what to add to the product, sorted by whether it needs
anything beyond what exists. Written after reading the four dashboards, `appNavigation.ts`,
`docs/PRODUCTION_GAPS.md`, `docs/ROLE_PERMISSIONS.md` and the repository interfaces in
`packages/data/src/repositories.ts`.

**Dependency column**
- *none* — a UI/service change over repository methods that already exist. It ports to Supabase for
  free, because it talks to the repository/service interfaces, never to storage.
- *repo method* — needs one small addition to a repository interface (and its in-memory
  implementation), no schema change.
- *backend* — needs infrastructure or a product decision that does not exist yet (a scheduler, an
  email provider, payments, a messaging model).

**Constraint on every Tier A item (plan15 ground rules 7 and 9):** the three-layer authorization
(page, object/IDOR, action — `docs/ROLE_PERMISSIONS.md`) applies unchanged; no dataset is ever shipped
to the client; the Parent/Student report-visibility boundary (`visibleReportFor`) is the only way a
report reaches a Parent or Student; no schema change; no new dependency; every state designed
(empty, loading, error, both themes).

## Tier A — build now

| # | Feature | Value | Effort | Roles | Dependency | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | **Command palette and search** (Ctrl/Cmd+K): go to a page, quick-create, switch theme, sign out, open notifications, find people, lessons and reports the current role may see. | The biggest speed-up for an Admin or Tutor who lives in the app; closes the "no global search" gap (`PRODUCTION_GAPS.md`, plan section 52). | M | all (results differ by role) | none (search is a server action over existing repositories) | A search endpoint is the easiest place to leak: it must apply exactly the page-level visibility rules per role, return capped result counts, and never include `internalTutorNotes`. Mitigated by building results from the same `visibleLessonsFor`/`visibleReportFor`/people-visibility functions the pages use, and by adversarial tests in the `hardening.spec.ts` style. | **Build.** Excluded from the classroom route (whiteboard shortcuts). |
| A2 | **Student progress timeline** — a chronological page of a student's lessons and the reports for them, with topics covered, progress and next steps. A parent-friendly overview ("progress you can see" made visible). | It is the product's marketing promise ("Lesson report, every time", "Progress you can see") with no page that shows it over time. | M | Client (their children), Student (themselves), Tutor (their students), Admin (any) | none — `ReportRepository.forStudent()` already exists and was built for this | Visibility: only `APPROVED` reports, only Parent-visible fields for Client/Student (`visibleReportFor`). Tutors see their own students only; Admin sees all. | **Build.** |
| A3 | **Appearance and accessibility settings** in the account menu and Settings: theme (System/Light/Dark) and motion (System / Reduce). A "full motion" override of an OS reduced-motion preference only as an explicit, labelled choice. | Visitors on Windows with "animation effects" off (the owner's own case for months) have no way to opt in, and some need to opt out regardless of the OS. | S | all | none (localStorage, like the theme) | The override must never apply silently; *Reduce* always wins over any other signal. | **Build.** |
| A4 | **Add to calendar (.ics)** for one lesson and for a recurring series. | Parents and tutors keep lessons in a phone calendar; removes a "did I get the time right" support question. | S-M | Client, Student, Tutor, Admin (only lessons they can see) | none — uses the existing scheduling/timezone utilities | DST-safe: emit each occurrence with `DTSTART;TZID=...` rather than fixed UTC offsets; label times with the time zone in the UI. The download route must reuse the lesson visibility check (IDOR). | **Build.** |
| A5 | **Keyboard shortcuts overlay** (`?`) and a few go-to shortcuts (`g d`, `g l`, `g s`); **first-run checklist / tips** per role, dismissible, local state. | Discoverability for the palette; a calmer first session for a parent. | S | all | none | Shortcuts must not fire inside inputs and must not exist on the classroom route. None are destructive. | **Build.** |
| A6 | **"Lesson starting soon" reminders**, derived at read time (no scheduler) and shown in the notification menu and on `NextLessonCard`. | Closes the visible half of the "no time-based notifications" gap without a scheduler. | S | all with lessons | none (computed from lesson times when the page renders) | It is a derived view, not a stored notification: it cannot be marked read across sessions and does nothing when the app is closed. Say so in the UI copy; email/SMS stays Tier B. | **Build.** |
| A7 | **Admin setting for `requireReportApproval`** (and show its per-assignment override). | The setting is fully respected by `reportService.ts` and has no UI at all; an Admin cannot change a rule the platform already enforces. | S | Admin | none — `SettingsRepository.update` exists | Changing it changes what Parents see; confirm in a `Dialog`, log to the activity feed. | **Build.** |
| A8 | **"This week" summary** for a parent: lessons this week, new reports, anything awaiting them — one derived card on the Client dashboard. | Parents' recurring question is "what is happening this week"; the dashboard answers "next lesson" only. | S | Client | none | Same visibility rules as A2. | **Build** if time remains after A1-A7. |

## Tier B — propose only

| # | Feature | Why it needs more than the UI | Dependency | Recommendation |
| --- | --- | --- | --- | --- |
| B1 | **Report PDF export** | Needs a rendering approach (server-side PDF or print stylesheet), a decision on branding/legal footer, and the same visibility rules. A print stylesheet for the progress timeline (A2) delivers 80% of it for free. | backend (PDF) / none (print CSS) | Do the print stylesheet with A2; a real PDF later. |
| B2 | **Notification preferences with delivery channels** | There is no delivery channel but in-app. Preferences with nothing to switch are a form that lies. | backend | Defer until email exists. |
| B3 | **Report revision workflow** (send a submitted report back to draft with a reason) | A new report state and transitions in `reportService`, plus audit trail; a product decision on who may reopen. | repo method + product decision | Propose; owner decides. |
| B4 | **Time-based email/SMS notifications** | A scheduler and a provider (Resend is already used for the enquiry form, which makes email the cheap first channel). | backend | Decide with B2. |
| B5 | **Tutor availability self-service improvements** (recurring weekly patterns, exceptions) | Data model: recurrence for availability. The current add/remove model is per-slot. | repo method + model | Propose. |
| B6 | **Parent-side billing views** | There is no billing model anywhere in the product. | backend | Out of scope until a payments decision. |
| B7 | **In-app messaging** between parent and tutor | A messaging model, moderation and safeguarding implications (a policy decision first, see the safeguarding section of `PRODUCTION_GAPS.md`). | backend + policy | Do not build without a safeguarding decision. |
| B8 | **Attendance consistency indicator** on the progress timeline | Derivable from attendance records, but how to frame it to parents (a "streak" can read as pressure) is a product/tone decision. | none | Owner's call; low priority. |
| B9 | **Saved filters / bulk reschedule** for Admin | Useful at scale; at the current volume (tens of lessons) the benefit is unproven. | repo method | Wait for real data volumes. |

## Order of build (Wave 11)

A1 (palette + search) first, because it is also the shared component the public site reuses and the
riskiest for authorization; then A2, A7, A3, A4, A6, A5; A8 last. Each lands with tests in the style
of `tests-e2e/hardening.spec.ts` for anything that reveals data (A1, A2, A4, A8).
