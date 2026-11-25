import { signClassroomJoinToken, type ClassroomJoinTokenPayload } from "@learnthrive/shared/classroomToken";
import type { Lesson } from "@learnthrive/data/domain";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { holds } from "@/lib/auth/scope";
import { joinRoleFor } from "@/lib/auth/teaching";
import { getDataProvider } from "@/lib/data/provider";
import { isWithinJoinWindow } from "@/lib/scheduling/joinWindow";

export type LessonEntry = { ok: true; token: string; role: ClassroomJoinTokenPayload["role"] } | { ok: false; message: string };

/**
 * How this person enters this lesson's classroom, if at all. THE one place the rule lives: the lesson page's Join button (lib/actions/classroom.ts),
 * the classroom page itself and the reconnect route (app/api/classroom/token) all ask it, every time, from the signed-in session and the records.
 *
 *   tutor       the lesson's own tutor (an administrator who teaches it is its tutor)
 *   student     a student enrolled in it
 *   supervisor  any other ADMINISTRATOR: they join to supervise. The room lets them straight in without the waiting room, takes no student seat,
 *               starts their microphone and camera off, shows them to everyone as an administrator, and gives them no say over the lesson.
 *
 * It is an online lesson that is not cancelled, and it is inside the join window: a supervisor has the tutor's window (from 30 minutes before the
 * start until 30 minutes after the end).
 */
export function lessonJoinRole(user: AuthenticatedUser, lesson: Pick<Lesson, "tutorId" | "studentIds">): ClassroomJoinTokenPayload["role"] | null {
  const role = joinRoleFor(user, lesson);
  if (role === "TUTOR") return "tutor";
  if (role === "STUDENT") return "student";
  return holds(user, "ADMIN") ? "supervisor" : null;
}

export function lessonEntryFor(user: AuthenticatedUser, lesson: Lesson | null, now: Date = new Date()): LessonEntry {
  if (!lesson) return { ok: false, message: "There is no such lesson." };
  const role = lessonJoinRole(user, lesson);
  if (!role) return { ok: false, message: "You are not assigned to this lesson." };
  if (lesson.locationType !== "ONLINE" || !lesson.classroomRoomId) return { ok: false, message: "This lesson does not have an online classroom." };
  if (lesson.status === "CANCELLED") return { ok: false, message: "This lesson has been cancelled." };
  if (!isWithinJoinWindow(lesson, role === "student" ? "STUDENT" : "TUTOR", now)) return { ok: false, message: "The classroom for this lesson is not open. Come back closer to the start time." };
  return {
    ok: true,
    role,
    token: signClassroomJoinToken({
      roomId: lesson.classroomRoomId,
      lessonId: lesson.id,
      name: user.name,
      role,
      // Who this is on the platform: the classroom sends it with each chat message so apps/web checks the lesson chat rules for the real person.
      uid: user.id,
      // Short-lived: it only has to survive the redirect. The window above is what gates access over time.
      exp: now.getTime() + 5 * 60_000,
    }),
  };
}

/**
 * A fresh classroom join link for someone already in a lesson whose connection dropped (app/api/classroom/token). The same checks as the first join,
 * every time: nothing is remembered, so someone no longer allowed gets nothing.
 */
export async function enterLesson(user: AuthenticatedUser, lessonId: string, now: Date = new Date()): Promise<LessonEntry> {
  return lessonEntryFor(user, await getDataProvider().lessons.get(lessonId), now);
}

/** Writes "an administrator joined to supervise" into the lesson's history, which its tutor sees. Supervision is never hidden. */
export async function recordSupervision(user: AuthenticatedUser, lessonId: string): Promise<void> {
  await getDataProvider().activity.append({ lessonId, type: "SUPERVISED", message: `${user.name} (administrator) joined the classroom to supervise`, actorId: user.id });
}
