import type { DataProvider } from "@learnthrive/data/repositories";
import type { LessonStatus, ReportAssessmentLevel, Student } from "@learnthrive/data/domain";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { visibleStudentsFor } from "@/lib/dashboard/queries";
import { visibleReportFor } from "@/lib/reports/reportService";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";

/**
 * One student's progress over time (plan15 Wave 11 feature A2): the product's "progress you can see"
 * promise as a page. Built entirely from the readers every other page uses, so it can show no more than
 * they would:
 *
 *  - WHO: the student must be one `visibleStudentsFor` returns for this person (their child, themselves,
 *    a student they teach, or anyone for an Admin). Anything else returns `null`, which the page turns
 *    into a 404, so a guessed id is indistinguishable from an id that does not exist.
 *  - WHICH LESSONS: only lessons `visibleLessonsFor` returns for this person that include the student.
 *  - WHICH REPORT TEXT: only what `visibleReportFor` returns (a Parent or Student gets approved reports
 *    only, and never the Tutor-only fields). The entry copies the parent-safe fields by name, so an
 *    `internalTutorNotes` or `confidence` value cannot travel through here even if the report grows a
 *    field: the type below does not have a place for it, for any role (the full report, notes included,
 *    is on the lesson page, behind the lesson page's own checks).
 */
export interface ProgressReport {
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  publicSummary: string;
  progress?: string;
  areasForImprovement?: string;
  nextSteps?: string;
  engagement?: ReportAssessmentLevel;
}

export interface ProgressEntry {
  lessonId: string;
  title: string;
  subject: string;
  startAt: string;
  status: LessonStatus;
  /** True for a lesson that has not started yet. */
  upcoming: boolean;
  report: ProgressReport | null;
}

export interface StudentProgress {
  student: Student;
  /** Newest first. Cancelled lessons are left out: they are not part of the learning. */
  entries: ProgressEntry[];
  completedCount: number;
  reportCount: number;
}

export async function studentProgressFor(
  data: DataProvider,
  user: AuthenticatedUser,
  studentId: string,
  now: Date = new Date(),
): Promise<StudentProgress | null> {
  const students = await visibleStudentsFor(data, user);
  const student = students.find((s) => s.id === studentId);
  if (!student) return null;

  const nowIso = now.toISOString();
  const lessons = (await visibleLessonsFor(data, user))
    .filter((lesson) => lesson.studentIds.includes(studentId) && lesson.status !== "CANCELLED")
    .sort((a, b) => b.startAt.localeCompare(a.startAt));

  const entries: ProgressEntry[] = [];
  for (const lesson of lessons) {
    const full = await data.reports.forLesson(lesson.id);
    const visible = full ? visibleReportFor(user, full) : null;
    entries.push({
      lessonId: lesson.id,
      title: lesson.title,
      subject: lesson.subject,
      startAt: lesson.startAt,
      status: lesson.status,
      upcoming: lesson.startAt >= nowIso,
      report: visible
        ? {
            status: visible.status,
            publicSummary: visible.publicSummary,
            progress: visible.progress,
            areasForImprovement: visible.areasForImprovement,
            nextSteps: visible.nextSteps,
            engagement: visible.engagement,
          }
        : null,
    });
  }

  return {
    student,
    entries,
    completedCount: entries.filter((e) => e.status === "COMPLETED").length,
    reportCount: entries.filter((e) => e.report !== null).length,
  };
}
