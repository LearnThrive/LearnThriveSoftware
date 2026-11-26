import type { Lesson } from "@learnthrive/data/domain";

/** When a lesson is over: its start plus its length. */
export const lessonEndsAt = (lesson: Pick<Lesson, "startAt" | "durationMinutes">): number =>
  new Date(lesson.startAt).getTime() + lesson.durationMinutes * 60_000;

/** Not yet finished or cancelled. */
export const isOpen = (lesson: Pick<Lesson, "status">): boolean => lesson.status === "PLANNED" || lesson.status === "IN_PROGRESS";
