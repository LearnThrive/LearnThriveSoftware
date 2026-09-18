import type { DataProvider } from "@learnthrive/data/repositories";
import type { LessonActivityEvent, LessonActivityEventType } from "@learnthrive/data/domain";

// Plan section 40: a chronological, append-only audit/activity timeline per Lesson. Deliberately
// thin — every other service (scheduling, attendance, reports) calls this directly rather than
// going through some larger "notify everyone" abstraction, since a Lesson's own timeline is all
// this phase needs.
export async function logActivity(
  data: DataProvider, lessonId: string, type: LessonActivityEventType, message: string, actorId?: string,
): Promise<LessonActivityEvent> {
  return data.activity.append({ lessonId, type, message, ...(actorId ? { actorId } : {}) });
}

export async function getActivityForLesson(data: DataProvider, lessonId: string): Promise<LessonActivityEvent[]> {
  return data.activity.forLesson(lessonId);
}
