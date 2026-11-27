"use server";

import { revalidatePath } from "next/cache";
import { getDataProvider } from "@/lib/data/provider";
import { requirePermission } from "@/lib/auth/guard";
import { mayActOnLesson } from "@/lib/auth/teaching";
import { AttendanceError, completeLesson, completeLessonAsAdmin, LessonCompletionError, markAttendance } from "@/lib/attendance/attendanceService";
import { holds } from "@/lib/auth/scope";
import type { AttendanceStatus } from "@learnthrive/data/domain";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const VALID_STATUSES: AttendanceStatus[] = ["ATTENDED", "ABSENT", "LATE", "EXCUSED"];

// A Tutor marks attendance only for their own Lesson — checked here independently of the page
// that renders the form, the same IDOR boundary every other mutating action in this app applies.
export async function markAttendanceAction(formData: FormData): Promise<void> {
  const user = await requirePermission("attendance.mark");
  const lessonId = text(formData, "lessonId");
  const studentId = text(formData, "studentId");
  const status = text(formData, "status");
  if (!lessonId || !studentId || !VALID_STATUSES.includes(status as AttendanceStatus)) {
    throw new Error("Lesson, Student, and a valid attendance status are required.");
  }

  const data = getDataProvider();
  const lesson = await data.lessons.get(lessonId);
  if (!lesson) throw new Error("Lesson not found.");
  if (!mayActOnLesson(user, lesson)) throw new Error("You are not the Tutor for this lesson.");
  if (!lesson.studentIds.includes(studentId)) throw new Error("That Student is not on this lesson.");

  const arrivalTime = text(formData, "arrivalTime");
  const departureTime = text(formData, "departureTime");
  const notes = text(formData, "notes");

  try {
    await markAttendance(data, lessonId, studentId, {
      status: status as AttendanceStatus,
      ...(arrivalTime ? { arrivalTime: new Date(arrivalTime).toISOString() } : {}),
      ...(departureTime ? { departureTime: new Date(departureTime).toISOString() } : {}),
      ...(notes ? { notes } : {}),
    }, user.id);
  } catch (error) {
    if (error instanceof AttendanceError) throw new Error(error.message);
    throw error;
  }

  revalidatePath(`/dashboard/lessons/${lessonId}`);
}

export async function completeLessonAction(formData: FormData): Promise<void> {
  const user = await requirePermission("lesson.complete");
  const lessonId = text(formData, "lessonId");
  if (!lessonId) throw new Error("Lesson is required.");

  const data = getDataProvider();
  const lesson = await data.lessons.get(lessonId);
  if (!lesson) throw new Error("Lesson not found.");
  if (!mayActOnLesson(user, lesson)) throw new Error("You are not the Tutor for this lesson.");

  try {
    await completeLesson(data, lessonId, user.id);
  } catch (error) {
    if (error instanceof LessonCompletionError) throw new Error(error.message);
    throw error;
  }
  revalidatePath(`/dashboard/lessons/${lessonId}`);
  revalidatePath("/dashboard/calendar");
}

export async function completeLessonAsAdminAction(formData: FormData): Promise<void> {
  const user = await requirePermission("lesson.complete");
  if (!holds(user, "ADMIN")) throw new Error("Only an administrator can do this.");
  const lessonId = text(formData, "lessonId");
  if (!lessonId) throw new Error("Lesson is required.");

  await completeLessonAsAdmin(getDataProvider(), lessonId, user.id);
  // The layout too: this may be the lesson the tutor's close-out screen was waiting for.
  revalidatePath("/dashboard", "layout");
}
