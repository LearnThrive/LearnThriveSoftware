import { randomUUID } from "node:crypto";
import type { SqlExecutor } from "../library/ports";
import { validateMeeting, type MeetingPerson, type MeetingRepository, type StaffMeeting } from "./types";

/** The Postgres implementation (migration 0028). Server only: no API role has any grant on these tables. An id that is not a uuid is "not found". */
type Row = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string => new Date(v as string | number | Date).toISOString();

const toMeeting = (r: Row, invitees: MeetingPerson[]): StaffMeeting => ({
  id: r.id, title: r.title, startsAt: iso(r.starts_at), durationMinutes: r.duration_minutes, roomId: r.room_id, hostId: r.host_id, hostName: r.host_name,
  invitees, createdAt: iso(r.created_at), cancelledAt: r.cancelled_at ? iso(r.cancelled_at) : null,
});

export function createSqlMeetings(db: SqlExecutor): MeetingRepository {
  const q = <T = Row>(text: string, params?: unknown[]) => db.query<T>(text, params);

  /** Rows for these meetings, each with its invitees (names in the order they were invited is not kept: by name). */
  async function withInvitees(rows: Row[]): Promise<StaffMeeting[]> {
    if (rows.length === 0) return [];
    const people = await q("select meeting_id, person_id, person_name from public.staff_meeting_invitees where meeting_id = any($1::uuid[]) order by person_name, person_id", [rows.map((r) => r.id)]);
    return rows.map((r) => toMeeting(r, people.filter((p) => p.meeting_id === r.id).map((p) => ({ id: p.person_id, name: p.person_name }))));
  }

  return {
    async create(input) {
      const clean = validateMeeting(input);
      const [row] = await q(
        "insert into public.staff_meetings (title, starts_at, duration_minutes, room_id, host_id, host_name) values ($1, $2, $3, $4, $5, $6) returning *",
        [clean.title, clean.startsAt, clean.durationMinutes, randomUUID(), clean.hostId, clean.hostName],
      );
      for (const person of clean.invitees) {
        await q("insert into public.staff_meeting_invitees (meeting_id, person_id, person_name) values ($1, $2, $3)", [row!.id, person.id, person.name]);
      }
      return (await withInvitees([row!]))[0]!;
    },
    async get(id) {
      if (!UUID.test(id)) return null;
      return (await withInvitees(await q("select * from public.staff_meetings where id = $1", [id])))[0] ?? null;
    },
    async forPerson(personId, since) {
      const rows = await q(
        `select m.* from public.staff_meetings m
          where m.cancelled_at is null and m.starts_at + make_interval(mins => m.duration_minutes) >= $2
            and (m.host_id = $1 or exists (select 1 from public.staff_meeting_invitees i where i.meeting_id = m.id and i.person_id = $1))
          order by m.starts_at, m.id`,
        [personId, since],
      );
      return withInvitees(rows);
    },
    async cancel(id, actor) {
      if (!UUID.test(id)) return false;
      return (await q("update public.staff_meetings set cancelled_at = now(), cancelled_by = $2 where id = $1 and cancelled_at is null returning id", [id, actor.slice(0, 100)])).length === 1;
    },
  };
}
