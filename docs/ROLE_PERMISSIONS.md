# Role Permissions

## Roles

```ts
type Role = "ADMIN" | "TUTOR" | "JUNIOR_TUTOR" | "CLIENT" | "STUDENT";
```

`CLIENT` is the parent/guardian/fee-payer role (labelled **Parent** on screen) — see plan section 14: a
Client is not assumed to equal a Student (a Client can have multiple Students, and vice versa — see
`docs/DOMAIN_MODEL.md`'s `ClientStudentLink`). `STAFF` is named as a future possibility in the plan
behind this migration and is deliberately not built — see `docs/PRODUCTION_GAPS.md`.

The list, the permissions each role carries and the rules for changing them are in one pure file,
`packages/data/src/roles.ts`, so the application, the in-memory store and the tests share them.

## One person, several roles

A person holds a **set** of roles (the `profile_roles` table; `AuthenticatedUser.roles`). Two questions
are answered in two different ways, and the code keeps them apart on purpose:

- **Page and action permissions are the union.** `can(user, permission)`, `holds(user, role)` and
  `requireRole`/`requirePermission` (`apps/web/src/lib/auth/guard.ts`) allow a thing if **any** of the
  person's roles does. A person who is an administrator and a tutor can open the Roles screen and set
  their availability.
- **Object access is never widened by the union.** Whose lesson, whose child, whose family comes
  from the record each role stands on: a tutor role reaches the students on that tutor record's
  assignments, a student role reaches that one student, a parent role reaches that family, an
  administrator reaches everyone. `scopes(user)` (`lib/auth/scope.ts`) makes one copy of the person
  per role, each carrying **only** that role's record; the existing per-role queries run on each copy
  and their answers are merged (`unionOver`). The result is never more than the roles reach one at a
  time. A student who is also a junior tutor sees their own student data and the students they are
  assigned to, and never another student's lessons, students, reports or search results.

  | Person | Roles | Records | Sees |
  | --- | --- | --- | --- |
  | Administrator who teaches | `ADMIN`, `TUTOR` | a tutor record | everything (administrator), and their own teaching tools |
  | Student who is also a junior tutor (17) | `STUDENT`, `JUNIOR_TUTOR` | a student and a tutor record | their own lessons and reports as a student; the lessons and students they are assigned as a junior tutor |
  | Tutor who is also a parent | `TUTOR`, `CLIENT` | a tutor record and a family | their own taught lessons and their own family's |

- **Each role keeps its own view of a report.** Private tutor notes are shown only through a role
  that earns them (an administrator, or the tutor who wrote the report); the same person as a student
  or parent sees the family's view of an approved report.
- **What a person is, not what they hold.** A record without the matching role gives nothing: a tutor
  record on an account that does not hold `TUTOR` or `JUNIOR_TUTOR` means they do not teach.
  (Until migration 0025 "teaches" was a capability of an administrator with a tutor record; that
  capability is now the `TUTOR` role, backfilled for every such administrator.)

### Roles that cannot be held together

`TUTOR` and `JUNIOR_TUTOR` are mutually exclusive, so the union can never turn a junior into a full
tutor. `CLIENT` (parent) and `STUDENT` are exclusive too (a learner never owns a family account).
Both are refused in the application, in the Postgres function that changes roles, and by a trigger
on the table, so a direct write cannot get round them.

### Junior tutor

A junior tutor is a narrower tutor: the tutor permissions **minus** sending a report on
(`report.submit`) and setting availability (`tutor.availability`). They take attendance, complete
the lessons they are assigned, draft reports and raise concerns, on their own assigned lessons
only. They have no administrator screens. *This permission set is a proposal for the owner to
confirm* (for example: should a junior also be unable to complete a lesson?). Supervision rules (a
tutor reviewing a junior's report) are **not built yet**.

### Changing roles

Administrators only, on `/dashboard/admin/roles` and `POST /api/admin/roles`
(`{ profileId, roles }`; the whole set). One handler (`lib/roles/handlers.ts`) serves both and reads
exactly two fields: any other field is refused, so a request cannot set a role by adding one.

| Rule | Enforced |
| --- | --- |
| Only an administrator can change roles | handler (`roles.assign`), store, Postgres function |
| You cannot change your own roles | handler → store → Postgres function |
| The last administrator cannot lose the role | `planRoleChange`, store, Postgres function, trigger |
| `TUTOR` + `JUNIOR_TUTOR` and `CLIENT` + `STUDENT` refused; at least one role kept | all of the above |
| A tutor role needs a tutor record, a student role a learner record | store, Postgres function |
| Every change is written to the audit log: who, when, roles before and after | `role_changes` (append-only) |
| Nothing a user submits sets a role: sign-up, profile, learner and provisioning requests carry no role | `apps/web/tests/multiRole.test.mjs` |

Migration `supabase/migrations/0025_roles.sql` creates the tables and function. **It is written as
a file only and has not been applied to any project**; applying it is the owner's go-ahead, and
`apps/web/scripts/create-server-role.mjs` must be re-run afterwards so the server role may call
`set_profile_roles`. `profiles.role` stays as the derived *primary* role for older SQL functions
and policies; the application reads `profile_roles`.

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
| `/dashboard/students` | Anyone who teaches: `TUTOR` or `JUNIOR_TUTOR` (with a tutor record) |
| `/dashboard/tutor/availability` | `TUTOR` (a junior tutor does not set availability) |
| `/dashboard/admin/roles`, `/api/admin/roles` | `ADMIN` only (`roles.assign`) |
| `/api/auth/login`, `/api/auth/logout` | Anyone (these routes *are* the authentication mechanism) |

## What's enforced today, by action

| Server Action | Who | Object-level check |
| --- | --- | --- |
| `createTutorAction`/`createClientAction`/`createStudentAction`/`createAssignmentAction` | `ADMIN` | n/a — Admin manages everyone |
| `createLessonAction`/`rescheduleLessonAction`/`cancelLessonAction` | `ADMIN` | n/a |
| `addAvailabilityAction`/`removeAvailabilityAction` | `TUTOR` (permission `tutor.availability`) | operates only on the caller's own tutor record — never a `tutorId` from form input |
| `joinClassroomAction` | The lesson's tutor (`TUTOR` or `JUNIOR_TUTOR`, on their own tutor record) or one of its `STUDENT`s | assigned to the specific Lesson, online, not cancelled, within the join window (`docs/CLASSROOM_INTEGRATION.md`) |
| `markAttendanceAction`/`completeLessonAction` | permission `attendance.mark` / `lesson.complete` (`TUTOR`, `JUNIOR_TUTOR`, `ADMIN`) | must be the Lesson's own tutor, or an administrator (`mayActOnLesson`) |
| `saveReportDraftAction` | permission `report.draft` (`TUTOR`, `JUNIOR_TUTOR`, `ADMIN`) | same |
| `submitReportAction` | permission `report.submit` (`TUTOR`, `ADMIN`; **not** a junior tutor) | same |
| `changeRolesAction` | `ADMIN` only (`roles.assign`) | not yourself; not the last administrator; see "Changing roles" |
| `approveReportAction` | `ADMIN` only | — |
| `markNotificationReadAction` | any authenticated user | only their own notifications |
| `createFamilyAccountAction`/`createTutorLoginAction`/`createLearnerLoginAction`/`issueTemporaryPasswordAction`/`setLoginDisabledAction`/`changeLinkedEmailAction` | `ADMIN` only | the role comes from the code, never the form, so no posted value can make an administrator (`docs/AUTHENTICATION.md`) |
| `setLearnerLoginAction` | `ADMIN` only | suspend, restore or remove a child's login (launch checklist 3.5). A removed login is never changed again, and removing needs the confirmation box |
| `markLeftAction`/`cancelLeftAction`/`bringForwardAction` | `ADMIN` only | the pause before a purge (launch checklist 3.7.3). The date can only be brought forward, never pushed back |
| `purgeStudentAction`/`purgeTutorAction`/`purgeFamilyAction` | `ADMIN` only | the record must already be marked as left and out of its pause — enforced in the database too (migration 0019), so no caller can skip it — and the administrator must type the confirmation phrase |
| `recordVettingCheckAction`/`voidVettingCheckAction` | `ADMIN` only | a tutor never sees or changes their own checks. See `docs/SAFEGUARDING_RECORDS.md` |
| `raiseConcernAction` | permission `concern.raise` (`TUTOR`, `JUNIOR_TUTOR`, `ADMIN`) | refused (nothing stored) unless a safeguarding lead is named in `SAFEGUARDING_LEAD_EMAILS` |
| `updateConcernAction` | `ADMIN`, **and** a named safeguarding lead | the data layer refuses an administrator who is not a lead and records the attempt on the concern. Reading a concern has the same rule (`readConcern`, `listConcerns`) |
| Every action in `lib/actions/tuitionBilling.ts` (rates, sibling flag, charge decisions, issue statement, payments, refunds, billing rules) | `ADMIN` only | none. Tutors never see money (B17); `decideRefundAction` additionally needs the signer to be a named refund approver (`TUITION_REFUND_APPROVER_EMAILS`). See `docs/TUITION_BILLING.md` |

## What each role actually sees

A person with several roles gets, for each page, the union of the above, each part scoped to that
role's own record (see "One person, several roles").

- **Admin**: everything — all Lessons (`visibleLessonsFor()` returns the full list), all people,
  all reports at every status, the platform activity feed, report approval, scheduling-conflict
  override.
- **Junior tutor**: the same view as a tutor of their own assigned lessons and students; may take
  attendance and draft reports, but not send a report on or set availability.
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
