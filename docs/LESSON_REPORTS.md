# Lesson reports

Covers Phase G: draft/submit/approve, the Parent/Student visibility boundary, and how completion
now gates on a required report. See `docs/SCHEDULING.md` for `Lesson` and `docs/ATTENDANCE.md`
for the activity timeline this hooks into.

## The report (plan sections 41-43)

One `LessonReport` per `Lesson` (`packages/data/src/domain.ts`). Fields split cleanly into two
groups:

- **Parent/Student-visible** (once the report is visible at all — see below): `publicSummary`
  (what was covered), `progress`, `areasForImprovement`, `nextSteps` (homework, optional),
  `engagement` (a simple `LOW`/`MEDIUM`/`HIGH` assessment).
- **Tutor-only, never sent to Client/Student**: `confidence` (the Tutor's own optional
  assessment) and `internalTutorNotes`.

**The single place this boundary is enforced** is `apps/web/src/lib/reports/reportService.ts`'s
`visibleReportFor(viewer, report)` — every page and action that shows a report to someone calls
this rather than reading `LessonReport` fields directly, so `internalTutorNotes`/`confidence` can
never leak by a caller simply forgetting to strip them (plan section 43: *"Never accidentally
send internal notes to Parent/Student"*). Proven with a real end-to-end test
(`apps/web/tests-e2e/lessons.spec.ts`'s report-lifecycle test): a Tutor writes a report containing
the literal string `"CONFIDENTIAL: ..."` in `internalTutorNotes`, submits it, an Admin approves
it, and the test asserts that string is absent from the page when a Client (the Student's parent)
views the same lesson.

## Status and approval (plan sections 44-45)

`DRAFT → SUBMITTED → APPROVED`. A Client/Student never sees a `DRAFT` or `SUBMITTED` report —
only `APPROVED` (`visibleReportFor` returns `null` otherwise). Whether `SUBMITTED` requires a
separate Admin approval step is `PlatformSettings.requireReportApproval` (default `true`,
in-memory, a single well-known record rather than a settings table for the one setting that
exists so far), overridable per `TuitionAssignment.requireReportApproval`.
`reportService.ts`'s `effectiveRequireApproval()` resolves Assignment override, then platform
default. When the effective setting is `false`, `submitReport()` sets the report straight to
`APPROVED` — plan section 44's *"If approval disabled: Submitted may become directly visible."*

A `DRAFT` is freely editable (`saveDraft()` — plan section 68's autosave-while-server-runs
intent, the simplest honest version of it for an in-memory store: no separate autosave timer,
just a plain save action the Tutor triggers). Once `SUBMITTED` or `APPROVED`, `saveDraft()`
refuses further edits — there's no revision workflow yet (see "What's not built" below).

## Completion gating (plan section 45, extending Phase F)

`Lesson.reportRequired` (from Phase D) now actually does something:
`attendanceService.ts`'s `completeLesson()` refuses to mark a lesson `COMPLETED` if
`reportRequired` is set and no report exists, or the only report is still a `DRAFT`.
A `SUBMITTED` report is sufficient to complete the lesson — the plan's wording is *"until
required report exists,"* not *"until approved"*, and requiring full Admin sign-off before a
Tutor can even close out the lesson would block on someone else's timing for no stated reason.

## Progress and demo data

Plan section 46 ("Student progress timeline" — chronological approved reports on a Student's
profile, filterable by subject/Tutor/date) is **not built this phase** — `ReportRepository`
already exposes `forStudent()` to support it directly when it's built, but the profile-page UI
itself wasn't in this phase's own bullet list (draft/submit/approve, visibility, completion).

The seed demo data (plan section 89: "one approved report, one draft report") seeds one
`APPROVED` report on the one completed seed lesson (`SEED_IDS.reportApproved`) — a draft on the
still-upcoming seed lesson would be backwards (nobody writes a lesson report before the lesson
happens), so that half of the demo scenario is left for whoever tries the Tutor flow manually.

## What's not built yet

- The Student progress timeline page itself (plan section 46).
- Report PDF export (plan section 47 explicitly defers this: "do not make PDF generation a
  blocker").
- A revision workflow for a `SUBMITTED`/`APPROVED` report (e.g. Admin sends it back to `DRAFT`
  for corrections) — today a mistake in a submitted report has no in-app fix.
- Per-Assignment approval override has no UI yet — `TuitionAssignment.requireReportApproval` is
  set-able in the data layer and fully respected by `reportService.ts`, but no Admin page exposes
  editing it (only the platform-wide default is meaningfully reachable today, and even that has
  no settings page — see `docs/PRODUCTION_GAPS.md`).
