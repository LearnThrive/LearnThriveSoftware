import type { Lesson } from "@learnthrive/data/domain";

// Plan section 35: the classroom join window must be configurable, not hardcoded into the
// authorization check itself. A lesson's Tutor and Students may come in from 30 minutes before the
// start until 30 minutes after the scheduled end, in case it overruns (owner decision, 27 November
// 2026). Somebody invited to a staff meeting gets in 10 minutes early — see docs/CLASSROOM_INTEGRATION.md.
export const JOIN_WINDOW_MINUTES = {
  TUTOR_BEFORE: 30,
  STUDENT_BEFORE: 30,
  GUEST_BEFORE: 10,
  AFTER_END: 30,
} as const;

export type JoinWindowRole = "TUTOR" | "STUDENT" | "GUEST";

/** When this role's join window starts. */
export function joinOpensAt(lesson: Pick<Lesson, "startAt">, role: JoinWindowRole): Date {
  return new Date(new Date(lesson.startAt).getTime() - JOIN_WINDOW_MINUTES[`${role}_BEFORE`] * 60_000);
}

export function isWithinJoinWindow(lesson: Pick<Lesson, "startAt" | "durationMinutes">, role: JoinWindowRole, now: Date = new Date()): boolean {
  const start = new Date(lesson.startAt).getTime();
  const end = start + lesson.durationMinutes * 60_000;
  const windowStart = joinOpensAt(lesson, role).getTime();
  const windowEnd = end + JOIN_WINDOW_MINUTES.AFTER_END * 60_000;
  const nowMs = now.getTime();
  return nowMs >= windowStart && nowMs <= windowEnd;
}
