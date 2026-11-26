import type { DataProvider } from "@learnthrive/data/repositories";
import type { AttendanceStatus, Lesson } from "@learnthrive/data/domain";
import { can } from "@/lib/auth/scope";
import { teachingTutorId } from "@/lib/auth/teaching";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { completeLesson, markAttendance } from "@/lib/attendance/attendanceService";
import { getOrCreateDraft, saveDraft, submitReport, type ReportFieldInput } from "@/lib/reports/reportService";
import { isOpen, lessonEndsAt } from "@/lib/lessons/timing";

/**
 * Closing a lesson out (docs/LESSON_REPORTS.md): once a lesson is over its tutor marks every student, writes the report and finishes it in one
 * step. Until then the rest of the dashboard is shut to them (lib/lessons/closeOutGate.ts).
 */

export class CloseOutError extends Error {}

/** The lessons this person has taught that are over and still wait for them, oldest first. */
export async function lessonsToCloseOut(data: DataProvider, user: AuthenticatedUser, now: Date = new Date()): Promise<Lesson[]> {
  const tutorId = teachingTutorId(user);
  if (!tutorId) return [];
  const ended = (await data.lessons.forTutor(tutorId))
    .filter((lesson) => isOpen(lesson) && lessonEndsAt(lesson) <= now.getTime())
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (can(user, "report.submit")) return ended;
  // A junior tutor cannot send a report on. Theirs is done once every student is marked and the report is written; an administrator sends it.
  const done = await Promise.all(ended.map((lesson) => juniorHasDonePart(data, lesson)));
  return ended.filter((_, index) => !done[index]);
}

async function juniorHasDonePart(data: DataProvider, lesson: Lesson): Promise<boolean> {
  if (!lesson.reportRequired) return false; // nothing stops them finishing it
  const [records, report] = await Promise.all([data.attendance.forLesson(lesson.id), data.reports.forLesson(lesson.id)]);
  return lesson.studentIds.every((id) => records.some((r) => r.studentId === id)) && Boolean(report?.publicSummary.trim());
}

/** Whether this person may finish this lesson here: their own, started, and not already finished or cancelled. */
export function mayCloseOut(user: AuthenticatedUser, lesson: Lesson, now: Date = new Date()): boolean {
  return teachingTutorId(user) === lesson.tutorId && isOpen(lesson) && new Date(lesson.startAt).getTime() <= now.getTime();
}

/** What a required report still lacks. When nobody attended there is nothing to assess, so only the summary is asked for. */
export function missingReportFields(fields: ReportFieldInput, nobodyAttended: boolean): string[] {
  const missing: string[] = [];
  if (!fields.publicSummary.trim()) missing.push("lesson summary");
  if (nobodyAttended) return missing;
  if (!fields.progress) missing.push("progress");
  if (!fields.areasForImprovement) missing.push("areas to improve");
  if (!fields.nextSteps) missing.push("homework or next steps");
  if (!fields.engagement) missing.push("engagement");
  if (!fields.confidence) missing.push("confidence");
  return missing;
}

export interface CloseOutInput {
  attendance: Partial<Record<string, AttendanceStatus>>;
  report: ReportFieldInput;
}

/** "completed", or "awaiting-admin" for a junior tutor whose report an administrator still has to send on. */
export async function closeOutLesson(
  data: DataProvider, user: AuthenticatedUser, lessonId: string, input: CloseOutInput, now: Date = new Date(),
): Promise<"completed" | "awaiting-admin"> {
  const lesson = await data.lessons.get(lessonId);
  if (!lesson || !mayCloseOut(user, lesson, now)) throw new CloseOutError("This lesson cannot be finished here. It may already be finished or cancelled.");

  // The report is saved first, so nothing the tutor typed is lost when something else is still missing.
  const existing = await data.reports.forLesson(lessonId);
  const writing = !existing || existing.status === "DRAFT";
  const wrote = Object.values(input.report).some(Boolean);
  const draft = writing && wrote ? await getOrCreateDraft(data, lessonId, lesson.tutorId) : null;
  if (draft) await saveDraft(data, draft.id, input.report);

  const records = await data.attendance.forLesson(lessonId);
  for (const studentId of lesson.studentIds) {
    const status = input.attendance[studentId];
    if (status && records.find((r) => r.studentId === studentId)?.status !== status) {
      await markAttendance(data, lessonId, studentId, { status }, user.id, now);
    }
  }

  const marked = await data.attendance.forLesson(lessonId);
  const unmarked = lesson.studentIds.filter((id) => !marked.some((r) => r.studentId === id));
  const nobodyAttended = unmarked.length === 0 && marked.length > 0 && marked.every((r) => r.status === "ABSENT" || r.status === "EXCUSED");
  const missing = [
    ...(unmarked.length > 0 ? ["attendance for every student"] : []),
    ...(writing && lesson.reportRequired ? missingReportFields(input.report, nobodyAttended) : []),
  ];
  if (missing.length > 0) throw new CloseOutError(`Still needed before you can finish: ${missing.join(", ")}.`);

  if (!can(user, "report.submit")) {
    if (lesson.reportRequired && writing) return "awaiting-admin";
  } else if (draft && input.report.publicSummary.trim()) {
    await submitReport(data, draft.id, user.id);
  }
  await completeLesson(data, lessonId, user.id);
  return "completed";
}
