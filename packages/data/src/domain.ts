// Domain model — Phase C surface only (Tutors/Clients/Students/relationships/assignments).
// Lesson, LessonAttendance, LessonReport, TutorAvailability, Classroom, Notification, and
// ActivityEvent are named "at minimum" in the plan behind this migration but belong to later
// phases (D, E, F, G, H) — adding their types now, with nothing yet using them, would be
// exactly the kind of premature scaffolding this codebase avoids elsewhere.

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
