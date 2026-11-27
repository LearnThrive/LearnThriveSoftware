import type { DataProvider } from "@learnthrive/data/repositories";
import type { Lesson, LessonReport, Student } from "@learnthrive/data/domain";
import { unionOver } from "@/lib/auth/scope";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";
import { isOpen, lessonEndsAt } from "@/lib/lessons/timing";

/**
 * Shared, role-aware reads used by more than one page (dashboards, the Lessons list, the Reports
 * area, profiles). They exist so "which lessons may this person see" is answered in exactly one
 * place — `visibleLessonsFor` — rather than each page re-deriving it and eventually disagreeing.
 */

export interface LessonBuckets {
  all: Lesson[];
  upcoming: Lesson[];
  past: Lesson[];
  /** On now: started, not yet over, not finished or cancelled. */
  ongoing: Lesson[];
  /** Over but never closed out: still PLANNED/IN_PROGRESS after its scheduled end. */
  needsAttention: Lesson[];
  todays: Lesson[];
  next: Lesson | null;
}

export async function lessonBucketsFor(data: DataProvider, user: AuthenticatedUser, now = new Date()): Promise<LessonBuckets> {
  const all = await visibleLessonsFor(data, user);
  const nowIso = now.toISOString();
  const byStart = (a: Lesson, b: Lesson) => a.startAt.localeCompare(b.startAt);

  const live = all.filter((lesson) => lesson.status !== "CANCELLED");
  const started = live.filter((lesson) => lesson.startAt < nowIso);
  const ongoing = started.filter((lesson) => isOpen(lesson) && lessonEndsAt(lesson) > now.getTime()).sort(byStart);
  // A lesson that is on now comes first among the upcoming ones: hiding it once it started left a late student with "No lessons scheduled".
  const upcoming = [...ongoing, ...live.filter((lesson) => lesson.startAt >= nowIso).sort(byStart)];
  const past = started.filter((lesson) => !ongoing.includes(lesson)).sort((a, b) => b.startAt.localeCompare(a.startAt));
  const needsAttention = past.filter(isOpen).sort(byStart);

  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const todays = live
    .filter((lesson) => lesson.startAt >= dayStart.toISOString() && lesson.startAt < dayEnd.toISOString())
    .sort(byStart);

  return { all, upcoming, past, ongoing, needsAttention, todays, next: upcoming[0] ?? null };
}

/** Reports this person may see, newest first, already filtered to their visible lessons. */
export async function visibleReportsFor(
  data: DataProvider, user: AuthenticatedUser,
): Promise<Array<{ report: LessonReport; lesson: Lesson }>> {
  const lessons = await visibleLessonsFor(data, user);
  const pairs: Array<{ report: LessonReport; lesson: Lesson }> = [];
  for (const lesson of lessons) {
    const report = await data.reports.forLesson(lesson.id);
    if (report) pairs.push({ report, lesson });
  }
  return pairs.sort((a, b) => b.lesson.startAt.localeCompare(a.lesson.startAt));
}

/** The Students this person is entitled to see: their own children (Client), the ones they teach
 * (Tutor), themselves (Student), or everyone (Admin). */
export async function visibleStudentsFor(data: DataProvider, user: AuthenticatedUser): Promise<Student[]> {
  // Several roles: the students each role reaches on its own record, merged. A student who is also a junior tutor sees themselves and the
  // students they are assigned to, not every student (docs/ROLE_PERMISSIONS.md).
  return unionOver(user, (scoped) => visibleStudentsForRole(data, scoped));
}

async function visibleStudentsForRole(data: DataProvider, user: AuthenticatedUser): Promise<Student[]> {
  if (user.role === "ADMIN") return data.students.list();
  if (!user.profileId) return [];
  if (user.role === "CLIENT") return data.students.studentsFor(user.profileId);
  if (user.role === "STUDENT") {
    const self = await data.students.get(user.profileId);
    return self ? [self] : [];
  }
  // Tutor or junior tutor: everyone on one of their assignments.
  const assignments = await data.assignments.forTutor(user.profileId);
  const ids = [...new Set(assignments.flatMap((assignment) => assignment.studentIds))];
  const students = await Promise.all(ids.map((id) => data.students.get(id)));
  return students.filter((student): student is Student => student !== null);
}

/** The lesson that is on now, else the next one, for one specific student, within what `user` may see. */
export function nextLessonForStudent(lessons: Lesson[], studentId: string, now = new Date()): Lesson | null {
  const nowIso = now.toISOString();
  return lessons
    .filter((lesson) => lesson.status !== "CANCELLED" && lesson.studentIds.includes(studentId) && (lesson.startAt >= nowIso || (isOpen(lesson) && lessonEndsAt(lesson) > now.getTime())))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
}
