import type { DataProvider } from "@learnthrive/data/repositories";
import type { Lesson, LocationType, RecurrenceInput, TuitionAssignment } from "@learnthrive/data/domain";
import { generateRecurrenceOccurrences } from "./recurrence";
import { formatInTimeZone, LEARNTHRIVE_DEFAULT_TIMEZONE } from "./timezone";
import { logActivity } from "@/lib/activity/activityService";

export interface ConflictWarning {
  kind: "TUTOR" | "STUDENT";
  lesson: Lesson;
}

/** Plan section 30: warn, don't silently double-book, and let Admin override. Checks the Tutor
 * and every Student on the prospective lesson independently, so a warning can say exactly who's
 * double-booked rather than a generic "conflict". */
export async function detectConflicts(
  data: DataProvider,
  params: { tutorId: string; studentIds: string[]; startAt: string; durationMinutes: number; excludeLessonId?: string },
): Promise<ConflictWarning[]> {
  const warnings: ConflictWarning[] = [];
  const tutorConflicts = await data.lessons.overlapping({
    tutorId: params.tutorId, startAt: params.startAt, durationMinutes: params.durationMinutes, excludeLessonId: params.excludeLessonId,
  });
  for (const lesson of tutorConflicts) warnings.push({ kind: "TUTOR", lesson });

  for (const studentId of params.studentIds) {
    const studentConflicts = await data.lessons.overlapping({
      studentId, startAt: params.startAt, durationMinutes: params.durationMinutes, excludeLessonId: params.excludeLessonId,
    });
    for (const lesson of studentConflicts) warnings.push({ kind: "STUDENT", lesson });
  }
  return warnings;
}

export interface CreateLessonInput {
  assignment: TuitionAssignment;
  title: string;
  subject: string;
  startAt: string; // UTC ISO instant of the first/only occurrence
  durationMinutes: number;
  locationType: LocationType;
  location?: string;
  notes?: string;
  reportRequired: boolean;
  recurrence?: RecurrenceInput;
  createdBy?: string; // AuthenticatedUser.id, for the activity log
}

/** Creates a single lesson, or — if `recurrence` is given — a whole series of independently
 * editable Lesson rows sharing one recurrenceId (plan section 28: each occurrence must support
 * "this lesson only / this and future / entire series" edits, which needs real rows, not a
 * computed series). Does not itself check for conflicts — call detectConflicts() first and let
 * the caller decide whether to proceed (Admin can override, per plan section 30). */
export async function createLessonOrSeries(data: DataProvider, input: CreateLessonInput): Promise<Lesson[]> {
  const base = {
    assignmentId: input.assignment.id,
    tutorId: input.assignment.tutorId,
    studentIds: input.assignment.studentIds,
    clientIds: input.assignment.clientIds,
    title: input.title,
    subject: input.subject,
    durationMinutes: input.durationMinutes,
    locationType: input.locationType,
    ...(input.location ? { location: input.location } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    reportRequired: input.reportRequired,
    status: "PLANNED" as const,
  };

  // A fresh, unguessable room per lesson occurrence — never derived from or shared with the
  // lesson id, and never reused across occurrences of the same series, so one lesson's link
  // can't be replayed into a different lesson's classroom.
  const classroomFields = () => (input.locationType === "ONLINE" ? { classroomRoomId: crypto.randomUUID() } : {});

  let created: Lesson[];
  if (!input.recurrence) {
    created = [await data.lessons.create({ ...base, ...classroomFields(), startAt: input.startAt })];
  } else {
    const recurrenceId = crypto.randomUUID();
    const occurrences = generateRecurrenceOccurrences(new Date(input.startAt), input.recurrence, LEARNTHRIVE_DEFAULT_TIMEZONE);
    created = await data.lessons.createMany(
      occurrences.map((occurrence) => ({ ...base, ...classroomFields(), startAt: occurrence.toISOString(), recurrenceId })),
    );
  }
  for (const lesson of created) {
    await logActivity(data, lesson.id, "CREATED", `Lesson created for ${formatInTimeZone(lesson.startAt, LEARNTHRIVE_DEFAULT_TIMEZONE, { dateStyle: "medium", timeStyle: "short" })}`, input.createdBy);
  }
  return created;
}

export type RescheduleScope = "THIS_ONLY" | "THIS_AND_FUTURE" | "ENTIRE_SERIES";

/** Plan section 28's edit-scope model, and section 65 (rescheduling history — see the
 * activity-log note in ActivityService once that exists) for why the caller must record what
 * changed, not just apply it silently. Preserves each occurrence's own time when shifting a
 * series by a delta (so "move the whole series 30 minutes later" doesn't collapse every
 * occurrence onto the first one's new time). */
export async function rescheduleLesson(
  data: DataProvider,
  lessonId: string,
  newStartAt: string,
  scope: RescheduleScope,
  actorId?: string,
): Promise<Lesson[]> {
  const lesson = await data.lessons.get(lessonId);
  if (!lesson) throw new Error(`Lesson ${lessonId} not found`);

  // "Changed from Tuesday 17:00 to Thursday 18:00" (plan section 65) — recorded once per
  // request, against the lesson the Admin actually edited, even when the change cascades to
  // other occurrences in the series.
  const changeMessage = `Rescheduled from ${formatInTimeZone(lesson.startAt, LEARNTHRIVE_DEFAULT_TIMEZONE, { weekday: "long", hour: "2-digit", minute: "2-digit" })} to ${formatInTimeZone(newStartAt, LEARNTHRIVE_DEFAULT_TIMEZONE, { weekday: "long", hour: "2-digit", minute: "2-digit" })}`;

  if (scope === "THIS_ONLY" || !lesson.recurrenceId) {
    const updated = await data.lessons.update(lessonId, { startAt: newStartAt });
    await logActivity(data, lessonId, "RESCHEDULED", changeMessage, actorId);
    return [updated];
  }

  const deltaMs = new Date(newStartAt).getTime() - new Date(lesson.startAt).getTime();
  const series = await data.lessons.forRecurrence(lesson.recurrenceId);
  const targets = scope === "ENTIRE_SERIES" ? series : series.filter((l) => l.startAt >= lesson.startAt);

  const updated: Lesson[] = [];
  for (const target of targets) {
    const shifted = new Date(new Date(target.startAt).getTime() + deltaMs).toISOString();
    updated.push(await data.lessons.update(target.id, { startAt: shifted }));
  }
  await logActivity(data, lessonId, "RESCHEDULED", `${changeMessage} (${scope === "ENTIRE_SERIES" ? "entire series" : "this and future lessons"})`, actorId);
  return updated;
}

/** Plan section 64: cancelling records who/when/why and never deletes the row. */
export async function cancelLesson(
  data: DataProvider,
  lessonId: string,
  cancelledBy: string,
  reason: string | undefined,
): Promise<Lesson> {
  const lesson = await data.lessons.update(lessonId, {
    status: "CANCELLED", cancelledAt: new Date().toISOString(), cancelledBy, ...(reason ? { cancellationReason: reason } : {}),
  });
  await logActivity(data, lessonId, "CANCELLED", reason ? `Lesson cancelled — ${reason}` : "Lesson cancelled", cancelledBy);
  return lesson;
}
