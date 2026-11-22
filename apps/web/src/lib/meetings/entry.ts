import type { StaffMeeting } from "@learnthrive/data/meetings";
import { signClassroomJoinToken } from "@learnthrive/shared/classroomToken";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { holds } from "@/lib/auth/scope";
import { decideEntry } from "./rules";
import { getMeetings } from "./runtime";

export type MeetingEntry = { ok: true; meeting: StaffMeeting; role: "HOST" | "INVITEE"; token: string } | { ok: false; message: string };

/**
 * Everything that decides whether this person may be in this meeting NOW (rules.ts), checked again on every entry: a server action and a page are
 * each their own door. The token is short-lived and carries their name and role from here, never from the browser; the host enters the room as
 * its "tutor" (admits the others, can end it for everyone).
 */
export async function enterMeeting(user: AuthenticatedUser, meetingId: string, now: Date = new Date()): Promise<MeetingEntry> {
  const meeting = await getMeetings().get(meetingId);
  const decision = decideEntry(user, meeting, now);
  if (!decision.ok || !meeting) return { ok: false, message: decision.ok ? "There is no such meeting." : decision.message };
  const token = signClassroomJoinToken({
    roomId: meeting.roomId, lessonId: `meeting:${meeting.id}`, name: user.name, role: decision.role === "HOST" ? "tutor" : "student", uid: user.id, kind: "meeting", title: holds(user, "ADMIN") ? "Admin" : "Tutor",
    exp: now.getTime() + 5 * 60_000,
  });
  return { ok: true, meeting, role: decision.role, token };
}
