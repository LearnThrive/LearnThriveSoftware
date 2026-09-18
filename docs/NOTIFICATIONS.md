# Notifications and dashboards

Covers Phase H: in-app notifications, the Admin activity feed, and real per-role dashboard
content. See `docs/ATTENDANCE.md` for the per-lesson activity timeline this feed draws from, and
`docs/LESSON_REPORTS.md` for the report events that raise notifications.

## Notifications (plan section 54-55)

`Notification` (`packages/data/src/domain.ts`) — addressed to an `AuthenticatedUser.id`. Type
names deliberately match plan section 55's own "future providers can consume" event list
(`LESSON_REMINDER`, `LESSON_RESCHEDULED`, `REPORT_AVAILABLE`) plus the Admin/Tutor-facing ones
named in section 54's examples (`REPORT_REQUIRED`, `REPORT_AWAITING_APPROVAL`,
`SCHEDULING_CONFLICT`) — kept as domain events from day one, per section 55's "architect for
later email... do not send real email/SMS unless infrastructure already exists."

**The profileId → AuthenticatedUser.id resolution problem**: every service that raises a
notification (scheduling, reports) only knows a domain `profileId` (a Tutor/Client/Student
record's own id) — never an `AuthenticatedUser.id` directly. `apps/web/src/lib/auth/devProvider.ts`
exports `findUserIdByProfileId()` and `findUserIdsByRole()`, the reverse of the
`AuthenticatedUser.profileId` lookup used everywhere else. Most Admin-created Tutor/Client/Student
records have **no** login account at all — only the four seed accounts do — so this legitimately
returns nothing for most of them, and `notifyProfile()`/`notifyProfiles()`
(`apps/web/src/lib/notifications/notificationService.ts`) silently skip creating a notification
in that case rather than erroring. This is a real, load-bearing limitation of the dev-only auth
layer, not a bug: a notification with no resolvable recipient has nowhere to go.

### What actually triggers a notification today

| Trigger | Recipient | Type |
| --- | --- | --- |
| `rescheduleLesson()` | the Lesson's Client(s) | `LESSON_RESCHEDULED` |
| Admin overrides a scheduling conflict (`createLessonAction`) | all Admins | `SCHEDULING_CONFLICT` |
| `submitReport()`, approval required | all Admins | `REPORT_AWAITING_APPROVAL` |
| `submitReport()`, approval not required (auto-approved) | the Lesson's Client(s) | `REPORT_AVAILABLE` |
| `approveReport()` | the Lesson's Client(s) | `REPORT_AVAILABLE` |

Proven end-to-end (not just unit-tested in isolation) by
`apps/web/tests-e2e/lessons.spec.ts`'s report-lifecycle test: after a Tutor submits a report
needing approval, the test logs in as Admin and checks `/dashboard/notifications` for the
"awaiting approval" message; after Admin approves, it logs in as the Client and checks for the
"new report is available" message, including the unread-count badge in the header
(`DashboardShell`) and marking it read.

### Not built: time-based notifications

`LESSON_REMINDER` (Tutor: "lesson approaching" / Student: "lesson upcoming") and `REPORT_REQUIRED`
(Tutor, by a deadline) are **not implemented** — every trigger above fires from a real user
action (someone rescheduled, submitted, approved something), whereas these need something to
notice the *passage of time* on its own (a lesson getting close, a deadline passing). There is no
scheduler/cron/background job anywhere in this prototype, and building one is real infrastructure
in its own right — not a small addition to this phase. The `LESSON_REMINDER` type exists in the
domain model so a future scheduled job has a real type to write into, per section 55's own
"architect for later" framing, but nothing calls `data.notifications.create()` with it today.

## Admin activity feed (plan section 53)

`ActivityRepository.recent(limit)` (extending the per-lesson `LessonActivityEvent` log from
Phase F/G to a platform-wide, newest-first view) backs a "Recent activity" list on
`/dashboard/admin` — lesson creation, rescheduling, cancellation, attendance marked, completion,
and report submission/approval. This is the same real event stream Phase F/G already built,
not a separate debug log — per section 53's explicit "this is business activity, not debug
logging," nothing from `apps/realtime`'s websocket traffic ever reaches it.

Not built: "Student added" isn't logged as an activity event (Phase C's people-management
actions predate the activity log and weren't retrofitted this phase), and global/admin search
across Students/Clients/Tutors/Lessons (plan section 52) is a separate, larger feature not
attempted here.

## Role dashboards (plan sections 69-73)

`/dashboard` (`apps/web/src/app/dashboard/page.tsx`) now shows real data instead of a
per-role placeholder paragraph: the viewer's next upcoming lesson (via `visibleLessonsFor()`,
Phase D's centralised role-visibility function — nothing new to get wrong here), and for a Tutor,
a "Needs attention" list of past lessons still `PLANNED`/`IN_PROGRESS` (attendance or a report
likely still outstanding). This directly matches the mobile priority lists in plan sections 71-73
(Tutor: next lesson, join, mark attendance, write report, calendar; Client: next lesson, reports,
notifications; Student: join, next lesson, calendar) — the existing CSS (`dashboard-summary-cards`,
`people-list`, `dashboard-quick-actions`) already responds down to phone width from earlier
phases, so no new responsive work was needed for section 70's "remain usable on mobile."

`/dashboard/admin` (Phase C) gains the activity feed above, on top of its existing real summary
cards.

## What's not built yet

- Time-based notifications (`LESSON_REMINDER`, deadline-based `REPORT_REQUIRED`) — see above.
- Global/admin search (plan section 52).
- "Student added" and other people-management events on the activity feed.
- A notification-preferences page (which types a user wants, email digest, etc.) — everything
  today is in-app only, always on, per section 54's own "in-app notifications" scope.
