# Role Permissions

## Roles

```ts
type Role = "ADMIN" | "TUTOR" | "CLIENT" | "STUDENT";
```

`CLIENT` is the parent/guardian/fee-payer role — see plan section 14: a Client is not assumed to
equal a Student (a Client can have multiple Students, and vice versa — see
`docs/DOMAIN_MODEL.md`'s `ClientStudentLink`). `STAFF` is named as a future possibility in the
plan behind this migration and is deliberately not built — see `docs/PRODUCTION_GAPS.md`.

## A tutor who is also an administrator

A person has **one role**. "Teaches" is not a second role: it is a **capability**, derived from a
linked tutor record (`tutors.profile_id` is this person, and the record is active). This is the
model chosen for launch checklist task 3.11; the alternative, a set of roles per profile, would
have meant changing every guard, the database and the audit trail for no gain.

| Account | Role | Tutor record | Admin screens | Tutor tools |
| --- | --- | --- | --- | --- |
| Administrator who teaches | `ADMIN` | yes | yes | yes |
| Administrator only | `ADMIN` | no | yes | no |
| Tutor | `TUTOR` | yes | no | yes |

The rules, all in `apps/web/src/lib/auth/teaching.ts` so they are decided once:

- **Whose lesson is it?** `teachesLesson(user, lesson)` compares the lesson's tutor with the
  person's tutor record, never the role. An administrator teaching a lesson joins, marks and
  reports on it as its tutor. An administrator **not** teaching it acts as an administrator: they
  can manage it but cannot join its classroom as its tutor.
- **Tutor tools** (availability, My students) use `requireTutor()`, not `requireRole(["TUTOR"])`.
- **`asTutor(user)`** gives a tutor-scoped copy of the user for the tutor pages' queries, so those
  pages run unchanged and see only that person's own lessons and students. It only ever narrows
  what is shown: nothing grants access on the strength of it.
- **Linking a login to a tutor record** never demotes anyone: a `CLIENT` becomes `TUTOR`, an
  `ADMIN` stays `ADMIN`. An account that owns a family, is a learner, is already a tutor, or a
  tutor record that already has a login, is refused (`linkLogin`).
- Promotion to `ADMIN` is still a controlled script, never a screen (`docs/AUTHENTICATION.md`).

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
| `/login` | Anyone unauthenticated (already-authenticated visitors are sent on: staff and enrolled families to `/dashboard`, a Library subscriber to LearnThrive AI, anyone else to `/account`) |
| `/dashboard`, `/dashboard/calendar`, `/dashboard/notifications`, `/dashboard/lessons/[id]` | Any authenticated user *whose access includes the dashboard* (staff and enrolled families; a Library subscriber is sent to LearnThrive AI, see `docs/AUTHENTICATION.md` "One sign-in") — content and IDOR-filtered per role within the page |
| `/dashboard/admin/**` (people, assignments, lesson creation, per-person profiles) | `ADMIN` only |
| `/dashboard/tutor/availability`, `/dashboard/students` | Anyone who teaches: a `TUTOR`, or an `ADMIN` with a linked tutor record |
| `/api/auth/login`, `/api/auth/logout` | Anyone (these routes *are* the authentication mechanism) |

## What's enforced today, by action

| Server Action | Who | Object-level check |
| --- | --- | --- |
| `createTutorAction`/`createClientAction`/`createStudentAction`/`createAssignmentAction` | `ADMIN` | n/a — Admin manages everyone |
| `createLessonAction`/`rescheduleLessonAction`/`cancelLessonAction` | `ADMIN` | n/a |
| `addAvailabilityAction`/`removeAvailabilityAction` | Anyone who teaches | operates only on the caller's own tutor record — never a `tutorId` from form input |
| `joinClassroomAction` | The lesson's tutor (a `TUTOR`, or an `ADMIN` who teaches it) or one of its `STUDENT`s | assigned to the specific Lesson, online, not cancelled, within the join window (`docs/CLASSROOM_INTEGRATION.md`) |
| `markAttendanceAction`/`completeLessonAction` | `TUTOR`/`ADMIN` | Tutor must be the Lesson's own Tutor |
| `saveReportDraftAction`/`submitReportAction` | `TUTOR`/`ADMIN` | same |
| `approveReportAction` | `ADMIN` only | — |
| `markNotificationReadAction` | any authenticated user | only their own notifications |
| `createFamilyAccountAction`/`createTutorLoginAction`/`createLearnerLoginAction`/`issueTemporaryPasswordAction`/`setLoginDisabledAction`/`changeLinkedEmailAction` | `ADMIN` only | the role comes from the code, never the form, so no posted value can make an administrator (`docs/AUTHENTICATION.md`) |
| `setLearnerLoginAction` | `ADMIN` only | suspend, restore or remove a child's login (launch checklist 3.5). A removed login is never changed again, and removing needs the confirmation box |
| `markLeftAction`/`cancelLeftAction`/`bringForwardAction` | `ADMIN` only | the pause before a purge (launch checklist 3.7.3). The date can only be brought forward, never pushed back |
| `purgeStudentAction`/`purgeTutorAction`/`purgeFamilyAction` | `ADMIN` only | the record must already be marked as left and out of its pause — enforced in the database too (migration 0019), so no caller can skip it — and the administrator must type the confirmation phrase |

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
