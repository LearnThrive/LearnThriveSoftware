"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AttendanceStatus } from "@learnthrive/data/domain";
import { requirePermission } from "@/lib/auth/guard";
import { getDataProvider } from "@/lib/data/provider";
import { AttendanceError, LessonCompletionError } from "@/lib/attendance/attendanceService";
import { closeOutLesson, CloseOutError } from "@/lib/lessons/closeOut";
import { CLOSE_OUT_PATH } from "@/lib/lessons/closeOutGate";
import { ReportError, reportFieldsFrom } from "@/lib/reports/reportService";

const STATUSES: AttendanceStatus[] = ["ATTENDED", "ABSENT", "LATE", "EXCUSED"];

export async function finishLessonAction(formData: FormData): Promise<void> {
  const user = await requirePermission("lesson.complete");
  const lessonId = String(formData.get("lessonId") ?? "");
  const attendance: Partial<Record<string, AttendanceStatus>> = {};
  for (const [key, value] of formData.entries()) {
    const status = STATUSES.find((s) => s === value);
    if (key.startsWith("attendance:") && status) attendance[key.slice("attendance:".length)] = status;
  }

  let problem = "";
  try {
    await closeOutLesson(getDataProvider(), user, lessonId, { attendance, report: reportFieldsFrom(formData) });
  } catch (error) {
    if (!(error instanceof CloseOutError || error instanceof AttendanceError || error instanceof ReportError || error instanceof LessonCompletionError)) throw error;
    problem = error.message;
  }
  revalidatePath("/dashboard", "layout");
  redirect(problem ? `${CLOSE_OUT_PATH}?lesson=${encodeURIComponent(lessonId)}&error=${encodeURIComponent(problem)}` : CLOSE_OUT_PATH);
}
