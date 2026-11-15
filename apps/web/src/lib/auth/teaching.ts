import { holds, recordFor, rolesOf } from "./scope";
import type { AuthenticatedUser } from "./types";

/**
 * "Teaches" follows from holding a teaching role: TUTOR or JUNIOR_TUTOR (docs/ROLE_PERMISSIONS.md). The role says they may teach; their tutor
 * record says whose lessons are theirs, and that decides every question about a tutor's tools and lessons. An administrator who does not hold
 * a teaching role never teaches, whatever else is true. (Until migration 0025 "teaches" was a capability of an administrator with a tutor
 * record; that capability is now the TUTOR role, backfilled for every such administrator.)
 * Pure, so the rules have a table test and the pages cannot drift apart.
 */
type Teacher = Pick<AuthenticatedUser, "role" | "roles" | "profileId" | "tutorId" | "clientId" | "studentId">;

/** The tutor record this person teaches as, or null. A tutor's record is theirs; an administrator holding TUTOR has one too. */
export function teachingTutorId(user: Teacher): string | null {
  const role = holds(user, "TUTOR") ? "TUTOR" : holds(user, "JUNIOR_TUTOR") ? "JUNIOR_TUTOR" : null;
  return role ? recordFor(user as AuthenticatedUser, role) : null;
}

export function teaches(user: Teacher): boolean {
  return teachingTutorId(user) !== null;
}

/** True only for this lesson's own tutor: being an administrator is not enough. */
export function teachesLesson(user: Teacher, lesson: { tutorId: string }): boolean {
  const tutorId = teachingTutorId(user);
  return tutorId !== null && lesson.tutorId === tutorId;
}

/**
 * May this person act on this lesson as staff (mark attendance, complete it, write its report)? An administrator, or the lesson's own tutor
 * (tutor or junior tutor). Being a student on it, or a tutor of some other lesson, is not enough. What they may DO is `can`'s question.
 */
export function mayActOnLesson(user: Teacher, lesson: { tutorId: string }): boolean {
  return holds(user, "ADMIN") || teachesLesson(user, lesson);
}

/**
 * How this person may enter this lesson's classroom, which also sets their join window. null: they may not, whatever their role.
 * A person who is a student on a lesson AND teaches it (never happens in practice) enters as its tutor.
 */
export function joinRoleFor(user: Teacher, lesson: { tutorId: string; studentIds: string[] }): "TUTOR" | "STUDENT" | null {
  if (teachesLesson(user, lesson)) return "TUTOR";
  const studentId = holds(user, "STUDENT") ? recordFor(user as AuthenticatedUser, "STUDENT") : null;
  if (studentId !== null && lesson.studentIds.includes(studentId)) return "STUDENT";
  return null;
}

/**
 * The same person, scoped to their own teaching, for the queries behind the tutor pages. It only ever narrows what is listed (an
 * administrator normally sees everything): nothing may grant access on the strength of this copy. null if they do not teach.
 * A junior tutor is scoped as a tutor here (the same students and lessons); what a junior may DO is decided by `can`, not by this copy.
 */
export function asTutor(user: AuthenticatedUser): AuthenticatedUser | null {
  const tutorId = teachingTutorId(user);
  if (tutorId === null) return null;
  return { ...user, role: holds(user, "TUTOR") ? "TUTOR" : "JUNIOR_TUTOR", roles: rolesOf(user).filter((r) => r === "TUTOR" || r === "JUNIOR_TUTOR"), profileId: tutorId };
}
