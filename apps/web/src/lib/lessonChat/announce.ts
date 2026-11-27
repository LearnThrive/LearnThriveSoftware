import type { DataProvider } from "@learnthrive/data/repositories";
import type { MessageView } from "@learnthrive/data/lessonChat";
import { formatLessonDayTime } from "@/lib/format";
import { lessonEndsAt } from "@/lib/lessons/timing";
import { notifyProfiles } from "@/lib/notifications/notificationService";

/**
 * Lets the others know about a message sent outside the lesson's time ("I'm running late", "I can't make it"), with an in-app notification: from the
 * tutor to the students, from a student to the tutor, from an administrator to both. During the lesson nobody is notified, since the chat is open in
 * front of them. The notification carries no message text, so an administrator removing a message leaves no copy behind.
 */
export async function announceMessage(data: DataProvider, lessonId: string, message: Pick<MessageView, "senderParty" | "senderName">, now: Date = new Date()): Promise<void> {
  const lesson = await data.lessons.get(lessonId);
  if (!lesson) return;
  if (now.getTime() >= new Date(lesson.startAt).getTime() && now.getTime() < lessonEndsAt(lesson)) return;
  const recipients = message.senderParty === "tutor" ? lesson.studentIds : message.senderParty === "student" ? [lesson.tutorId] : [lesson.tutorId, ...lesson.studentIds];
  await notifyProfiles(data, recipients, "LESSON_MESSAGE", `${message.senderName} sent a message about "${lesson.title}" on ${formatLessonDayTime(lesson.startAt)}.`, `/dashboard/lessons/${lesson.id}`);
}
