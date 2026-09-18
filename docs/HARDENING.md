# Hardening

Covers Phase I: the plan section 85 IDOR/access-control checklist, and an honest status of
validation, timezone/DST, responsive, and accessibility coverage across the whole platform built
in Phases A-H. This is a consolidation and gap-filling pass, not a rewrite — most of what's below
was already built and tested phase-by-phase; this documents what's actually proven versus
assumed.

## IDOR / access-control (plan section 85)

| Attack | Status |
| --- | --- |
| Parent accesses unrelated Student URL | **Structurally impossible** — there is no Student-profile route reachable by a Client at all; `/dashboard/admin/students/[id]` is `requireRole(["ADMIN"])`-only. |
| Tutor accesses unassigned Student | **Structurally impossible** — same reason; no Tutor-facing Student-profile route exists. |
| Student accesses another Student | **Structurally impossible** — no Student-facing profile route of any kind exists. |
| Tutor edits someone else's Lesson | **Structurally impossible** — `rescheduleLessonAction`/`cancelLessonAction` are `requireRole(["ADMIN"])`-only; proven in `hardening.spec.ts` that the Cancel control is genuinely absent for a Tutor, not just non-functional. |
| Student joins unrelated classroom | **Proven** — `lessons.spec.ts`'s original Phase D IDOR test (Student), extended in Phase I's `hardening.spec.ts` for the Tutor role too; `joinClassroomAction` (Phase E) independently re-checks assignment on every call regardless. |
| Parent views internal Tutor notes | **Proven** — `lessons.spec.ts`'s report-lifecycle test asserts a literal `"CONFIDENTIAL: ..."` string never reaches the page for a Client, even after approval; `visibleReportFor()` is the single enforcement point (see `docs/LESSON_REPORTS.md`). |
| Tutor approves own report if only Admin may approve | **Proven** — `hardening.spec.ts` confirms the Approve control is absent for a Tutor viewing their own just-submitted report; `approveReportAction` is `requireRole(["ADMIN"])`-only. |

The three "structurally impossible" rows are not weaker than "proven" — plan section 85 itself
says *"do not rely on obscurity of IDs,"* and a route that doesn't exist at all is a stronger
guarantee than a route that exists and happens to reject the request. `auth.spec.ts`'s existing
"a Tutor cannot reach /dashboard/admin/people" / "the Admin-only route" tests already prove the
general `requireRole(["ADMIN"])` mechanism these routes rely on works.

## Validation (plan section 61)

No shared schema library (e.g. Zod) was introduced this phase — every Server Action validates
its own `FormData` inline (trimming strings, checking enum membership against a `const` array
like `VALID_STATUSES`/`ATTENDANCE_STATUSES`, rejecting empty required fields) at the point it's
used, consistently across `people.ts`, `lessons.ts`, `attendance.ts`, `reports.ts`, and
`classroom.ts`. This satisfies plan section 61's individual field-level asks (email, names,
dates, duration, lesson status, report content, assignment membership are all checked somewhere
in that chain) but not its "use shared schemas for incoming data" instruction literally — adopting
Zod (or similar) across every existing action would be a real refactor of already-tested code, not
a hardening-pass addition, and risked destabilizing the ~110 tests this session built without a
concrete bug it would have caught. Left as a named gap rather than attempted partially.

Role permission checks are consistent: every mutating Server Action calls `requireRole(...)` or
`requireSession()` as its first line, re-checked independently of whatever the calling page
already decided — this pattern has held across every phase since Phase B and is what the IDOR
table above relies on.

## Timezone / DST (plan section 62)

Already proven in Phase D: `apps/web/tests/recurrence.test.mjs`'s DST-boundary test starts a
weekly series across the actual 2025 British clock change and asserts the local time stays fixed
while the UTC instant shifts. Not newly re-tested this phase — no timezone-handling code changed
since Phase D.

## Calendar views (plan section 86)

Month/Week/Day/List views are FullCalendar's own built-in view switcher (Phase D) — not
independently Playwright-tested per view, since they all render from the same
`visibleLessonsFor()` data and FullCalendar's view-switching itself isn't this codebase's logic
to verify. Reschedule, cancellation, Tutor conflict, and Student conflict all have real test
coverage from Phases D/F. Drag-and-drop reschedule remains code-reviewed but not raw-mouse-drag
Playwright-tested (see `docs/SCHEDULING.md` — unchanged this phase).

## Accessibility

Every interactive form control added across Phases E-I has a real `<label htmlFor>` or
`aria-label` (verified by the tests themselves, which locate controls via `getByLabel`/
`aria-label` rather than CSS selectors wherever practical — `apps/web/tests-e2e/*.spec.ts`'s own
use of `getByRole`/`getByLabel` throughout is itself a running accessibility check, since an
unlabelled control fails those queries). **No automated accessibility audit tool (e.g. axe-core)
was run this phase**, and no manual screen-reader pass was performed — this is a real gap, not
claimed as done. See `docs/PRODUCTION_GAPS.md`.

## Responsive / mobile

No new CSS was needed this phase — the `dashboard-summary-cards`/`people-list`/
`dashboard-quick-actions` classes reused throughout Phases F-H already respond down to phone
width from earlier phases. Not independently re-verified against a real or emulated phone
viewport this pass.
