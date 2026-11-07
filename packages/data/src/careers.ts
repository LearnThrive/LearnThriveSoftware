import type { SqlExecutor } from "./library/ports";

/**
 * Tutor applications, stored and reviewed (launch checklist 3.12, migration 0020). Applicants are not account holders: they give a contact
 * email, and only administrators read what they sent.
 *
 * Two implementations of one interface, held to one contract (testing/careersContract.ts): memory (development and tests) and Postgres
 * (production, through the site's narrow server role). The files themselves are NOT here: the site stores the bytes in the private
 * `careers` bucket and this store keeps the rows that describe them. Deleting an application is therefore two steps that the caller
 * orders: the stored objects first (a file whose row is gone can never be found again), then `remove`.
 *
 * Nothing in the deletion log can identify the person: date, administrator, reason and a file count (the rule of data_purges, 3.7.5).
 */

export const APPLICATION_STATUSES = ["NEW", "REVIEWING", "INTERVIEW", "ACCEPTED", "REJECTED", "WITHDRAWN"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
/** The statuses that are a decision. The retention clock starts when one of these is set. */
export const DECIDED_STATUSES: readonly ApplicationStatus[] = ["ACCEPTED", "REJECTED", "WITHDRAWN"];

export type ApplicationFileKind = "CV" | "COVER_LETTER" | "SUPPORTING";
export type DbsSeenHow = "CERTIFICATE" | "UPDATE_SERVICE";
export type CareersDeletionReason = "RETENTION" | "REQUEST" | "WITHDRAWN" | "OTHER";
export type ApplicationEventKind = "RECEIVED" | "STATUS" | "FILE_VIEWED" | "IDENTITY_SEEN" | "DBS_SEEN" | "IDENTITY_FILES_DELETED";

/**
 * The periods in docs/RETENTION_AND_DELETION.md, counted from the decision. Held here so the date written on the row and the screen that
 * shows it cannot disagree; apps/web's careersConfig quotes the same numbers to the public, and a test holds the two together.
 */
export const CAREERS_RETENTION = {
  /** An unsuccessful (rejected or withdrawn) application. */
  unsuccessfulMonths: 6,
  /** The same, when the applicant asked to be kept for future roles. */
  talentPoolMonths: 12,
  /** Identity and right-to-work documents of an unsuccessful applicant, whatever they ticked. */
  identityMonths: 6,
} as const;

export const NOTE_MAX = 4000;

export interface NewApplicationFile {
  id: string;
  kind: ApplicationFileKind;
  label: string;
  documentType: string | null;
  sensitive: boolean;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string;
}

export interface NewApplication {
  /** Chosen by the caller, because the stored files are named after it before the row exists. */
  id: string;
  reference: string;
  roleSlug: string;
  firstName: string;
  lastName: string;
  email: string;
  talentPool: boolean;
  answers: Record<string, unknown>;
  agreement: Record<string, unknown>;
  files: NewApplicationFile[];
}

export interface ApplicationSummary {
  id: string;
  reference: string;
  roleSlug: string;
  firstName: string;
  lastName: string;
  email: string;
  status: ApplicationStatus;
  talentPool: boolean;
  receivedAt: string;
  updatedAt: string;
  decidedAt: string | null;
  /** When the whole application is due for deletion, or null (no decision yet, or accepted). */
  deleteAfter: string | null;
  /** When its identity documents are due for deletion, or null. */
  identityDeleteAfter: string | null;
  fileCount: number;
  /** Identity or right-to-work files still held. */
  sensitiveFileCount: number;
}

export interface ApplicationFile extends NewApplicationFile {
  applicationId: string;
  createdAt: string;
}

export interface ApplicationNote {
  id: string;
  authorId: string | null;
  body: string;
  at: string;
}

export interface ApplicationEvent {
  id: string;
  kind: ApplicationEventKind;
  actorId: string | null;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus | null;
  fileId: string | null;
  detail: string | null;
  at: string;
}

export interface ApplicationDetail extends ApplicationSummary {
  answers: Record<string, unknown>;
  agreement: Record<string, unknown>;
  files: ApplicationFile[];
  notes: ApplicationNote[];
  /** Oldest first. */
  events: ApplicationEvent[];
  identitySeen: { on: string; by: string | null } | null;
  dbsSeen: { on: string; how: DbsSeenHow; by: string | null } | null;
}

export interface CareersDeletion {
  id: string;
  at: string;
  actorId: string | null;
  reason: CareersDeletionReason;
  files: number;
}

export interface CareersDue {
  /** Applications whose whole record is due for deletion by the date asked about. */
  applications: ApplicationSummary[];
  /** Applications still holding identity documents that are due for deletion by then. */
  identityDocuments: ApplicationSummary[];
}

export interface CareersStore {
  /** Stores an application and its file rows, with a RECEIVED event, all or nothing. */
  create(input: NewApplication): Promise<ApplicationSummary>;
  /** Newest first. */
  list(filter?: { status?: ApplicationStatus }): Promise<ApplicationSummary[]>;
  get(id: string): Promise<ApplicationDetail | null>;
  /**
   * Moves the application to a status, records who did it, and sets or clears the decision date and the retention dates that follow from
   * it. Setting the status it already has changes nothing and records nothing. null when there is no such application.
   */
  setStatus(id: string, status: ApplicationStatus, actor: string, now?: Date): Promise<ApplicationSummary | null>;
  addNote(id: string, body: string, actor: string): Promise<ApplicationNote | null>;
  /** Records that identity (and right to work) was seen, on a date, by this administrator. Never a copy. */
  recordIdentitySeen(id: string, on: string, actor: string): Promise<boolean>;
  /** Records that the DBS certificate or Update Service result was seen, how and on what date. Never the certificate or its number. */
  recordDbsSeen(id: string, seen: { on: string; how: DbsSeenHow }, actor: string): Promise<boolean>;
  /** A file of this application, or null. Both ids are checked, so one application's id cannot reach another's file. */
  file(applicationId: string, fileId: string): Promise<ApplicationFile | null>;
  /** Records that an administrator opened a file. */
  logFileView(applicationId: string, fileId: string, actor: string): Promise<void>;
  /**
   * Deletes the rows of this application's identity and right-to-work files (the caller has already deleted the stored objects) and
   * records it. Returns how many were removed.
   */
  removeIdentityFiles(applicationId: string, actor: string): Promise<number>;
  /** Deletes the application and everything under it, and writes the log row. null when there was nothing to delete. */
  remove(id: string, actor: string, reason: CareersDeletionReason): Promise<CareersDeletion | null>;
  /** What is due for deletion on or before `when`. */
  dueBy(when: Date): Promise<CareersDue>;
  /** Newest first. Safe to show: no one in it can be identified. */
  deletions(limit: number): Promise<CareersDeletion[]>;
}

// ── Rules shared by both implementations ─────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (value: string) => DATE_ONLY.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === "string" && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/** Adds calendar months in UTC; the 31st of a short month lands on its last day rather than spilling into the next. */
export function addMonths(from: Date, months: number): Date {
  const out = new Date(from.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/**
 * The retention dates a status gives (docs/RETENTION_AND_DELETION.md):
 *   rejected or withdrawn   the application at 6 months (12 if kept for future roles); identity documents at 6 months either way
 *   accepted                none here: the person becomes a tutor, and their documents follow the tutor rules from when they stop
 *   still open              none: the clock starts at the decision
 */
export function retentionFor(status: ApplicationStatus, decidedAt: Date | null, talentPool: boolean): { deleteAfter: string | null; identityDeleteAfter: string | null } {
  if (!decidedAt || (status !== "REJECTED" && status !== "WITHDRAWN")) return { deleteAfter: null, identityDeleteAfter: null };
  return {
    deleteAfter: addMonths(decidedAt, talentPool ? CAREERS_RETENTION.talentPoolMonths : CAREERS_RETENTION.unsuccessfulMonths).toISOString(),
    identityDeleteAfter: addMonths(decidedAt, CAREERS_RETENTION.identityMonths).toISOString(),
  };
}

function checkNew(input: NewApplication): void {
  if (!isUuid(input.id)) throw new Error("An application id must be a uuid.");
  for (const file of input.files) {
    if (!isUuid(file.id)) throw new Error("A file id must be a uuid.");
    if (!file.storagePath.startsWith(`${input.id}/${file.id}.`)) throw new Error("A stored file must live under its application.");
  }
}

const cleanNote = (body: string) => body.trim().slice(0, NOTE_MAX);

// ── Memory ───────────────────────────────────────────────────────────────────────────────────────────

interface MemoryApplication {
  summary: Omit<ApplicationSummary, "fileCount" | "sensitiveFileCount">;
  answers: Record<string, unknown>;
  agreement: Record<string, unknown>;
  files: ApplicationFile[];
  notes: ApplicationNote[];
  events: ApplicationEvent[];
  identitySeen: ApplicationDetail["identitySeen"];
  dbsSeen: ApplicationDetail["dbsSeen"];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class MemoryCareersStore implements CareersStore {
  private readonly applications = new Map<string, MemoryApplication>();
  private readonly log: CareersDeletion[] = [];
  private sequence = 0;

  private nextEventId = () => String((this.sequence += 1));

  private summarise(app: MemoryApplication): ApplicationSummary {
    return { ...app.summary, fileCount: app.files.length, sensitiveFileCount: app.files.filter((f) => f.sensitive).length };
  }

  private event(app: MemoryApplication, kind: ApplicationEventKind, actor: string | null, extra: Partial<ApplicationEvent> = {}): void {
    app.events.push({ id: this.nextEventId(), kind, actorId: actor, fromStatus: null, toStatus: null, fileId: null, detail: null, at: new Date().toISOString(), ...extra });
  }

  async create(input: NewApplication): Promise<ApplicationSummary> {
    checkNew(input);
    if (this.applications.has(input.id) || [...this.applications.values()].some((a) => a.summary.reference === input.reference)) {
      throw new Error("That application already exists.");
    }
    const now = new Date().toISOString();
    const app: MemoryApplication = {
      summary: {
        id: input.id, reference: input.reference, roleSlug: input.roleSlug, firstName: input.firstName, lastName: input.lastName, email: input.email,
        status: "NEW", talentPool: input.talentPool, receivedAt: now, updatedAt: now, decidedAt: null, deleteAfter: null, identityDeleteAfter: null,
      },
      answers: clone(input.answers),
      agreement: clone(input.agreement),
      files: input.files.map((f) => ({ ...f, applicationId: input.id, createdAt: now })),
      notes: [],
      events: [],
      identitySeen: null,
      dbsSeen: null,
    };
    this.event(app, "RECEIVED", null);
    this.applications.set(input.id, app);
    return this.summarise(app);
  }

  async list(filter: { status?: ApplicationStatus } = {}): Promise<ApplicationSummary[]> {
    return [...this.applications.values()]
      .filter((a) => !filter.status || a.summary.status === filter.status)
      .map((a) => this.summarise(a))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id));
  }

  async get(id: string): Promise<ApplicationDetail | null> {
    const app = isUuid(id) ? this.applications.get(id) : undefined;
    if (!app) return null;
    return clone({ ...this.summarise(app), answers: app.answers, agreement: app.agreement, files: app.files, notes: app.notes, events: app.events, identitySeen: app.identitySeen, dbsSeen: app.dbsSeen });
  }

  async setStatus(id: string, status: ApplicationStatus, actor: string, now = new Date()): Promise<ApplicationSummary | null> {
    const app = isUuid(id) ? this.applications.get(id) : undefined;
    if (!app || !isApplicationStatus(status)) return null;
    const from = app.summary.status;
    if (from === status) return this.summarise(app);
    const decided = DECIDED_STATUSES.includes(status) ? now : null;
    const dates = retentionFor(status, decided, app.summary.talentPool);
    app.summary = { ...app.summary, status, decidedAt: decided ? decided.toISOString() : null, ...dates, updatedAt: new Date().toISOString() };
    this.event(app, "STATUS", actor, { fromStatus: from, toStatus: status });
    return this.summarise(app);
  }

  async addNote(id: string, body: string, actor: string): Promise<ApplicationNote | null> {
    const app = isUuid(id) ? this.applications.get(id) : undefined;
    const text = cleanNote(body);
    if (!app || !text) return null;
    const note: ApplicationNote = { id: globalThis.crypto.randomUUID(), authorId: actor, body: text, at: new Date().toISOString() };
    app.notes.push(note);
    return clone(note);
  }

  async recordIdentitySeen(id: string, on: string, actor: string): Promise<boolean> {
    const app = isUuid(id) ? this.applications.get(id) : undefined;
    if (!app || !isDateOnly(on)) return false;
    app.identitySeen = { on, by: actor };
    this.event(app, "IDENTITY_SEEN", actor, { detail: on });
    return true;
  }

  async recordDbsSeen(id: string, seen: { on: string; how: DbsSeenHow }, actor: string): Promise<boolean> {
    const app = isUuid(id) ? this.applications.get(id) : undefined;
    if (!app || !isDateOnly(seen.on) || (seen.how !== "CERTIFICATE" && seen.how !== "UPDATE_SERVICE")) return false;
    app.dbsSeen = { on: seen.on, how: seen.how, by: actor };
    this.event(app, "DBS_SEEN", actor, { detail: `${seen.how} ${seen.on}` });
    return true;
  }

  async file(applicationId: string, fileId: string): Promise<ApplicationFile | null> {
    const app = isUuid(applicationId) ? this.applications.get(applicationId) : undefined;
    const file = app?.files.find((f) => f.id === fileId);
    return file ? clone(file) : null;
  }

  async logFileView(applicationId: string, fileId: string, actor: string): Promise<void> {
    const app = isUuid(applicationId) ? this.applications.get(applicationId) : undefined;
    const file = app?.files.find((f) => f.id === fileId);
    if (app && file) this.event(app, "FILE_VIEWED", actor, { fileId, detail: file.label });
  }

  async removeIdentityFiles(applicationId: string, actor: string): Promise<number> {
    const app = isUuid(applicationId) ? this.applications.get(applicationId) : undefined;
    if (!app) return 0;
    const removed = app.files.filter((f) => f.sensitive);
    if (removed.length === 0) return 0;
    const gone = new Set(removed.map((f) => f.id));
    app.files = app.files.filter((f) => !f.sensitive);
    for (const event of app.events) if (event.fileId && gone.has(event.fileId)) event.fileId = null;
    this.event(app, "IDENTITY_FILES_DELETED", actor, { detail: String(removed.length) });
    return removed.length;
  }

  async remove(id: string, actor: string, reason: CareersDeletionReason): Promise<CareersDeletion | null> {
    const app = isUuid(id) ? this.applications.get(id) : undefined;
    if (!app) return null;
    this.applications.delete(id);
    const entry: CareersDeletion = { id: globalThis.crypto.randomUUID(), at: new Date().toISOString(), actorId: actor, reason, files: app.files.length };
    this.log.push(entry);
    return { ...entry };
  }

  async dueBy(when: Date): Promise<CareersDue> {
    const cut = when.toISOString();
    const all = await this.list();
    return {
      applications: all.filter((a) => a.deleteAfter !== null && a.deleteAfter <= cut).sort((a, b) => a.deleteAfter!.localeCompare(b.deleteAfter!)),
      identityDocuments: all
        .filter((a) => a.identityDeleteAfter !== null && a.identityDeleteAfter <= cut && a.sensitiveFileCount > 0)
        .sort((a, b) => a.identityDeleteAfter!.localeCompare(b.identityDeleteAfter!)),
    };
  }

  async deletions(limit: number): Promise<CareersDeletion[]> {
    return [...this.log].reverse().slice(0, Math.max(0, Math.trunc(limit))).map((d) => ({ ...d }));
  }
}

// ── Postgres ─────────────────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const iso = (value: unknown): string => new Date(value as string | number | Date).toISOString();
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));
const dateOnly = (value: unknown): string => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const actorId = (actor: string): string | null => (isUuid(actor) ? actor : null);
const asObject = (value: unknown): Record<string, unknown> => {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};

const SUMMARY_SELECT = `select a.id, a.reference, a.role_slug, a.first_name, a.last_name, a.email, a.status, a.talent_pool, a.received_at, a.updated_at,
    a.decided_at, a.delete_after, a.identity_delete_after,
    (select count(*) from public.careers_application_files f where f.application_id = a.id)::int as file_count,
    (select count(*) from public.careers_application_files f where f.application_id = a.id and f.sensitive)::int as sensitive_file_count
  from public.careers_applications a`;

const toSummary = (r: Row): ApplicationSummary => ({
  id: r.id, reference: r.reference, roleSlug: r.role_slug, firstName: r.first_name, lastName: r.last_name, email: r.email, status: r.status, talentPool: r.talent_pool,
  receivedAt: iso(r.received_at), updatedAt: iso(r.updated_at), decidedAt: isoOrNull(r.decided_at), deleteAfter: isoOrNull(r.delete_after),
  identityDeleteAfter: isoOrNull(r.identity_delete_after), fileCount: Number(r.file_count), sensitiveFileCount: Number(r.sensitive_file_count),
});

const toFile = (r: Row): ApplicationFile => ({
  id: r.id, applicationId: r.application_id, kind: r.kind, label: r.label, documentType: r.document_type ?? null, sensitive: r.sensitive, filename: r.filename,
  contentType: r.content_type, sizeBytes: Number(r.size_bytes), storagePath: r.storage_path, createdAt: iso(r.created_at),
});

const toDeletion = (r: Row): CareersDeletion => ({ id: r.id, at: iso(r.at), actorId: r.actor_profile_id ?? null, reason: r.reason, files: Number(r.files) });

export function createSqlCareersStore(db: SqlExecutor): CareersStore {
  const summary = async (id: string) => {
    const rows = await db.query<Row>(`${SUMMARY_SELECT} where a.id = $1`, [id]);
    return rows[0] ? toSummary(rows[0]) : null;
  };

  return {
    async create(input) {
      checkNew(input);
      // One statement, so the application, its files and the RECEIVED event go in together or not at all. JSON goes in as text and is cast
      // here (`$n::text::jsonb`): the postgres driver JSON-encodes a parameter it sees typed as jsonb, which would store a string (library/sql.ts).
      await db.query(
        `with app as (
           insert into public.careers_applications (id, reference, role_slug, first_name, last_name, email, talent_pool, answers, agreement)
           values ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9::text::jsonb) returning id),
         files as (
           insert into public.careers_application_files (id, application_id, position, kind, label, document_type, sensitive, filename, content_type, size_bytes, storage_path)
           select (f->>'id')::uuid, app.id, (n - 1)::int, f->>'kind', f->>'label', nullif(f->>'documentType', ''), (f->>'sensitive')::boolean, f->>'filename', f->>'contentType',
                  (f->>'sizeBytes')::int, f->>'storagePath'
             from app, jsonb_array_elements($10::text::jsonb) with ordinality as e(f, n) returning 1)
         insert into public.careers_application_events (application_id, kind) select id, 'RECEIVED' from app`,
        [
          input.id, input.reference, input.roleSlug, input.firstName, input.lastName, input.email, input.talentPool,
          JSON.stringify(input.answers), JSON.stringify(input.agreement), JSON.stringify(input.files),
        ],
      );
      const created = await summary(input.id);
      if (!created) throw new Error("The application was not stored.");
      return created;
    },

    async list(filter = {}) {
      const rows = filter.status && isApplicationStatus(filter.status)
        ? await db.query<Row>(`${SUMMARY_SELECT} where a.status = $1 order by a.received_at desc, a.id desc`, [filter.status])
        : await db.query<Row>(`${SUMMARY_SELECT} order by a.received_at desc, a.id desc`);
      return rows.map(toSummary);
    },

    async get(id) {
      if (!isUuid(id)) return null;
      const rows = await db.query<Row>(
        `${SUMMARY_SELECT.replace("from public.careers_applications a", ", a.answers, a.agreement, a.identity_seen_on, a.identity_seen_by, a.dbs_seen_on, a.dbs_seen_how, a.dbs_seen_by from public.careers_applications a")} where a.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      const [files, notes, events] = await Promise.all([
        db.query<Row>(`select * from public.careers_application_files where application_id = $1 order by position, id`, [id]),
        db.query<Row>(`select * from public.careers_application_notes where application_id = $1 order by at, id`, [id]),
        db.query<Row>(`select * from public.careers_application_events where application_id = $1 order by at, id`, [id]),
      ]);
      return {
        ...toSummary(r),
        answers: asObject(r.answers),
        agreement: asObject(r.agreement),
        files: files.map(toFile),
        notes: notes.map((n) => ({ id: n.id, authorId: n.author_profile_id ?? null, body: n.body, at: iso(n.at) })),
        events: events.map((e) => ({
          id: String(e.id), kind: e.kind, actorId: e.actor_profile_id ?? null, fromStatus: e.from_status ?? null, toStatus: e.to_status ?? null, fileId: e.file_id ?? null,
          detail: e.detail ?? null, at: iso(e.at),
        })),
        identitySeen: r.identity_seen_on ? { on: dateOnly(r.identity_seen_on), by: r.identity_seen_by ?? null } : null,
        dbsSeen: r.dbs_seen_on ? { on: dateOnly(r.dbs_seen_on), how: r.dbs_seen_how, by: r.dbs_seen_by ?? null } : null,
      };
    },

    async setStatus(id, status, actor, now = new Date()) {
      if (!isUuid(id) || !isApplicationStatus(status)) return null;
      const current = await db.query<Row>(`select status, talent_pool from public.careers_applications where id = $1`, [id]);
      if (!current[0]) return null;
      if (current[0].status === status) return summary(id);
      const decided = DECIDED_STATUSES.includes(status) ? now : null;
      const dates = retentionFor(status, decided, current[0].talent_pool);
      // `status = $6` guards a race: if someone else moved it first, nothing is written and the history stays true.
      await db.query(
        `with upd as (
           update public.careers_applications set status = $2, decided_at = $3, delete_after = $4, identity_delete_after = $5, updated_at = now()
            where id = $1 and status = $6 returning id)
         insert into public.careers_application_events (application_id, kind, actor_profile_id, from_status, to_status)
         select id, 'STATUS', $7, $6, $2 from upd`,
        [id, status, decided ? decided.toISOString() : null, dates.deleteAfter, dates.identityDeleteAfter, current[0].status, actorId(actor)],
      );
      return summary(id);
    },

    async addNote(id, body, actor) {
      const text = cleanNote(body);
      if (!isUuid(id) || !text) return null;
      const rows = await db.query<Row>(
        `insert into public.careers_application_notes (application_id, author_profile_id, body)
         select id, $2, $3 from public.careers_applications where id = $1 returning *`,
        [id, actorId(actor), text],
      );
      return rows[0] ? { id: rows[0].id, authorId: rows[0].author_profile_id ?? null, body: rows[0].body, at: iso(rows[0].at) } : null;
    },

    async recordIdentitySeen(id, on, actor) {
      if (!isUuid(id) || !isDateOnly(on)) return false;
      const rows = await db.query<Row>(
        `with upd as (update public.careers_applications set identity_seen_on = $2::date, identity_seen_by = $3, updated_at = now() where id = $1 returning id)
         insert into public.careers_application_events (application_id, kind, actor_profile_id, detail) select id, 'IDENTITY_SEEN', $3, $2::text from upd returning 1`,
        [id, on, actorId(actor)],
      );
      return rows.length > 0;
    },

    async recordDbsSeen(id, seen, actor) {
      if (!isUuid(id) || !isDateOnly(seen.on) || (seen.how !== "CERTIFICATE" && seen.how !== "UPDATE_SERVICE")) return false;
      const rows = await db.query<Row>(
        `with upd as (update public.careers_applications set dbs_seen_on = $2::date, dbs_seen_how = $3, dbs_seen_by = $4, updated_at = now() where id = $1 returning id)
         insert into public.careers_application_events (application_id, kind, actor_profile_id, detail) select id, 'DBS_SEEN', $4, $3::text || ' ' || $2::text from upd returning 1`,
        [id, seen.on, seen.how, actorId(actor)],
      );
      return rows.length > 0;
    },

    async file(applicationId, fileId) {
      if (!isUuid(applicationId) || !isUuid(fileId)) return null;
      const rows = await db.query<Row>(`select * from public.careers_application_files where id = $1 and application_id = $2`, [fileId, applicationId]);
      return rows[0] ? toFile(rows[0]) : null;
    },

    async logFileView(applicationId, fileId, actor) {
      if (!isUuid(applicationId) || !isUuid(fileId)) return;
      await db.query(
        `insert into public.careers_application_events (application_id, kind, actor_profile_id, file_id, detail)
         select f.application_id, 'FILE_VIEWED', $3, f.id, f.label from public.careers_application_files f where f.id = $1 and f.application_id = $2`,
        [fileId, applicationId, actorId(actor)],
      );
    },

    async removeIdentityFiles(applicationId, actor) {
      if (!isUuid(applicationId)) return 0;
      const rows = await db.query<Row>(
        `with gone as (delete from public.careers_application_files where application_id = $1 and sensitive returning 1),
              tally as (select count(*)::int as total from gone),
              ev as (insert into public.careers_application_events (application_id, kind, actor_profile_id, detail)
                     select $1, 'IDENTITY_FILES_DELETED', $2, tally.total::text from tally where tally.total > 0 returning 1)
         select tally.total as n from tally`,
        [applicationId, actorId(actor)],
      );
      return Number(rows[0]?.n ?? 0);
    },

    async remove(id, actor, reason) {
      if (!isUuid(id)) return null;
      const rows = await db.query<Row>(
        `with held as (select count(*)::int as total from public.careers_application_files where application_id = $1),
              gone as (delete from public.careers_applications where id = $1 returning id)
         insert into public.careers_deletions (actor_profile_id, reason, files)
         select $2, $3, held.total from gone, held returning *`,
        [id, actorId(actor), reason],
      );
      return rows[0] ? toDeletion(rows[0]) : null;
    },

    async dueBy(when) {
      const cut = when.toISOString();
      const [applications, identityDocuments] = await Promise.all([
        db.query<Row>(`${SUMMARY_SELECT} where a.delete_after is not null and a.delete_after <= $1 order by a.delete_after, a.id`, [cut]),
        db.query<Row>(
          `${SUMMARY_SELECT} where a.identity_delete_after is not null and a.identity_delete_after <= $1
             and exists (select 1 from public.careers_application_files f where f.application_id = a.id and f.sensitive)
           order by a.identity_delete_after, a.id`,
          [cut],
        ),
      ]);
      return { applications: applications.map(toSummary), identityDocuments: identityDocuments.map(toSummary) };
    },

    async deletions(limit) {
      const n = Math.min(Math.max(Math.trunc(limit), 0), 500);
      return (await db.query<Row>(`select * from public.careers_deletions order by at desc, id desc limit $1`, [n])).map(toDeletion);
    },
  };
}
