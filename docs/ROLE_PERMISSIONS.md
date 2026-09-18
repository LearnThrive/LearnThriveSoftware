# Role Permissions

## Roles

```ts
type Role = "ADMIN" | "TUTOR" | "CLIENT" | "STUDENT";
```

`CLIENT` is the parent/guardian/fee-payer role — see plan section 14: a Client is not assumed to
equal a Student (a Client can have multiple Students, and vice versa — see
`docs/DOMAIN_MODEL.md`'s `ClientStudentLink`). `STAFF` is named as a future possibility in the
plan behind this migration and is deliberately not built — see `docs/PRODUCTION_GAPS.md`.

## Enforcement model

Authorization is enforced **server-side only, at every layer that can mutate or reveal data** —
never by a route simply being hidden from navigation. Three independent layers, each re-checked
regardless of what a higher layer already decided:

1. **Page-level**: a Server Component calls `requireSession()`/`requireRole([...])`
   (`apps/web/src/lib/auth/guard.ts`) before rendering anything, redirecting to `/login` or
   `/403`.
2. **Object-level (IDOR)**: a page that shows one specific record (a Lesson, a report) additionally
   checks the requester is actually connected to *that* record, not just authenticated with the
   right role — see the `canView()`/ownership checks throughout `apps/web/src/app/dashboard/**`
   and `docs/HARDENING.md`'s adversarial test table.
3. **Action-level**: every Server Action re-runs its own `requireRole`/`requireSession` and
   ownership check, independent of which page's form happened to call it — a Server Action is a
   real POST endpoint regardless of what UI points at it.

## What's enforced today, by route

| Route | Who can reach it |
| --- | --- |
| `/login` | Anyone unauthenticated (already-authenticated visitors redirect to `/dashboard`) |
| `/dashboard`, `/dashboard/calendar`, `/dashboard/notifications`, `/dashboard/lessons/[id]` | Any authenticated user — content and IDOR-filtered per role within the page |
| `/dashboard/admin/**` (people, assignments, lesson creation, per-person profiles) | `ADMIN` only |
| `/dashboard/tutor/availability` | `TUTOR` only |
| `/api/auth/login`, `/api/auth/logout` | Anyone (these routes *are* the authentication mechanism) |

## What's enforced today, by action

| Server Action | Who | Object-level check |
| --- | --- | --- |
| `createTutorAction`/`createClientAction`/`createStudentAction`/`createAssignmentAction` | `ADMIN` | n/a — Admin manages everyone |
| `createLessonAction`/`rescheduleLessonAction`/`cancelLessonAction` | `ADMIN` | n/a |
| `addAvailabilityAction`/`removeAvailabilityAction` | `TUTOR` | operates only on the calling Tutor's own `profileId` — never a `tutorId` from form input |
| `joinClassroomAction` | `TUTOR`/`STUDENT` | assigned to the specific Lesson, online, not cancelled, within the join window (`docs/CLASSROOM_INTEGRATION.md`) |
| `markAttendanceAction`/`completeLessonAction` | `TUTOR`/`ADMIN` | Tutor must be the Lesson's own Tutor |
| `saveReportDraftAction`/`submitReportAction` | `TUTOR`/`ADMIN` | same |
| `approveReportAction` | `ADMIN` only | — |
| `markNotificationReadAction` | any authenticated user | only their own notifications |

## What each role actually sees

- **Admin**: everything — all Lessons (`visibleLessonsFor()` returns the full list), all people,
  all reports at every status, the platform activity feed, report approval, scheduling-conflict
  override.
- **Tutor**: only Lessons where they're the assigned Tutor (`Lesson.tutorId`); their own
  availability; can mark attendance, write/submit reports, and complete Lessons they teach; never
  sees another Tutor's Lessons, students, or reports.
- **Client**: only Lessons connected to their own linked Students (`Lesson.clientIds`); only
  `APPROVED` reports, and only the Parent-visible fields (`visibleReportFor()` strips
  `internalTutorNotes`/`confidence` — see `docs/LESSON_REPORTS.md`); receives notifications for
  their Students' rescheduled lessons and newly available reports.
- **Student**: only Lessons they're on (`Lesson.studentIds`); the same restricted report
  visibility as Client; can join their own classroom within the join window — the narrowest view
  of any role.

Proven by the adversarial test suite in `apps/web/tests-e2e/hardening.spec.ts` and the IDOR/
visibility tests throughout `lessons.spec.ts` — see `docs/HARDENING.md` for the full checklist
against plan section 85.

## Future Supabase Row Level Security

Once a real database exists (see `docs/SUPABASE_MIGRATION.md`), the same rules above are expected
to be enforced twice: once in application services (as today) and once in the database itself via
Postgres Row Level Security, so a bug in application code can't become a full data leak. That RLS
policy design is out of scope until Supabase migration actually begins — see plan section 100.
