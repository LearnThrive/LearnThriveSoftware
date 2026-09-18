# Supabase migration (future — not implemented)

Plan section 99: a map from the current in-memory repository layer to a future Postgres/Supabase
schema, so a real migration has a starting point instead of re-deriving the shape from scratch.
**Nothing in this document is implemented.** No Supabase project, table, or client exists in this
repository — see plan section 58, "future Supabase boundary," which is exactly why
`packages/data`'s repository interfaces (`packages/data/src/repositories.ts`) exist: application
code (`apps/web`'s pages, Server Actions, services) talks only to those interfaces, never to
`InMemoryDataProvider` directly, so a `SupabaseDataProvider` implementing the same interfaces is
the only change a real migration needs to make above the data layer.

## Repository → table map

| Current (in-memory) | Future Supabase table | Notes |
| --- | --- | --- |
| `apps/web`'s `AuthenticatedUser` / dev credential store (`devProvider.ts`) | `profiles` (Supabase Auth's own `auth.users`, extended with a `profiles` table for `role`) | The dev-only `DevelopmentAuthProvider` is replaced by a `SupabaseAuthProvider` implementing the same `AuthProvider` interface (`apps/web/src/lib/auth/types.ts`) — see `docs/AUTHENTICATION.md`. |
| `Tutor` | `tutors` | `userId` → `profiles.id` (nullable — not every Tutor necessarily has a login yet). |
| `Client` | `clients` | Same `userId` pattern. |
| `Student` | `students` | Same `userId` pattern. |
| `ClientStudentLink` | `client_students` | Composite key `(client_id, student_id)` — a genuine many-to-many join table, not a foreign key on either side (plan section 14). |
| `TuitionAssignment` | `tuition_assignments` | `studentIds`/`clientIds` arrays become a join table. |
| (derived from `TuitionAssignment.studentIds`) | `assignment_students` | The plan names this as its own table — normalizing what's currently an array column on `TuitionAssignment` in the in-memory model. |
| `Lesson` | `lessons` | `startAt` stays a real `timestamptz` (never a naive local column — plan section 62); `classroomRoomId` stays a random UUID, never derived from the row's own `id`. |
| `LessonAttendanceRecord` | `lesson_attendance` | Composite key `(lesson_id, student_id)`, matching the in-memory repository's own key shape. |
| `LessonReport` | `lesson_reports` | `internalTutorNotes`/`confidence` need a column-level or row-level policy that a Client/Student role can never select — see "Row Level Security" below; this is the single highest-stakes table to get RLS right on. |
| `TutorAvailabilityBlock` | `tutor_availability` | |
| `Notification` | `notifications` | |
| `LessonActivityEvent` | `activity_events` | Append-only in the in-memory model today; a real migration should consider a Postgres trigger or a `REVOKE UPDATE/DELETE` policy to keep that guarantee at the database level too, not just by applications behaving. |
| `PlatformSettings` | a `platform_settings` table (or a single-row config table) | Currently a single in-memory record; a real settings table would still likely stay single-row unless multi-tenancy is ever added (not currently planned). |

## What does NOT map 1:1

- **Ids**: the in-memory provider uses `crypto.randomUUID()` throughout; Postgres UUID columns
  (`gen_random_uuid()` default) are a direct match — no id-scheme change needed.
- **The `SEED_IDS` fixed demo ids** (`tutor-jamie-patel`, etc.) are a development convenience for
  cross-referencing two separate in-memory seed systems (`packages/data` and
  `apps/web`'s `devProvider.ts`) deterministically. A real migration seeds via SQL/fixtures and
  has no equivalent need for hand-picked string ids — real UUIDs throughout.
- **`resetDataProvider()`** (plan section 98) has no real-database equivalent beyond a normal
  migration/seed-reset script (e.g. `supabase db reset`) — nothing here to port, just a different
  tool for the same idea.

## Not started

No Supabase client dependency, environment variables, schema SQL, or migration files exist in
this repository. This document is deliberately just the map plan section 99 asks for — building
any of the above is explicitly out of scope until a real migration begins.
