import { randomUUID } from "node:crypto";
import { validateMeeting, type MeetingRepository, type StaffMeeting } from "./types";

const copy = (m: StaffMeeting): StaffMeeting => ({ ...m, invitees: m.invitees.map((p) => ({ ...p })) });
const endsAt = (m: StaffMeeting) => Date.parse(m.startsAt) + m.durationMinutes * 60_000;

/** The development and test implementation, held to the same tests as the Postgres one (meetings.test.ts). */
export function createMemoryMeetings(): MeetingRepository {
  const meetings = new Map<string, StaffMeeting>();
  return {
    async create(input) {
      const clean = validateMeeting(input);
      const meeting: StaffMeeting = { id: randomUUID(), ...clean, roomId: randomUUID(), createdAt: new Date().toISOString(), cancelledAt: null };
      meetings.set(meeting.id, meeting);
      return copy(meeting);
    },
    async get(id) {
      const m = meetings.get(id);
      return m ? copy(m) : null;
    },
    async forPerson(personId, since) {
      const from = Date.parse(since);
      return [...meetings.values()]
        .filter((m) => !m.cancelledAt && endsAt(m) >= from && (m.hostId === personId || m.invitees.some((p) => p.id === personId)))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map(copy);
    },
    async cancel(id) {
      const m = meetings.get(id);
      if (!m || m.cancelledAt) return false;
      m.cancelledAt = new Date().toISOString();
      return true;
    },
  };
}

// One development instance for the life of the dev server, like the other in-memory stores (globalThis survives Fast Refresh).
const g = globalThis as unknown as { __learnthriveMeetings?: MeetingRepository };
export function developmentMeetings(): MeetingRepository {
  return (g.__learnthriveMeetings ??= createMemoryMeetings());
}
