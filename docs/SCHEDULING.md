# Scheduling

Covers the calendar, lessons, recurrence, rescheduling, cancellation, availability, and conflict detection built in Phase D. See `docs/DOMAIN_MODEL.md` for the `Lesson`/`TutorAvailabilityBlock` types this all operates on.

## Time zones (plan section 62)

`Lesson.startAt` is **always** a real UTC instant (an ISO 8601 string ending in `Z`) — never a naïve local string. `apps/web/src/lib/scheduling/timezone.ts` is the one place that converts between that and wall-clock time in a specific IANA zone (`Europe/London` by default — `LEARNTHRIVE_DEFAULT_TIMEZONE`). No other file should hand-roll that conversion (e.g. by adding/subtracting a fixed number of hours), because that breaks across a DST boundary.

The conversion is built entirely on `Intl.DateTimeFormat` — no date-library dependency. `zonedTimeToUtc` takes a wall-clock `{year, month, day, hour, minute}` and the runtime's own tzdata resolves the correct offset *for that specific date*, so a 17:00 London lesson is 16:00 UTC in July (BST) and 17:00 UTC in January (GMT), correctly, automatically.

## Recurrence (plan section 28)

`apps/web/src/lib/scheduling/recurrence.ts`'s `generateRecurrenceOccurrences` reasons entirely in **wall-clock** terms and only converts to UTC once per occurrence, at the end. This is what keeps a weekly 17:00 Europe/London lesson at 17:00 local through a DST transition — the underlying UTC instant shifts by an hour when the clocks change, but the local time a student actually experiences doesn't. Proven directly: `apps/web/tests/recurrence.test.mjs`'s "WEEKLY keeps the same LOCAL time across a DST boundary" test starts a series two weeks before the real 2025 British clock change and asserts the UTC hour shifts from 16 to 17 partway through the series while the local hour stays 17 throughout.

Supported frequencies: `WEEKLY`, `BIWEEKLY`, `CUSTOM_WEEKDAYS` (an explicit set of weekdays, e.g. Tuesday and Thursday). End conditions: `endAfterOccurrences` or `endDate` (inclusive); a series with neither is still bounded to a sane default (52 occurrences) and a hard ceiling (104) — nothing about "repeat weekly forever" is a legitimate tutoring request, and an unbounded loop would be an accidental denial-of-service against the in-memory store.

**Every occurrence is a real, independent `Lesson` row from the moment it's created** — not a computed/virtual series. This is required by plan section 28's own edit model ("This lesson only / This and future lessons / Entire series"), which needs real rows to apply a change to a subset of. All occurrences sharing one series carry the same `recurrenceId`.

## Rescheduling (plan section 28, 29)

`apps/web/src/lib/scheduling/schedulingService.ts`'s `rescheduleLesson(data, lessonId, newStartAt, scope)`:

- `THIS_ONLY` (or any non-recurring lesson): moves just that row.
- `THIS_AND_FUTURE`: computes the time delta between the edited occurrence's old and new start, then applies that same delta to every occurrence in the series from this one onward (by `startAt`) — earlier occurrences are untouched.
- `ENTIRE_SERIES`: applies the same delta to every occurrence in the series, including ones earlier than the one edited.

Drag-and-drop rescheduling (`apps/web/src/components/CalendarView.tsx`, using FullCalendar's `interactionPlugin`) calls this same function — for a non-recurring lesson it applies immediately; for a recurring one, a confirmation panel asks which scope to apply, matching the plan's explicit three-way choice.

**A real bug found and fixed while testing the conflict-confirmation flow** (see the note in `apps/web/src/components/LessonForm.tsx` and `docs/ARCHITECTURE.md`'s Phase D section): `useActionState`'s re-render does not itself repopulate a `<form>`'s uncontrolled field values, so the "you have a conflict, confirm to proceed anyway" round trip silently wiped every required field. Fixed by having the server action echo back the submitted values in its returned state, and remounting the form (via a `key` bumped when that echoed state changes) so the echoed values become the fields' new defaults.

## Conflict detection (plan section 30)

`detectConflicts()` checks the Tutor and every Student on a prospective lesson independently against `LessonRepository.overlapping()` (half-open interval overlap: `[start, start+duration)`), returning which specific person is double-booked and with what. This **warns, it does not block** — the Admin-facing create-lesson form shows the warning and offers "Schedule anyway", matching the plan's explicit "allow Admin override" instruction. A `CANCELLED` lesson is never counted as a conflict.

## Cancellation (plan section 64)

Never deletes the row — `cancelLesson()` sets `status: "CANCELLED"`, `cancelledAt`, `cancelledBy`, and an optional `cancellationReason`. The lesson stays visible (with a distinct dashed/struck-through calendar treatment) rather than disappearing.

## Availability (plan section 31)

`TutorAvailabilityBlock` — a recurring weekly block (`weekday` + `startTime`/`endTime`), either `AVAILABLE` or `UNAVAILABLE` (an exception within an otherwise-available week, e.g. a lunch break). A Tutor manages only their own blocks (`/dashboard/tutor/availability`) — the Server Actions in `apps/web/src/lib/actions/availability.ts` operate exclusively on the calling Tutor's own `profileId`, never a `tutorId` taken from form input, which rules out one Tutor editing another's availability by construction rather than by a separate permission check. **Availability does not auto-schedule anything** — it's informational for Admin while scheduling (plan section 31's explicit "do not automatically schedule lessons without explicit confirmation"). Surfacing it *on* the scheduling form as a visual hint (rather than just existing as a separate page) is not yet built.

## Calendar UI (plan section 23, 24, 63)

`apps/web/src/components/CalendarView.tsx` wraps FullCalendar (`@fullcalendar/react` 6.1.19 — the plan's own suggestion to "use a robust calendar library rather than implementing calendar mathematics from scratch"), giving Month/Week/Day/List views for free via its built-in view switcher. Visible hours are bounded to 07:00–21:00 (plan section 63: configurable, not hiding legitimate out-of-hours lessons entirely, just not defaulting to showing a mostly-empty 24-hour grid).

**Role filtering is centralised in one place**: `apps/web/src/lib/scheduling/visibleLessons.ts`'s `visibleLessonsFor()`. Admin sees every lesson; every other role sees only lessons connected to their own domain profile (`AuthenticatedUser.profileId`) — Tutor via `tutorId`, Client via `clientIds`, Student via `studentIds`. A role without a linked profile yet sees nothing, not an error and not everything.

**IDOR protection on the lesson detail page** (`/dashboard/lessons/[id]`) is separate from the calendar's own filtering — the calendar not *showing* a lesson to the wrong role is a UX nicety, not a security boundary, since a determined user could still guess or be given a direct URL. `canView()` in that page explicitly checks the requesting user is actually connected to *that specific lesson* (matching plan section 85's adversarial test list: "Tutor accesses unassigned Student", "Student joins unrelated classroom") and redirects to `/403` otherwise. Proven with a real end-to-end test in `apps/web/tests-e2e/lessons.spec.ts` that creates an entirely separate Tutor/Student/Assignment/Lesson as Admin, then confirms the seeded (unrelated) Student is blocked from viewing it by direct URL.

## What's not built yet

- Drag-and-drop rescheduling is implemented and code-reviewed but not covered by a raw mouse-drag Playwright test — real browser drag simulation against FullCalendar's specific pixel geometry is fragile to automate reliably, and the underlying reschedule logic (all three scopes) already has thorough, deterministic unit test coverage in `apps/web/tests/schedulingService.test.mjs`. The drag gesture itself calls the exact same `rescheduleLessonAction` the confirmed-working create/cancel E2E tests already exercise end to end.
- Showing a Tutor's availability *on* the create-lesson form as Admin schedules (currently a separate page Admin would need to check manually).
- Admin/Tutor calendar filters beyond role-based visibility (Tutor/Student/Client/subject/status/online-in-person — plan section 25).
- "Permitted Tutors" dragging their own lessons (currently Admin-only; the plan names this as a future possibility, "permitted", without specifying the permission model yet).
- Recurring UNAVAILABLE-only series, editing an availability block (only add/remove today).
