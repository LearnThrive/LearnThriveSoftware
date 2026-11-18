/**
 * Staff meetings (migration 0028): administrators and tutors meeting in the video room, not tied to a lesson. Staff only, never a child or a
 * parent. The rules in this file are the whole contract: who may be invited, what a meeting must have, and who may join which one. The web app
 * calls them and also re-checks, at the moment of joining, that the person is still staff.
 */

export interface MeetingPerson {
  /** A sign-in's id (AuthenticatedUser.id). */
  id: string;
  /** The name at the time, copied so the record reads the same whatever happens to the profile. */
  name: string;
}

export interface StaffMeeting {
  id: string;
  title: string;
  /** ISO instant. An instant meeting starts "now". */
  startsAt: string;
  durationMinutes: number;
  /** The video room's code. Unguessable (a random uuid); people enter through a signed link the web app issues, and only those in the room see it. */
  roomId: string;
  hostId: string;
  hostName: string;
  invitees: MeetingPerson[];
  createdAt: string;
  cancelledAt: string | null;
}

export interface NewMeeting {
  title: string;
  startsAt: string;
  durationMinutes: number;
  hostId: string;
  hostName: string;
  invitees: MeetingPerson[];
}

export interface MeetingRepository {
  create(input: NewMeeting): Promise<StaffMeeting>;
  get(id: string): Promise<StaffMeeting | null>;
  /** Meetings this person hosts or is invited to that are not cancelled and have not finished by `since` (ISO), soonest first. */
  forPerson(personId: string, since: string): Promise<StaffMeeting[]>;
  /** False if there is no such meeting or it was already cancelled. Kept, marked, never deleted. */
  cancel(id: string, actor: string): Promise<boolean>;
}

export class MeetingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingError";
  }
}

export const MEETING_LIMITS = { titleMin: 2, titleMax: 100, minutesMin: 5, minutesMax: 480, inviteesMax: 9, nameMax: 80 } as const;

/**
 * The cleaned meeting, or a MeetingError saying what to fix. The host is never also an invitee, a person is invited once, and a meeting must have
 * someone to meet. At most nine others: the room holds ten with the video server, and four without it (the room says so when it is full).
 */
export function validateMeeting(input: NewMeeting): NewMeeting {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (title.length < MEETING_LIMITS.titleMin || title.length > MEETING_LIMITS.titleMax) {
    throw new MeetingError(`Give the meeting a title of ${MEETING_LIMITS.titleMin} to ${MEETING_LIMITS.titleMax} characters.`);
  }
  if (!Number.isFinite(Date.parse(input.startsAt))) throw new MeetingError("Choose a start date and time.");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < MEETING_LIMITS.minutesMin || input.durationMinutes > MEETING_LIMITS.minutesMax) {
    throw new MeetingError(`A meeting lasts ${MEETING_LIMITS.minutesMin} minutes to ${MEETING_LIMITS.minutesMax / 60} hours.`);
  }
  const seen = new Set<string>([input.hostId]);
  const invitees: MeetingPerson[] = [];
  for (const person of input.invitees) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    invitees.push({ id: person.id, name: person.name.trim().slice(0, MEETING_LIMITS.nameMax) || "Colleague" });
  }
  if (invitees.length === 0) throw new MeetingError("Invite at least one person.");
  if (invitees.length > MEETING_LIMITS.inviteesMax) throw new MeetingError(`A meeting can have up to ${MEETING_LIMITS.inviteesMax} other people.`);
  return { title, startsAt: new Date(input.startsAt).toISOString(), durationMinutes: input.durationMinutes, hostId: input.hostId, hostName: input.hostName.trim().slice(0, MEETING_LIMITS.nameMax) || "Host", invitees };
}

/** How this person may enter this meeting: its host, an invitee, or not at all. A cancelled meeting admits nobody. */
export function meetingRoleFor(meeting: Pick<StaffMeeting, "hostId" | "invitees" | "cancelledAt">, personId: string): "HOST" | "INVITEE" | null {
  if (meeting.cancelledAt) return null;
  if (meeting.hostId === personId) return "HOST";
  return meeting.invitees.some((p) => p.id === personId) ? "INVITEE" : null;
}
