import type { Lesson } from "@learnthrive/data/domain";

/**
 * "Lesson starting soon" reminders, worked out when a page is rendered (plan15 Wave 11, feature A6).
 *
 * This is a DERIVED view, not a stored notification: nothing is created, nothing is scheduled, and it cannot
 * be "marked read". It closes the visible half of the "no time-based notifications" gap
 * (docs/PRODUCTION_GAPS.md) without a scheduler: when someone has the app open within an hour of a lesson,
 * the page says so. It does nothing while the app is closed, and email/SMS reminders remain a separate piece
 * of work that needs a backend. The UI says this plainly rather than implying more.
 *
 * Pure, so it is unit-tested directly. The lessons passed in are whatever `visibleLessonsFor` returned for
 * the person; this function only filters and words them.
 */
export const REMINDER_WINDOW_MINUTES = 60;

export interface LessonReminder {
  lessonId: string;
  title: string;
  startAt: string;
  /** Whole minutes until it starts, 0 when it has just begun. */
  minutesUntil: number;
}

/** Planned lessons that start within the window (and have not started more than a few minutes ago). */
export function lessonsStartingSoon(
  lessons: readonly Lesson[],
  now: Date,
  windowMinutes: number = REMINDER_WINDOW_MINUTES,
): LessonReminder[] {
  const nowMs = now.getTime();
  return lessons
    .filter((lesson) => lesson.status === "PLANNED")
    .map((lesson) => ({ lesson, until: (new Date(lesson.startAt).getTime() - nowMs) / 60_000 }))
    .filter(({ until }) => until >= -5 && until <= windowMinutes)
    .sort((a, b) => a.until - b.until)
    .map(({ lesson, until }) => ({
      lessonId: lesson.id,
      title: lesson.title,
      startAt: lesson.startAt,
      minutesUntil: Math.max(0, Math.ceil(until)),
    }));
}

/** "starting now", "starts in 25 minutes", "starts in 1 hour". */
export function reminderWording(minutesUntil: number): string {
  if (minutesUntil <= 1) return "starting now";
  if (minutesUntil < 60) return `starts in ${minutesUntil} minutes`;
  const hours = Math.floor(minutesUntil / 60);
  const rest = minutesUntil % 60;
  const h = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? `starts in ${h}` : `starts in ${h} ${rest} minutes`;
}

/** True when a single lesson is inside the window (for a highlight on the next-lesson card). */
export function isStartingSoon(lesson: Pick<Lesson, "status" | "startAt">, now: Date, windowMinutes: number = REMINDER_WINDOW_MINUTES): boolean {
  return lessonsStartingSoon([lesson as Lesson], now, windowMinutes).length === 1;
}
