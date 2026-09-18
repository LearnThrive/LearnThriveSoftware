import type { DataProvider } from "@learnthrive/data/repositories";
import type { AttendanceStatus, Lesson, LessonAttendanceRecord } from "@learnthrive/data/domain";
import { logActivity } from "@/lib/activity/activityService";

export interface MarkAttendanceInput {
  status: AttendanceStatus;
  arrivalTime?: string;
  departureTime?: string;
  notes?: string;
}

/** Plan section 38: one record per Student per Lesson. Records who marked it and when — an
 * audit trail, not just the current decision. */
export async function markAttendance(
  data: DataProvider, lessonId: string, studentId: string, input: MarkAttendanceInput, markedBy: string,
): Promise<LessonAttendanceRecord> {
  const record: LessonAttendanceRecord = {
    lessonId, studentId, status: input.status, markedBy, markedAt: new Date().toISOString(),
    ...(input.arrivalTime ? { arrivalTime: input.arrivalTime } : {}),
    ...(input.departureTime ? { departureTime: input.departureTime } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };
  const saved = await data.attendance.upsert(record);
  const student = await data.students.get(studentId);
  await logActivity(data, lessonId, "ATTENDANCE_MARKED", `Attendance marked for ${student?.name ?? "a Student"}: ${input.status}`, markedBy);
  return saved;
}

export async function getAttendanceForLesson(data: DataProvider, lessonId: string): Promise<LessonAttendanceRecord[]> {
  return data.attendance.forLesson(lessonId);
}

export class LessonCompletionError extends Error {}

/** Plan section 66: "Do not prematurely set completed while mandatory fields are absent." Every
 * Student on the Lesson must have an attendance record before it can be marked Completed — a
 * report is not required here even if `reportRequired` is set, since LessonReport doesn't exist
 * yet (see docs/PRODUCTION_GAPS.md's Phase F note); that gate is added when Phase G builds it. */
export async function completeLesson(data: DataProvider, lessonId: string, actorId: string): Promise<Lesson> {
  const lesson = await data.lessons.get(lessonId);
  if (!lesson) throw new LessonCompletionError(`Lesson ${lessonId} not found`);
  if (lesson.status === "CANCELLED") throw new LessonCompletionError("A cancelled lesson cannot be marked complete.");

  const records = await data.attendance.forLesson(lessonId);
  const markedStudentIds = new Set(records.map((r) => r.studentId));
  const missing = lesson.studentIds.filter((id) => !markedStudentIds.has(id));
  if (missing.length > 0) throw new LessonCompletionError("Attendance must be marked for every Student before completing this lesson.");

  const completed = await data.lessons.update(lessonId, { status: "COMPLETED" });
  await logActivity(data, lessonId, "COMPLETED", "Lesson marked complete", actorId);
  return completed;
}
