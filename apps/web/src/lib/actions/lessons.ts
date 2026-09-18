"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireRole } from "@/lib/auth/guard";
import { cancelLesson, createLessonOrSeries, detectConflicts, rescheduleLesson, type RescheduleScope } from "@/lib/scheduling/schedulingService";
import { zonedTimeToUtc } from "@/lib/scheduling/timezone";
import { notifyRole } from "@/lib/notifications/notificationService";
import type { RecurrenceFrequency } from "@learnthrive/data/domain";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export interface CreateLessonFieldValues {
  assignmentId: string; title: string; subject: string; date: string; time: string;
  durationMinutes: string; locationType: string; location: string; notes: string;
  reportRequired: boolean; frequency: string; endAfterOccurrences: string; endDate: string;
}

export interface CreateLessonState {
  error?: string;
  conflicts?: { kind: "TUTOR" | "STUDENT"; lessonTitle: string; startAt: string }[];
  // Echoes what was submitted, since useActionState's re-render doesn't itself preserve
  // uncontrolled <form> field values (see LessonForm.tsx's remount-on-state-change comment) —
  // without this, the conflict-confirmation step would silently wipe the user's entered data.
  values?: CreateLessonFieldValues;
}

// A two-step confirm for conflicts: the first submission returns the warnings (via returned
// state) rather than blocking outright — plan section 30: "warn... allow Admin override".
// Re-submitting with confirmOverride=1 proceeds despite the same conflicts.
export async function createLessonAction(_prevState: CreateLessonState, formData: FormData): Promise<CreateLessonState> {
  const user = await requireRole(["ADMIN"]);
  const data = getDataProvider();

  const assignmentId = text(formData, "assignmentId");
  const title = text(formData, "title");
  const subject = text(formData, "subject");
  const dateStr = text(formData, "date"); // yyyy-mm-dd
  const timeStr = text(formData, "time"); // HH:mm
  const durationMinutes = Number(text(formData, "durationMinutes") || "60");
  const locationType = text(formData, "locationType") === "IN_PERSON" ? "IN_PERSON" as const : "ONLINE" as const;
  const location = text(formData, "location");
  const notes = text(formData, "notes");
  const reportRequired = formData.get("reportRequired") === "on";
  const confirmOverride = formData.get("confirmOverride") === "1";

  const frequency = text(formData, "frequency");
  const endAfterOccurrences = text(formData, "endAfterOccurrences");
  const endDate = text(formData, "endDate");

  const values: CreateLessonFieldValues = {
    assignmentId, title, subject, date: dateStr, time: timeStr,
    durationMinutes: text(formData, "durationMinutes"), locationType, location, notes,
    reportRequired, frequency: frequency || "NONE", endAfterOccurrences, endDate,
  };

  if (!assignmentId || !title || !subject || !dateStr || !timeStr) {
    return { error: "Assignment, title, subject, date, and time are all required.", values };
  }
  const assignment = await data.assignments.get(assignmentId);
  if (!assignment) return { error: "That Tuition Assignment no longer exists.", values };

  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const startAt = zonedTimeToUtc({ year, month, day, hour, minute }, "Europe/London").toISOString();

  const recurrence = frequency && frequency !== "NONE"
    ? {
        frequency: frequency as RecurrenceFrequency,
        ...(endAfterOccurrences ? { endAfterOccurrences: Number(endAfterOccurrences) } : {}),
        ...(endDate ? { endDate } : {}),
      }
    : undefined;

  const conflicts = await detectConflicts(data, {
    tutorId: assignment.tutorId, studentIds: assignment.studentIds, startAt, durationMinutes,
  });
  if (conflicts.length > 0) {
    if (!confirmOverride) {
      return {
        conflicts: conflicts.map((c) => ({ kind: c.kind, lessonTitle: c.lesson.title, startAt: c.lesson.startAt })),
        values,
      };
    }
    // Plan section 54: Admin gets notified whenever a scheduling conflict was knowingly
    // overridden, so it's visible somewhere other than the moment of the click itself.
    await notifyRole(data, "ADMIN", "SCHEDULING_CONFLICT", `"${title}" was scheduled despite a conflict with ${conflicts.length} other lesson${conflicts.length > 1 ? "s" : ""}.`, "/dashboard/calendar");
  }

  await createLessonOrSeries(data, {
    assignment, title, subject, startAt, durationMinutes, locationType,
    ...(location ? { location } : {}), ...(notes ? { notes } : {}), reportRequired, recurrence, createdBy: user.id,
  });
  revalidatePath("/dashboard/calendar");
  redirect("/dashboard/calendar");
}

export async function rescheduleLessonAction(formData: FormData): Promise<void> {
  const user = await requireRole(["ADMIN"]);
  const lessonId = text(formData, "lessonId");
  const newStartAtIso = text(formData, "newStartAt"); // already a UTC ISO instant
  const scope = (text(formData, "scope") || "THIS_ONLY") as RescheduleScope;
  if (!lessonId || !newStartAtIso) throw new Error("Lesson and new start time are required.");

  const data = getDataProvider();
  const lesson = await data.lessons.get(lessonId);
  if (!lesson) throw new Error("Lesson not found.");

  await rescheduleLesson(data, lessonId, newStartAtIso, scope, user.id);
  revalidatePath("/dashboard/calendar");
  revalidatePath(`/dashboard/lessons/${lessonId}`);
}

export async function cancelLessonAction(formData: FormData): Promise<void> {
  const user = await requireRole(["ADMIN"]);
  const lessonId = text(formData, "lessonId");
  const reason = text(formData, "reason");
  if (!lessonId) throw new Error("Lesson is required.");

  const data = getDataProvider();
  await cancelLesson(data, lessonId, user.id, reason || undefined);
  revalidatePath("/dashboard/calendar");
  revalidatePath(`/dashboard/lessons/${lessonId}`);
  redirect(`/dashboard/lessons/${lessonId}`);
}
