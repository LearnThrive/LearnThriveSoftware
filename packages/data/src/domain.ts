// Domain model — Phase C (Tutors/Clients/Students/relationships/assignments) and Phase D
// (Lesson, recurrence, TutorAvailability) surface. LessonAttendance, LessonReport, Classroom,
// Notification, and ActivityEvent belong to later phases (F, E, G, H) — adding their types now,
// with nothing yet using them, would be exactly the kind of premature scaffolding this codebase
// avoids elsewhere.

export interface Tutor {
  id: string;
  // Links to the platform account (AuthenticatedUser.profileId) that can log in as this Tutor.
  // Optional because a Tutor record can exist (e.g. added by Admin) before an account does.
  userId?: string;
  name: string;
  email: string;
  subjects: string[];
  active: boolean;
  createdAt: string; // ISO 8601
}

export interface Client {
  id: string;
  userId?: string;
  name: string;
  email: string;
  phone?: string;
  active: boolean;
  createdAt: string;
}

export interface Student {
  id: string;
  // A Student may or may not have their own login — younger students in particular may be
  // represented only via their Client (parent/guardian)'s account for now.
  userId?: string;
  name: string;
  yearGroup?: string;
  active: boolean;
  createdAt: string;
}

// Many-to-many: a Client can have one or more Students, and (per plan section 14) a Student can
// have one or more associated Clients where the model supports it cleanly — a join table, not a
// foreign key on either side, is what "cleanly" means here.
export interface ClientStudentLink {
  clientId: string;
  studentId: string;
}

export type TuitionAssignmentStatus = "ACTIVE" | "PAUSED" | "ENDED";
export type LocationType = "ONLINE" | "IN_PERSON";

// "Tuition Assignment" — plan section 15's deliberate LearnThrive-native term, not TutorCruncher's
// "Job". Represents the ongoing relationship between student(s), a tutor, and a subject.
export interface TuitionAssignment {
  id: string;
  title: string;
  subject: string;
  level?: string;
  tutorId: string;
  studentIds: string[];
  clientIds: string[];
  status: TuitionAssignmentStatus;
  defaultDurationMinutes?: number;
  defaultLocationType?: LocationType;
  defaultLessonNotes?: string;
  createdAt: string;
}

// Plan section 27 — deliberately not overcomplicated for this prototype. CANCELLED_CHARGEABLE
// is explicitly deferred until billing exists (Phase B of the *plan's own* later phases, not
// this migration's Phase B).
export type LessonStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export type RecurrenceFrequency = "WEEKLY" | "BIWEEKLY" | "CUSTOM_WEEKDAYS";

// Not persisted on its own — folded onto the Lesson rows it produced, all sharing the same
// recurrenceId. Kept here only as the *input shape* used to generate a series (see
// apps/web/src/lib/scheduling/recurrence.ts); every individual occurrence is a real, independently
// editable Lesson row from the moment it's created, per plan section 28's "This lesson only /
// This and future / Entire series" edit model — a virtual/computed series can't support that.
export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  // 0 (Sunday) - 6 (Saturday), in the scheduling timezone. Required (and the sole driver of
  // which weekdays repeat) for CUSTOM_WEEKDAYS; for WEEKLY/BIWEEKLY it's derived from the first
  // occurrence's own weekday, so it isn't needed there.
  weekdays?: number[];
  endAfterOccurrences?: number;
  endDate?: string; // ISO date (yyyy-mm-dd), inclusive, in the scheduling timezone
}

export interface Lesson {
  id: string;
  assignmentId: string;
  tutorId: string;
  studentIds: string[];
  clientIds: string[];
  title: string;
  subject: string;
  startAt: string; // ISO 8601 UTC instant — never a naive local string, see docs/SCHEDULING.md
  durationMinutes: number;
  locationType: LocationType;
  location?: string; // required in practice for IN_PERSON, enforced by the scheduling service
  notes?: string;
  reportRequired: boolean;
  status: LessonStatus;
  // Present only for a lesson that's part of a recurring series — see RecurrenceInput above.
  recurrenceId?: string;
  cancelledAt?: string;
  cancelledBy?: string; // AuthenticatedUser.id
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}

// A single weekly-recurring block — plan section 31. AVAILABLE blocks are the only ones a Tutor
// needs to add for Admin to schedule sensibly; UNAVAILABLE blocks carve out exceptions within an
// otherwise-available week (e.g. a lunch break) without needing two separate AVAILABLE blocks.
export type AvailabilityBlockType = "AVAILABLE" | "UNAVAILABLE";

export interface TutorAvailabilityBlock {
  id: string;
  tutorId: string;
  type: AvailabilityBlockType;
  weekday: number; // 0-6, in the scheduling timezone
  startTime: string; // "HH:mm", 24-hour, in the scheduling timezone
  endTime: string;
}
