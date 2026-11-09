import type { SqlExecutor } from "../library/ports";
import { newConcernReference } from "./memory";
import type { SafeguardingRepository } from "./repository";
import { SafeguardingError, validateConcern, validateVettingCheck, type Concern, type ConcernEvent, type VettingCheck } from "./types";

/**
 * The Postgres implementation (migration 0022). Server only: the site's database role reads and writes these tables and no API role has
 * any grant on them. An id that is not a uuid answers "not found" rather than a database error.
 */
type Row = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: string | undefined | null): v is string => typeof v === "string" && UUID.test(v);
const iso = (v: unknown): string => new Date(v as string | number | Date).toISOString();
const ymd = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : new Date(v as Date).toISOString().slice(0, 10));

const toCheck = (r: Row): VettingCheck => ({
  id: r.id, tutorId: r.tutor_id, kind: r.kind, checkedOn: ymd(r.checked_on), expiresOn: r.expires_on ? ymd(r.expires_on) : null, how: r.how, note: r.note,
  recordedBy: r.recorded_by ?? "", recordedAt: iso(r.recorded_at),
});
const toConcern = (r: Row): Concern => ({
  id: r.id, reference: r.reference, raisedBy: r.raised_by, raisedByRole: r.raised_by_role, raisedAt: iso(r.raised_at), category: r.category, about: r.about,
  studentRef: r.student_ref ?? null, lessonRef: r.lesson_ref ?? null, details: r.details, immediateDanger: r.immediate_danger, status: r.status,
});
const toEvent = (r: Row): ConcernEvent => ({ id: r.id, concernId: r.concern_id, at: iso(r.at), actorId: r.actor_id, kind: r.kind, note: r.note });

export function createSqlSafeguarding(db: SqlExecutor): SafeguardingRepository {
  const q = <T = Row>(text: string, params?: unknown[]) => db.query<T>(text, params);

  return {
    vetting: {
      async list(tutorId) {
        if (tutorId !== undefined && !isId(tutorId)) return [];
        const rows = tutorId === undefined
          ? await q("select * from public.tutor_vetting_checks where voided_at is null order by tutor_id, checked_on desc, recorded_at desc")
          : await q("select * from public.tutor_vetting_checks where voided_at is null and tutor_id = $1 order by checked_on desc, recorded_at desc", [tutorId]);
        return rows.map(toCheck);
      },
      async record(input, today) {
        const clean = validateVettingCheck(input, today);
        if (!isId(clean.tutorId)) throw new SafeguardingError("NOT_FOUND", "That tutor does not exist.");
        const tutor = await q("select 1 from public.tutors where id = $1", [clean.tutorId]);
        if (!tutor[0]) throw new SafeguardingError("NOT_FOUND", "That tutor does not exist.");
        const rows = await q(
          `insert into public.tutor_vetting_checks (tutor_id, kind, checked_on, expires_on, how, note, recorded_by)
           values ($1, $2, $3::date, $4::date, $5, $6, $7) returning *`,
          [clean.tutorId, clean.kind, clean.checkedOn, clean.expiresOn, clean.how, clean.note, isId(clean.recordedBy) ? clean.recordedBy : null],
        );
        return toCheck(rows[0]!);
      },
      async void(id, reason, actor) {
        if (reason.trim().length < 3) throw new SafeguardingError("INVALID", "Say why this check is being removed.");
        const rows = isId(id)
          ? await q("update public.tutor_vetting_checks set voided_at = now(), voided_by = $2, void_reason = $3 where id = $1 and voided_at is null returning id", [id, isId(actor) ? actor : null, reason.trim()])
          : [];
        if (!rows[0]) throw new SafeguardingError("NOT_FOUND", "That check does not exist.");
      },
    },
    concerns: {
      async create(input) {
        const clean = validateConcern(input);
        const rows = await q(
          `insert into public.safeguarding_concerns (reference, raised_by, raised_by_role, category, about, student_ref, lesson_ref, details, immediate_danger)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
          [newConcernReference(), clean.raisedBy, clean.raisedByRole, clean.category, clean.about, clean.studentRef, clean.lessonRef, clean.details, clean.immediateDanger],
        );
        return toConcern(rows[0]!);
      },
      async get(id) {
        const rows = isId(id) ? await q("select * from public.safeguarding_concerns where id = $1", [id]) : [];
        return rows[0] ? toConcern(rows[0]) : null;
      },
      async list() {
        return (await q("select * from public.safeguarding_concerns order by raised_at desc, id")).map(toConcern);
      },
      async raisedBy(actorId) {
        return (await q("select * from public.safeguarding_concerns where raised_by = $1 order by raised_at desc, id", [actorId])).map(toConcern);
      },
      async setStatus(id, status) {
        const rows = isId(id) ? await q("update public.safeguarding_concerns set status = $2 where id = $1 returning *", [id, status]) : [];
        if (!rows[0]) throw new SafeguardingError("NOT_FOUND", "That concern does not exist.");
        return toConcern(rows[0]);
      },
      async appendEvent(event) {
        if (!isId(event.concernId)) throw new SafeguardingError("NOT_FOUND", "That concern does not exist.");
        const rows = await q(
          `insert into public.safeguarding_concern_events (concern_id, at, actor_id, kind, note)
           select c.id, clock_timestamp(), $2, $3, $4 from public.safeguarding_concerns c where c.id = $1 returning *`,
          [event.concernId, event.actorId, event.kind, (event.note ?? "").slice(0, 2000)],
        );
        if (!rows[0]) throw new SafeguardingError("NOT_FOUND", "That concern does not exist.");
        return toEvent(rows[0]);
      },
      async events(concernId) {
        return isId(concernId) ? (await q("select * from public.safeguarding_concern_events where concern_id = $1 order by at, id", [concernId])).map(toEvent) : [];
      },
    },
  };
}
