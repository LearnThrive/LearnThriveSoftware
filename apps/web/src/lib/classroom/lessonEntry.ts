import { signClassroomJoinToken } from "@learnthrive/shared/classroomToken";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { holds } from "@/lib/auth/scope";
import { joinRoleFor, teaches } from "@/lib/auth/teaching";
import { getDataProvider } from "@/lib/data/provider";
import { isWithinJoinWindow } from "@/lib/scheduling/joinWindow";

export type LessonEntry = { ok: true; token: string } | { ok: false; message: string };

/**
 * A fresh classroom join link for a lesson, for someone who is already in it and whose connection dropped (see app/api/classroom/token). It makes the
 * SAME checks as the lesson's Join button (lib/actions/classroom.ts) every time: they are this lesson's tutor or an enrolled student, it is an online
 * lesson that is not cancelled, and it is inside the join window. Nothing is remembered from the first join, so someone removed or no longer allowed
 * gets nothing.
 */
export async function enterLesson(user: AuthenticatedUser, lessonId: string, now: Date = new Date()): Promise<LessonEntry> {
  if (!teaches(user) && !holds(user, "STUDENT")) return { ok: false, message: "Only the assigned tutor or student can join this lesson's classroom." };
  const lesson = await getDataProvider().lessons.get(lessonId);
  if (!lesson) return { ok: false, message: "There is no such lesson." };
  const joinRole = joinRoleFor(user, lesson);
  if (!joinRole) return { ok: false, message: "You are not assigned to this lesson." };
  if (lesson.locationType !== "ONLINE" || !lesson.classroomRoomId) return { ok: false, message: "This lesson does not have an online classroom." };
  if (lesson.status === "CANCELLED") return { ok: false, message: "This lesson has been cancelled." };
  if (!isWithinJoinWindow(lesson, joinRole, now)) return { ok: false, message: "The classroom for this lesson is not open." };
  return {
    ok: true,
    token: signClassroomJoinToken({
      roomId: lesson.classroomRoomId, lessonId: lesson.id, name: user.name, role: joinRole === "TUTOR" ? "tutor" : "student", uid: user.id,
      exp: now.getTime() + 5 * 60_000,
    }),
  };
}
