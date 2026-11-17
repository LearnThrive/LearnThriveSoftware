"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDataProvider } from "@/lib/data/provider";
import { requireRole } from "@/lib/auth/guard";
import { cancelLesson, createLessonOrSeries, detectConflicts, rescheduleLesson, type RescheduleScope } from "@/lib/scheduling/schedulingService";
import { zonedTimeToUtc } from "@/lib/scheduling/timezone";
import { notifyRole } from "@/lib/notifications/notificationService";
import type { RecurrenceFrequency } from "@learnthrive/data/domain";
import { parseDuration } from "@/lib/scheduling/duration";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export interface CreateLessonFieldValues {
  assignmentId: string; title: string; subject: string; date: string; time: string;
  durationHours: string; durationExtra: string; locationType: string; location: string; notes: string;
  reportRequired: boolean; frequency: string; endAfterOccurrences: string; endDate: string;
  /** "Repeat every N weeks" and the weekdays (0 Sunday to 6 Saturday), for the custom repeat. */
  intervalWeeks: string; weekdays: string[];
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
  // The length is hours and minutes (two boxes). A plain "durationMinutes" is still understood, for anything that posts the older field.
  const durationHours = text(formData, "durationHours");
  const durationExtra = text(formData, "durationExtra");
  const legacyMinutes = text(formData, "durationMinutes");
  const duration = legacyMinutes && !durationHours && !durationExtra ? parseDuration("0", legacyMinutes) : parseDuration(durationHours, durationExtra);
  const locationType = text(formData, "locationType") === "IN_PERSON" ? "IN_PERSON" as const : "ONLINE" as const;
  const location = text(formData, "location");
  const notes = text(formData, "notes");
  const reportRequired = formData.get("reportRequired") === "on";
  const confirmOverride = formData.get("confirmOverride") === "1";

  const frequency = text(formData, "frequency");
  const endAfterOccurrences = text(formData, "endAfterOccurrences");
  const endDate = text(formData, "endDate");
  const intervalWeeksText = text(formData, "intervalWeeks");
  const weekdayValues = formData.getAll("weekdays").map(String);

  const values: CreateLessonFieldValues = {
    assignmentId, title, subject, date: dateStr, time: timeStr,
    durationHours, durationExtra, locationType, location, notes,
    reportRequired, frequency: frequency || "NONE", endAfterOccurrences, endDate,
    intervalWeeks: intervalWeeksText, weekdays: weekdayValues,
  };

  if (!assignmentId || !title || !subject || !dateStr || !timeStr) {
    return { error: "Assignment, title, subject, date, and time are all required.", values };
  }
  if (!duration.ok) return { error: duration.message, values };
  const durationMinutes = duration.minutes;
  const assignment = await data.assignments.get(assignmentId);
  if (!assignment) return { error: "That Tuition Assignment no longer exists.", values };
  // A paused (for example an overdue family) or ended assignment gets no new lessons until it is resumed.
  if (assignment.status !== "ACTIVE") return { error: `This assignment is ${assignment.status.toLowerCase()}, so no new lessons can be scheduled on it. Resume it first.`, values };

  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const startAt = zonedTimeToUtc({ year, month, day, hour, minute }, "Europe/London").toISOString();

  // How it repeats: not at all, every week, every two weeks, or a custom pattern (every N weeks, on the days chosen).
  const endAfter = endAfterOccurrences ? Number(endAfterOccurrences) : undefined;
  if (frequency && frequency !== "NONE" && endAfter !== undefined && (!Number.isInteger(endAfter) || endAfter < 1 || endAfter > 104)) {
    return { error: "End after a whole number of lessons, from 1 to 104.", values };
  }
  let recurrence: { frequency: RecurrenceFrequency; weekdays?: number[]; intervalWeeks?: number; endAfterOccurrences?: number; endDate?: string } | undefined;
  if (frequency === "CUSTOM") {
    const intervalWeeks = Number(intervalWeeksText || "1");
    const weekdays = [...new Set(weekdayValues.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
    if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 12) return { error: "Repeat every a whole number of weeks, from 1 to 12.", values };
    if (weekdays.length === 0) return { error: "Choose at least one day of the week for the repeat.", values };
    recurrence = { frequency: "CUSTOM_WEEKDAYS", weekdays, intervalWeeks, ...(endAfter ? { endAfterOccurrences: endAfter } : {}), ...(endDate ? { endDate } : {}) };
  } else if (frequency === "WEEKLY" || frequency === "BIWEEKLY") {
    recurrence = { frequency, ...(endAfter ? { endAfterOccurrences: endAfter } : {}), ...(endDate ? { endDate } : {}) };
  }

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

  // The side panel can also change the length (hours and minutes). The calendar's drag-to-move sends neither box, and leaves lengths alone.
  const hours = text(formData, "durationHours");
  const extra = text(formData, "durationExtra");
  let newDurationMinutes: number | undefined;
  if (hours !== "" || extra !== "") {
    const parsed = parseDuration(hours, extra);
    if (!parsed.ok) throw new Error(parsed.message);
    newDurationMinutes = parsed.minutes;
  }

  await rescheduleLesson(data, lessonId, newStartAtIso, scope, user.id, newDurationMinutes);
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

const LESSON_FILTERS = ["upcoming", "needs-attention", "completed", "cancelled", "all"];
const MAX_BULK_CANCEL = 500;

/**
 * Cancels every ticked lesson on the Lessons list (administrator only, and re-checked here: a server action is a public POST endpoint).
 * Each one goes through the same cancelLesson as the single button, so each records who, when and why and stays on record as
 * cancelled. A lesson that is no longer planned (already cancelled, completed) is skipped, not an error, and the count says so.
 */
export async function cancelLessonsAction(formData: FormData): Promise<void> {
  const user = await requireRole(["ADMIN"]);
  const ids = [...new Set(formData.getAll("lessonId").map(String).filter(Boolean))].slice(0, MAX_BULK_CANCEL);
  const reason = text(formData, "reason");
  const filter = LESSON_FILTERS.includes(text(formData, "filter")) ? text(formData, "filter") : "upcoming";
  const back = `/dashboard/lessons?filter=${filter}`;
  if (ids.length === 0) redirect(`${back}&toast=${encodeURIComponent("Tick the lessons to cancel first.")}`);

  const data = getDataProvider();
  let cancelled = 0;
  for (const id of ids) {
    const lesson = await data.lessons.get(id);
    if (!lesson || lesson.status !== "PLANNED") continue;
    await cancelLesson(data, id, user.id, reason || undefined);
    cancelled += 1;
  }
  revalidatePath("/dashboard/lessons");
  revalidatePath("/dashboard/calendar");
  const skipped = ids.length - cancelled;
  const message = `${cancelled} lesson${cancelled === 1 ? "" : "s"} cancelled${skipped > 0 ? `, ${skipped} skipped because they were not planned` : ""}`;
  redirect(`${back}&toast=${encodeURIComponent(message)}`);
}
