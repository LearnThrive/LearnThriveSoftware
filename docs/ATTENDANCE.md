# Attendance and lesson logs

Covers Phase F: per-Student attendance, the Lesson activity/audit timeline, and the completion
flow. See `docs/SCHEDULING.md` for the `Lesson` type this all operates on.

## Attendance (plan section 38)

`LessonAttendanceRecord` (`packages/data/src/domain.ts`) — one record per `(lessonId, studentId)`
pair, not one per lesson: a group lesson with three Students gets three independent records,
since one Student being absent doesn't mean they all were. Status is one of `ATTENDED`, `ABSENT`,
`LATE`, `EXCUSED`, with optional `arrivalTime`/`departureTime`/`notes`. Marking the same Student
again replaces their record (`InMemoryAttendanceRepository.upsert`, keyed by
`${lessonId}:${studentId}`) rather than appending a second one — only the current decision
matters, so there's nothing to disambiguate between two records for the same person.

`apps/web/src/lib/attendance/attendanceService.ts`'s `markAttendance()` records the change and
appends an `ATTENDANCE_MARKED` activity event in the same call. `markAttendanceAction`
(`apps/web/src/lib/actions/attendance.ts`) is the Server Action the lesson detail page's per-
Student form posts to — restricted to the assigned Tutor or an Admin, re-checked server-side
independently of what the page shows (the same IDOR discipline every other mutating action in
this app follows).

**Not built**: plan section 39's "auto session log" (classroom joined/left/reconnect events
prepopulating attendance evidence). `apps/classroom`/`apps/realtime` and `apps/web` have no event
channel between them beyond the one-way join-token handoff built in Phase E — there's no webhook,
shared database, or other mechanism for the classroom to tell the platform "this Student just
joined." Building that channel is a real piece of infrastructure in its own right, not a small
addition to this phase, so attendance today is entirely Tutor-entered. See
`docs/PRODUCTION_GAPS.md`.

## Lesson activity log (plan section 40)

`LessonActivityEvent` — a chronological, **append-only** audit timeline per Lesson, surfaced on
the lesson detail page to Admin and the assigned Tutor. Never edited or deleted once written, so
it stays a trustworthy record of what actually happened, not a mutable "current state" field.

Events are logged directly by the service function that causes them, not by a separate observer
watching for changes — this keeps each event's message accurate to what that specific call did,
rather than reverse-engineering a message from a before/after diff:

| Event | Logged by | Example message |
| --- | --- | --- |
| `CREATED` | `schedulingService.ts`'s `createLessonOrSeries` | "Lesson created for 3 Nov 2026, 15:00" |
| `RESCHEDULED` | `rescheduleLesson` | "Rescheduled from Tuesday 17:00 to Thursday 18:00" (plan section 65's exact format) |
| `CANCELLED` | `cancelLesson` | "Lesson cancelled — Testing cancellation" |
| `ATTENDANCE_MARKED` | `attendanceService.ts`'s `markAttendance` | "Attendance marked for Brian James Khalawon: ATTENDED" |
| `COMPLETED` | `completeLesson` | "Lesson marked complete" |
| `REPORT_SUBMITTED` | *(Phase G, not built yet)* | |

## Lesson completion (plan section 66)

A Tutor (or Admin) marks **Complete Lesson** from the lesson detail page. `completeLesson()`
refuses — throwing `LessonCompletionError`, surfaced to the user as a real error rather than
silently no-opping — unless:

- the lesson is not already `CANCELLED`, and
- every Student on the lesson has an attendance record (any status, including `ABSENT` — the
  point is a deliberate decision was recorded for each Student, not that they all attended).

This is section 66's explicit instruction: *"Do not prematurely set completed while mandatory
fields are absent."* The **Complete Lesson** button itself is disabled client-side whenever
attendance is incomplete, with its label saying so, but the check re-runs server-side in the
Server Action regardless — the disabled button is a UX nicety, not the actual gate.

**Report-required gating deferred to Phase G**: `Lesson.reportRequired` already exists (Phase D),
but `LessonReport` doesn't exist yet, so completion today only gates on attendance. Once Phase G
builds `LessonReport`, `completeLesson()` should also require a submitted report when
`reportRequired` is true — noted here rather than silently built partially.

## What's not built yet

- The auto session log (plan section 39) — see above.
- Report-required gating on completion (Phase G).
- A dedicated "Lesson finished" post-class screen when a Tutor ends an authenticated classroom
  session (plan section 67) — today a Tutor ending a class in `apps/classroom` and then marking
  attendance on the platform are two separate, manually-connected steps; classroom disconnection
  never automatically forces lesson completion, matching section 67's explicit instruction not to.
- Attendance/activity visibility for Client/Student roles (today Admin and the owning Tutor only —
  a Client seeing their own Student's attendance history is a reasonable future addition but
  wasn't in this phase's own bullet list).
