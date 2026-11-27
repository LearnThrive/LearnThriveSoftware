import { meetingRoleFor, type StaffMeeting } from "@learnthrive/data/meetings";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { holds } from "@/lib/auth/scope";
import { teaches } from "@/lib/auth/teaching";
import { isWithinJoinWindow } from "@/lib/scheduling/joinWindow";

/**
 * Staff: an administrator, or someone who teaches, who is not also a learner. A meeting is never open to a parent or a learner, whatever they were
 * somehow invited as. Anyone holding the Student role is left out even if they also teach (a junior tutor is often a student): a learner may be
 * under 18, and a staff meeting is for adults. The administrator can lift this by removing the Student role.
 */
export const isStaff = (user: AuthenticatedUser): boolean => (holds(user, "ADMIN") || teaches(user)) && !holds(user, "STUDENT");

/** The same window as a lesson: the host 30 minutes early, everyone else 10, and both until 30 minutes after it should have ended. */
export const meetingOpenFor = (meeting: StaffMeeting, role: "HOST" | "INVITEE", now: Date = new Date()): boolean =>
  isWithinJoinWindow({ startAt: meeting.startsAt, durationMinutes: meeting.durationMinutes }, role === "HOST" ? "TUTOR" : "GUEST", now);

export type EntryDecision = { ok: true; role: "HOST" | "INVITEE" } | { ok: false; message: string };

/** Whether this person may be in this meeting at this moment, and as what. Pure: the one place the rules live (lib/meetings/entry.ts calls it). */
export function decideEntry(user: AuthenticatedUser, meeting: StaffMeeting | null, now: Date): EntryDecision {
  if (!isStaff(user)) return { ok: false, message: "Meetings are for administrators and tutors." };
  if (!meeting) return { ok: false, message: "There is no such meeting." };
  if (meeting.cancelledAt) return { ok: false, message: "This meeting was cancelled." };
  const role = meetingRoleFor(meeting, user.id);
  if (!role) return { ok: false, message: "You are not invited to this meeting." };
  if (!meetingOpenFor(meeting, role, now)) return { ok: false, message: "This meeting is not open yet. Come back closer to the start time." };
  return { ok: true, role };
}
