# Domain Model

## Scope of this document

This covers the domain surface introduced so far — Tutors, Clients, Students, and Tuition Assignments (Phase C). Lesson, LessonAttendance, LessonReport, TutorAvailability, Classroom, Notification, and ActivityEvent are named in the plan behind this migration as part of the eventual full domain model but are deliberately not defined yet — they arrive with the phases that actually use them (D, E, F, G, H). Defining empty types for them now, with nothing reading or writing them, would be scaffolding without substance.

Source: `packages/data/src/domain.ts`.

## Entities

### Tutor

```ts
interface Tutor {
  id: string;
  userId?: string;       // links to a platform AuthenticatedUser, if one exists
  name: string;
  email: string;
  subjects: string[];
  active: boolean;
  createdAt: string;     // ISO 8601
}
```

### Client

The parent/guardian/fee-payer role (plan section 14). A Client is explicitly **not** assumed to equal a Student.

```ts
interface Client {
  id: string;
  userId?: string;
  name: string;
  email: string;
  phone?: string;
  active: boolean;
  createdAt: string;
}
```

### Student

```ts
interface Student {
  id: string;
  userId?: string;       // optional — a young student may have no login of their own yet
  name: string;
  yearGroup?: string;
  active: boolean;
  createdAt: string;
}
```

### ClientStudentLink

A many-to-many join, not a foreign key on either side — a Client can have multiple Students, and a Student can have multiple Clients (shared custody, a second guardian, etc.). Modelled and tested explicitly: see `packages/data/src/inMemoryProvider.test.ts`'s "a Student can have more than one Client, and a Client more than one Student" test.

```ts
interface ClientStudentLink {
  clientId: string;
  studentId: string;
}
```

### TuitionAssignment

The LearnThrive-native term (plan section 15) for what TutorCruncher calls a "Job" — the ongoing relationship between a Tutor, one or more Students, and a subject.

```ts
interface TuitionAssignment {
  id: string;
  title: string;                                    // e.g. "GCSE Mathematics — Ayaan"
  subject: string;
  level?: string;
  tutorId: string;
  studentIds: string[];
  clientIds: string[];                               // derived from the students' own linked clients
  status: "ACTIVE" | "PAUSED" | "ENDED";
  defaultDurationMinutes?: number;
  defaultLocationType?: "ONLINE" | "IN_PERSON";
  defaultLessonNotes?: string;
  createdAt: string;
}
```

`clientIds` is not entered separately when creating an assignment — `createAssignmentAction` (`apps/web/src/lib/actions/people.ts`) derives it from whichever Clients are linked to the selected Students, since an assignment's paying clients are exactly whoever is responsible for the students on it.

## Repository layer

`packages/data/src/repositories.ts` defines one interface per entity (`TutorRepository`, `ClientRepository`, `StudentRepository`, `AssignmentRepository`), bundled as `DataProvider`. No application code — no dashboard, no route, no Server Action — talks to a concrete store directly; everything goes through these interfaces. `packages/data/src/inMemoryProvider.ts` is the only implementation today: a set of `Map`-backed classes, seeded once per server process and cached on `globalThis` (surviving Next's Fast Refresh, same pattern as the auth layer's stores — see `docs/AUTHENTICATION.md`).

A future `SupabaseTutorRepository`/`SupabaseClientRepository`/etc. implements the same interfaces without any dashboard or Server Action changing — see `docs/SUPABASE_MIGRATION.md`.

## Cross-referencing with the auth layer

The auth layer's `AuthenticatedUser.profileId` (see `docs/AUTHENTICATION.md`) and this domain model's entity ids are deliberately the same fixed values for the seeded demo accounts — `packages/data/src/inMemoryProvider.ts` exports `SEED_IDS`, which `apps/web/src/lib/auth/devProvider.ts` imports directly, rather than the two seed systems coincidentally agreeing. This means "find the Tutor record for the currently logged-in user" is `getDataProvider().tutors.get(session.profileId)`, not a lookup by email or name.

## Demo scenario (plan section 89)

Seeded automatically, every server start:

| Entity | Value |
| --- | --- |
| Tutor | Jamie Patel (`tutor@learnthrive.dev`) |
| Client | Sarah Ahmed (`client@learnthrive.dev`) |
| Student | Ayaan Ahmed, Year 10 |
| Link | Sarah Ahmed ↔ Ayaan Ahmed |
| Tuition Assignment | "GCSE Mathematics — Ayaan", Jamie Patel ↔ Ayaan Ahmed, `ACTIVE` |

## What's built on top of this (Phase C)

Admin-only pages (guarded by `requireRole(["ADMIN"])`, see `docs/ROLE_PERMISSIONS.md`):

- `/dashboard/admin/people` — lists Tutors, Clients, and Students, with an "Add" form for each (Server Actions, `apps/web/src/lib/actions/people.ts`).
- `/dashboard/admin/tutors/[id]`, `/dashboard/admin/clients/[id]`, `/dashboard/admin/students/[id]` — profile pages showing each person's Tuition Assignments (and, for Clients/Students, their linked relationships).
- `/dashboard/admin/assignments` — lists Tuition Assignments and lets Admin create a new one (Tutor + one or more Students, subject, optional level).
- `/dashboard/admin` — real summary cards (Tutor/Client/Student/active-assignment counts) computed from the repository data, not invented numbers (plan section 17/81's explicit warning against fake business charts).

Search, filters, and active/inactive toggling (plan section 48) are not built yet — the lists today show everyone; that refinement is left for when the person counts are large enough to need it.
