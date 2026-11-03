import type { AuthenticatedUser } from "./types";

/**
 * "Teaches" is a capability, not a role (docs/ROLE_PERMISSIONS.md): a person teaches if they have a tutor record, and that decides every
 * question about a tutor's tools and lessons, so an administrator who teaches gets them and an administrator who does not never does.
 * Pure, so the rules have a table test and the pages cannot drift apart.
 */
type Teacher = Pick<AuthenticatedUser, "role" | "profileId" | "tutorId">;

/** The tutor record this person teaches as, or null. A tutor's `profileId` is theirs; an administrator's is carried in `tutorId`. */
export function teachingTutorId(user: Teacher): string | null {
  if (user.role === "TUTOR") return user.profileId ?? null;
  if (user.role === "ADMIN") return user.tutorId ?? null;
  return null;
}

export function teaches(user: Teacher): boolean {
  return teachingTutorId(user) !== null;
}

/** True only for this lesson's own tutor: being an administrator is not enough. */
export function teachesLesson(user: Teacher, lesson: { tutorId: string }): boolean {
  const tutorId = teachingTutorId(user);
  return tutorId !== null && lesson.tutorId === tutorId;
}

/** How this person may enter this lesson's classroom, which also sets their join window. null: they may not, whatever their role. */
export function joinRoleFor(user: Teacher, lesson: { tutorId: string; studentIds: string[] }): "TUTOR" | "STUDENT" | null {
  if (teachesLesson(user, lesson)) return "TUTOR";
  if (user.role === "STUDENT" && user.profileId != null && lesson.studentIds.includes(user.profileId)) return "STUDENT";
  return null;
}

/**
 * The same person, scoped to their own teaching, for the queries behind the tutor pages. It only ever narrows what is listed (an
 * administrator normally sees everything): nothing may grant access on the strength of this copy. null if they do not teach.
 */
export function asTutor(user: AuthenticatedUser): AuthenticatedUser | null {
  const tutorId = teachingTutorId(user);
  return tutorId === null ? null : { ...user, role: "TUTOR", profileId: tutorId };
}
