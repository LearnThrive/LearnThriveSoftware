import type { DataProvider } from "@learnthrive/data/repositories";
import type { Lesson } from "@learnthrive/data/domain";
import type { AuthenticatedUser } from "@/lib/auth/types";

/** Plan section 24: calendar role filtering, enforced server-side, in exactly one place — every
 * page that lists lessons (the calendar, a dashboard's "next lesson" widget, etc.) calls this
 * rather than each re-implementing "which lessons can this role see". Admin sees everything;
 * everyone else sees only lessons connected to their own domain profile (via
 * AuthenticatedUser.profileId — see docs/DOMAIN_MODEL.md's cross-referencing note). A role
 * without a linked profileId yet sees nothing, not an error and not everything. */
export async function visibleLessonsFor(data: DataProvider, user: AuthenticatedUser): Promise<Lesson[]> {
  switch (user.role) {
    case "ADMIN":
      return data.lessons.list();
    case "TUTOR":
      return user.profileId ? data.lessons.forTutor(user.profileId) : [];
    case "CLIENT":
      return user.profileId ? data.lessons.forClient(user.profileId) : [];
    case "STUDENT":
      return user.profileId ? data.lessons.forStudent(user.profileId) : [];
    default:
      return [];
  }
}
