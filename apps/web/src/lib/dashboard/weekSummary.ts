import type { DataProvider } from "@learnthrive/data/repositories";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { visibleStudentsFor } from "@/lib/dashboard/queries";
import { visibleReportFor } from "@/lib/reports/reportService";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";

/**
 * "This week" for a Parent (plan15 Wave 11, feature A8): the lessons in the next seven days and the reports
 * that have arrived in the last seven, per what this person may see. Same readers as every other page:
 * `visibleLessonsFor` for lessons and `visibleReportFor` for reports (a Parent only ever gets APPROVED
 * reports, and only their parent-facing fields: this returns titles and dates, never report text).
 */
export const WEEK_DAYS = 7;

export interface WeekLesson {
  lessonId: string;
  title: string;
  startAt: string;
  childNames: string[];
}

export interface WeekReport {
  lessonId: string;
  lessonTitle: string;
  approvedAt: string;
}

export interface WeekSummary {
  lessons: WeekLesson[];
  newReports: WeekReport[];
}

export async function weekSummaryFor(data: DataProvider, user: AuthenticatedUser, now: Date = new Date()): Promise<WeekSummary> {
  const nowMs = now.getTime();
  const horizon = new Date(nowMs + WEEK_DAYS * 86_400_000).toISOString();
  const since = new Date(nowMs - WEEK_DAYS * 86_400_000).toISOString();
  const nowIso = now.toISOString();

  const lessons = await visibleLessonsFor(data, user);
  const students = await visibleStudentsFor(data, user);
  const nameById = new Map(students.map((s) => [s.id, s.name]));

  const comingUp = lessons
    .filter((lesson) => lesson.status !== "CANCELLED" && lesson.startAt >= nowIso && lesson.startAt <= horizon)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((lesson) => ({
      lessonId: lesson.id,
      title: lesson.title,
      startAt: lesson.startAt,
      childNames: lesson.studentIds.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n)),
    }));

  const newReports: WeekReport[] = [];
  for (const lesson of lessons) {
    const report = await data.reports.forLesson(lesson.id);
    const visible = report ? visibleReportFor(user, report) : null;
    if (visible && visible.status === "APPROVED" && visible.approvedAt && visible.approvedAt >= since && visible.approvedAt <= nowIso) {
      newReports.push({ lessonId: lesson.id, lessonTitle: lesson.title, approvedAt: visible.approvedAt });
    }
  }
  newReports.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));

  return { lessons: comingUp, newReports };
}
