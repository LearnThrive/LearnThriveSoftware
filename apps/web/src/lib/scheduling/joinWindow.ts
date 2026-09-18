import type { Lesson } from "@learnthrive/data/domain";

// Plan section 35: the classroom join window must be configurable, not hardcoded into the
// authorization check itself. A Tutor gets in early to set up; a Student's window opens closer
// to the actual start time, and both stay open a little past the scheduled end in case a lesson
// overruns — see docs/CLASSROOM_INTEGRATION.md.
export const JOIN_WINDOW_MINUTES = {
  TUTOR_BEFORE: 30,
  STUDENT_BEFORE: 10,
  AFTER_END: 30,
} as const;

export function isWithinJoinWindow(lesson: Pick<Lesson, "startAt" | "durationMinutes">, role: "TUTOR" | "STUDENT", now: Date = new Date()): boolean {
  const start = new Date(lesson.startAt).getTime();
  const end = start + lesson.durationMinutes * 60_000;
  const beforeMinutes = role === "TUTOR" ? JOIN_WINDOW_MINUTES.TUTOR_BEFORE : JOIN_WINDOW_MINUTES.STUDENT_BEFORE;
  const windowStart = start - beforeMinutes * 60_000;
  const windowEnd = end + JOIN_WINDOW_MINUTES.AFTER_END * 60_000;
  const nowMs = now.getTime();
  return nowMs >= windowStart && nowMs <= windowEnd;
}
