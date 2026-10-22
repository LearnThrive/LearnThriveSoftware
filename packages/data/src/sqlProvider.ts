import type {
  Client, ClientStudentLink, Lesson, LessonActivityEvent, LessonAttendanceRecord, LessonReport, Notification, PlatformSettings, Student,
  TuitionAssignment, Tutor, TutorAvailabilityBlock,
} from "./domain";
import type {
  ActivityRepository, AssignmentRepository, AttendanceRepository, AvailabilityRepository, ClientRepository, DataProvider, LessonRepository,
  NotificationRepository, ReportRepository, SettingsRepository, StudentRepository, TutorRepository,
} from "./repositories";
import type { SqlExecutor } from "./library/ports";

/**
 * The production domain provider: the tuition data (tutors, families, students, assignments, lessons, attendance, reports, notifications)
 * on Postgres, behind the SAME repository interfaces as the in-memory development provider, so no page, action or service changes
 * (docs/DOMAIN_MODEL.md). One contract test (testing/dataProviderContract.ts) holds both to the same behaviour.
 *
 * Mapping to the schema (migrations 0001 and 0011):
 *   Tutor    tutors; the email is the sign-in address when there is a login, else `contact_email`
 *   Client   clients joined to the owner's profile: the adult account holder. There is NO `create`: a client is an adult who signed up
 *            (an admin cannot make an account for someone), so the admin screen for it is closed in production
 *   Student  students; `userId` is the learner login (learner_identities), when there is one
 *   links    client_students, ACTIVE only: a suspended or revoked guardian link is not a link
 *   Assignment, Lesson   their tables, with students in junction tables. `clientIds` is DERIVED from the students' active links at read
 *            time, never stored, so a revoked guardian drops out of every lesson and assignment at once
 *
 * Ids are uuids. A lookup by an id that is not a uuid (a stale bookmark, a made-up string) answers "not found" rather than an error.
 * Server only: the site's database role reads and writes these; no API role has any grant on the lesson tables (migration 0011).
 */
type Row = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: string | undefined | null): value is string => typeof value === "string" && UUID.test(value);
const iso = (value: unknown): string => new Date(value as string | number | Date).toISOString();

/** Drops undefined entries so a patch only touches what was given. */
function entries(patch: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(patch).filter(([, v]) => v !== undefined);
}

/** `update <table> set a = $2, b = $3 where id = $1 returning *` for a patch of column -> value. Column names are fixed by the caller, never from input. */
async function patchRow(db: SqlExecutor, table: string, id: string, columns: Record<string, unknown>): Promise<Row | null> {
  const sets = entries(columns);
  if (sets.length === 0) return (await db.query<Row>(`select * from public.${table} where id = $1`, [id]))[0] ?? null;
  const assignments = sets.map(([column], i) => `${column} = $${i + 2}`).join(", ");
  const rows = await db.query<Row>(`update public.${table} set ${assignments} where id = $1 returning *`, [id, ...sets.map(([, v]) => v)]);
  return rows[0] ?? null;
}

const TUTOR_SELECT = `select t.id, t.profile_id, t.display_name, coalesce(public.auth_email(t.profile_id), t.contact_email, '') as email, t.subjects, t.active, t.created_at from public.tutors t`;
const CLIENT_SELECT = `select c.id, c.owner_profile_id, p.display_name, coalesce(public.auth_email(c.owner_profile_id), '') as email, c.active, c.created_at
  from public.clients c join public.profiles p on p.id = c.owner_profile_id`;
const STUDENT_SELECT = `select s.id, s.display_name, s.year_group, s.active, s.created_at,
  (select l.profile_id from public.learner_identities l where l.student_id = s.id and l.status = 'active') as user_id from public.students s`;

const toTutor = (r: Row): Tutor => ({ id: r.id, ...(r.profile_id ? { userId: r.profile_id } : {}), name: r.display_name, email: r.email, subjects: r.subjects ?? [], active: r.active, createdAt: iso(r.created_at) });
const toClient = (r: Row): Client => ({ id: r.id, userId: r.owner_profile_id, name: r.display_name, email: r.email, active: r.active, createdAt: iso(r.created_at) });
const toStudent = (r: Row): Student => ({ id: r.id, ...(r.user_id ? { userId: r.user_id } : {}), name: r.display_name, ...(r.year_group ? { yearGroup: r.year_group } : {}), active: r.active, createdAt: iso(r.created_at) });

/** The ids of the students on each assignment and the families that pay for them (active links only), as arrays. */
const ASSIGNMENT_SELECT = `select a.*,
  coalesce((select array_agg(x.student_id::text order by x.student_id) from public.assignment_students x where x.assignment_id = a.id), '{}') as student_ids,
  coalesce((select array_agg(distinct cs.client_id::text) from public.assignment_students x
              join public.client_students cs on cs.student_id = x.student_id and cs.status = 'active' where x.assignment_id = a.id), '{}') as client_ids
  from public.tuition_assignments a`;

function toAssignment(r: Row): TuitionAssignment {
  return {
    id: r.id, title: r.title, subject: r.subject, ...(r.level ? { level: r.level } : {}), tutorId: r.tutor_id, studentIds: r.student_ids, clientIds: [...r.client_ids].sort(),
    status: r.status, ...(r.default_duration_minutes ? { defaultDurationMinutes: r.default_duration_minutes } : {}), ...(r.default_location_type ? { defaultLocationType: r.default_location_type } : {}),
    ...(r.default_lesson_notes ? { defaultLessonNotes: r.default_lesson_notes } : {}), ...(r.require_report_approval === null || r.require_report_approval === undefined ? {} : { requireReportApproval: r.require_report_approval }),
    createdAt: iso(r.created_at),
  };
}

const LESSON_SELECT = `select l.*,
  coalesce((select array_agg(x.student_id::text order by x.student_id) from public.lesson_students x where x.lesson_id = l.id), '{}') as student_ids,
  coalesce((select array_agg(distinct cs.client_id::text) from public.lesson_students x
              join public.client_students cs on cs.student_id = x.student_id and cs.status = 'active' where x.lesson_id = l.id), '{}') as client_ids
  from public.lessons l`;

function toLesson(r: Row): Lesson {
  return {
    id: r.id, assignmentId: r.assignment_id, tutorId: r.tutor_id, studentIds: r.student_ids, clientIds: [...r.client_ids].sort(), title: r.title, subject: r.subject,
    startAt: iso(r.start_at), durationMinutes: r.duration_minutes, locationType: r.location_type, ...(r.location ? { location: r.location } : {}),
    ...(r.classroom_room_id ? { classroomRoomId: r.classroom_room_id } : {}), ...(r.notes ? { notes: r.notes } : {}), reportRequired: r.report_required, status: r.status,
    ...(r.recurrence_id ? { recurrenceId: r.recurrence_id } : {}), ...(r.cancelled_at ? { cancelledAt: iso(r.cancelled_at) } : {}), ...(r.cancelled_by ? { cancelledBy: r.cancelled_by } : {}),
    ...(r.cancellation_reason ? { cancellationReason: r.cancellation_reason } : {}), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

const hhmm = (v: unknown) => String(v).slice(0, 5);

function toReport(r: Row): LessonReport {
  return {
    id: r.id, lessonId: r.lesson_id, tutorId: r.tutor_id, status: r.status, publicSummary: r.public_summary, ...(r.progress ? { progress: r.progress } : {}),
    ...(r.areas_for_improvement ? { areasForImprovement: r.areas_for_improvement } : {}), ...(r.next_steps ? { nextSteps: r.next_steps } : {}),
    ...(r.engagement ? { engagement: r.engagement } : {}), ...(r.confidence ? { confidence: r.confidence } : {}), ...(r.internal_tutor_notes ? { internalTutorNotes: r.internal_tutor_notes } : {}),
    ...(r.submitted_at ? { submittedAt: iso(r.submitted_at) } : {}), ...(r.approved_at ? { approvedAt: iso(r.approved_at) } : {}), ...(r.approved_by ? { approvedBy: r.approved_by } : {}),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

export function createSqlDataProvider(db: SqlExecutor): DataProvider {
  const tutors: TutorRepository = {
    list: async () => (await db.query<Row>(`${TUTOR_SELECT} order by t.created_at, t.id`)).map(toTutor),
    get: async (id) => {
      const rows = isId(id) ? await db.query<Row>(`${TUTOR_SELECT} where t.id = $1`, [id]) : [];
      return rows[0] ? toTutor(rows[0]) : null;
    },
    getByUserId: async (userId) => {
      if (!isId(userId)) return null;
      const rows = await db.query<Row>(`${TUTOR_SELECT} where t.profile_id = $1`, [userId]);
      return rows[0] ? toTutor(rows[0]) : null;
    },
    create: async (input) => {
      const rows = await db.query<Row>(
        `insert into public.tutors (profile_id, display_name, subjects, active, contact_email) values ($1, $2, $3, $4, $5) returning id`,
        [isId(input.userId) ? input.userId : null, input.name.trim(), input.subjects, input.active, input.email?.trim() || null],
      );
      return toTutor((await db.query<Row>(`${TUTOR_SELECT} where t.id = $1`, [rows[0]!.id]))[0]!);
    },
    linkLogin: async (tutorId, email, actor) => {
      if (!isId(tutorId)) return "no_tutor";
      const done = await db.query<Row>(
        `with target as (select u.id from public.auth_user_by_email($2) u where u.email_confirmed),
              ok as (
                select t.id as tutor_id, tg.id as profile_id
                  from public.tutors t, target tg
                 where t.id = $1 and t.profile_id is null
                   and (select p.role from public.profiles p where p.id = tg.id) = 'CLIENT'
                   and not exists (select 1 from public.clients c where c.owner_profile_id = tg.id)
                   and not exists (select 1 from public.learner_identities l where l.profile_id = tg.id)
                   and not exists (select 1 from public.tutors o where o.profile_id = tg.id))
            , upd as (update public.tutors t set profile_id = ok.profile_id from ok where t.id = ok.tutor_id returning t.id)
            , role as (update public.profiles p set role = 'TUTOR' from ok where p.id = ok.profile_id returning 1)
            , audit as (insert into public.identity_audit (actor_profile_id, action) select $3, 'tutor_login_linked' from ok returning 1)
            select count(*)::int as n from upd`,
        [tutorId, email.trim(), isId(actor) ? actor : null],
      );
      if ((done[0]?.n ?? 0) > 0) return "ok";
      // Why not: told apart only so the admin can be told, never to guess.
      const tutor = (await db.query<Row>(`select profile_id from public.tutors where id = $1`, [tutorId]))[0];
      if (!tutor) return "no_tutor";
      const account = (await db.query<Row>(`select id, email_confirmed from public.auth_user_by_email($1)`, [email.trim()]))[0];
      if (!account || !account.email_confirmed) return "no_account";
      return "not_eligible";
    },
    update: async (id, patch) => {
      const row = isId(id) ? await patchRow(db, "tutors", id, { display_name: patch.name?.trim(), subjects: patch.subjects, active: patch.active, contact_email: patch.email?.trim(), profile_id: patch.userId }) : null;
      if (!row) throw new Error(`Tutor ${id} not found`);
      return toTutor((await db.query<Row>(`${TUTOR_SELECT} where t.id = $1`, [id]))[0]!);
    },
  };

  const clients: ClientRepository = {
    list: async () => (await db.query<Row>(`${CLIENT_SELECT} order by c.created_at, c.id`)).map(toClient),
    get: async (id) => {
      const rows = isId(id) ? await db.query<Row>(`${CLIENT_SELECT} where c.id = $1`, [id]) : [];
      return rows[0] ? toClient(rows[0]) : null;
    },
    getByUserId: async (userId) => {
      const rows = isId(userId) ? await db.query<Row>(`${CLIENT_SELECT} where c.owner_profile_id = $1`, [userId]) : [];
      return rows[0] ? toClient(rows[0]) : null;
    },
    create: async () => {
      throw new Error("A client is an adult who signs up: an administrator cannot create one. Ask the family to create their account.");
    },
    update: async (id, patch) => {
      const rows = isId(id) ? await db.query<Row>(`update public.clients set active = coalesce($2, active) where id = $1 returning id`, [id, patch.active ?? null]) : [];
      if (!rows[0]) throw new Error(`Client ${id} not found`);
      return toClient((await db.query<Row>(`${CLIENT_SELECT} where c.id = $1`, [id]))[0]!);
    },
  };

  const students: StudentRepository = {
    list: async () => (await db.query<Row>(`${STUDENT_SELECT} order by s.created_at, s.id`)).map(toStudent),
    get: async (id) => {
      const rows = isId(id) ? await db.query<Row>(`${STUDENT_SELECT} where s.id = $1`, [id]) : [];
      return rows[0] ? toStudent(rows[0]) : null;
    },
    getByUserId: async (userId) => {
      const rows = isId(userId) ? await db.query<Row>(`${STUDENT_SELECT} where exists (select 1 from public.learner_identities l where l.student_id = s.id and l.profile_id = $1 and l.status = 'active')`, [userId]) : [];
      return rows[0] ? toStudent(rows[0]) : null;
    },
    create: async (input) => {
      const clientId = (input as { clientId?: string }).clientId;
      if (!isId(clientId)) throw new Error("A student belongs to a family: say which one (clientId).");
      const rows = await db.query<Row>(`insert into public.students (client_id, display_name, year_group, active) values ($1, $2, $3, $4) returning id`, [clientId, input.name.trim(), input.yearGroup ?? null, input.active]);
      return toStudent((await db.query<Row>(`${STUDENT_SELECT} where s.id = $1`, [rows[0]!.id]))[0]!);
    },
    update: async (id, patch) => {
      const row = isId(id) ? await patchRow(db, "students", id, { display_name: patch.name?.trim(), year_group: patch.yearGroup, active: patch.active }) : null;
      if (!row) throw new Error(`Student ${id} not found`);
      return toStudent((await db.query<Row>(`${STUDENT_SELECT} where s.id = $1`, [id]))[0]!);
    },
    linkClient: async (clientId, studentId) => {
      if (!isId(clientId) || !isId(studentId)) throw new Error("Unknown client or student.");
      // A new guardian is VERIFIED by the server before this is called; the link is created active. Re-linking a revoked one restores nothing silently:
      // it stays as it is (the guardian relationship is changed only by the identity operations, which are audited).
      await db.query(`insert into public.client_students (client_id, student_id) values ($1, $2) on conflict (client_id, student_id) do nothing`, [clientId, studentId]);
    },
    unlinkClient: async (clientId, studentId) => {
      if (!isId(clientId) || !isId(studentId)) return;
      // The owning family's link is not removable here; any other link is revoked (kept for the audit trail), not deleted.
      await db.query(
        `update public.client_students cs set status = 'revoked', status_changed_at = now()
          from public.students s where cs.client_id = $1 and cs.student_id = $2 and s.id = cs.student_id and s.client_id <> cs.client_id`,
        [clientId, studentId],
      );
    },
    clientsFor: async (studentId) =>
      isId(studentId)
        ? (await db.query<Row>(`${CLIENT_SELECT} where c.id in (select client_id from public.client_students where student_id = $1 and status = 'active') order by c.created_at, c.id`, [studentId])).map(toClient)
        : [],
    studentsFor: async (clientId) =>
      isId(clientId)
        ? (await db.query<Row>(`${STUDENT_SELECT} where s.id in (select student_id from public.client_students where client_id = $1 and status = 'active') order by s.created_at, s.id`, [clientId])).map(toStudent)
        : [],
    allLinks: async (): Promise<ClientStudentLink[]> => (await db.query<Row>(`select client_id, student_id from public.client_students where status = 'active' order by created_at, student_id`)).map((r) => ({ clientId: r.client_id, studentId: r.student_id })),
  };

  async function replaceStudents(table: "assignment_students" | "lesson_students", column: "assignment_id" | "lesson_id", id: string, studentIds: string[]) {
    const wanted = [...new Set(studentIds.filter(isId))];
    await db.query(`delete from public.${table} where ${column} = $1 and not (student_id = any($2::uuid[]))`, [id, wanted]);
    if (wanted.length) await db.query(`insert into public.${table} (${column}, student_id) select $1, unnest($2::uuid[]) on conflict do nothing`, [id, wanted]);
  }

  const assignments: AssignmentRepository = {
    list: async () => (await db.query<Row>(`${ASSIGNMENT_SELECT} order by a.created_at, a.id`)).map(toAssignment),
    get: async (id) => {
      const rows = isId(id) ? await db.query<Row>(`${ASSIGNMENT_SELECT} where a.id = $1`, [id]) : [];
      return rows[0] ? toAssignment(rows[0]) : null;
    },
    forTutor: async (tutorId) => (isId(tutorId) ? (await db.query<Row>(`${ASSIGNMENT_SELECT} where a.tutor_id = $1 order by a.created_at, a.id`, [tutorId])).map(toAssignment) : []),
    forStudent: async (studentId) =>
      isId(studentId) ? (await db.query<Row>(`${ASSIGNMENT_SELECT} where exists (select 1 from public.assignment_students x where x.assignment_id = a.id and x.student_id = $1) order by a.created_at, a.id`, [studentId])).map(toAssignment) : [],
    forClient: async (clientId) =>
      isId(clientId)
        ? (await db.query<Row>(
            `${ASSIGNMENT_SELECT} where exists (select 1 from public.assignment_students x join public.client_students cs on cs.student_id = x.student_id and cs.status = 'active'
                                                 where x.assignment_id = a.id and cs.client_id = $1) order by a.created_at, a.id`,
            [clientId],
          )).map(toAssignment)
        : [],
    create: async (input) => {
      const rows = await db.query<Row>(
        `insert into public.tuition_assignments (title, subject, level, tutor_id, status, default_duration_minutes, default_location_type, default_lesson_notes, require_report_approval)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [input.title.trim(), input.subject.trim(), input.level ?? null, input.tutorId, input.status, input.defaultDurationMinutes ?? null, input.defaultLocationType ?? null, input.defaultLessonNotes ?? null, input.requireReportApproval ?? null],
      );
      await replaceStudents("assignment_students", "assignment_id", rows[0]!.id, input.studentIds);
      return toAssignment((await db.query<Row>(`${ASSIGNMENT_SELECT} where a.id = $1`, [rows[0]!.id]))[0]!);
    },
    update: async (id, patch) => {
      const row = isId(id)
        ? await patchRow(db, "tuition_assignments", id, {
            title: patch.title?.trim(), subject: patch.subject?.trim(), level: patch.level, tutor_id: patch.tutorId, status: patch.status, default_duration_minutes: patch.defaultDurationMinutes,
            default_location_type: patch.defaultLocationType, default_lesson_notes: patch.defaultLessonNotes, require_report_approval: patch.requireReportApproval,
          })
        : null;
      if (!row) throw new Error(`Tuition assignment ${id} not found`);
      if (patch.studentIds) await replaceStudents("assignment_students", "assignment_id", id, patch.studentIds);
      return toAssignment((await db.query<Row>(`${ASSIGNMENT_SELECT} where a.id = $1`, [id]))[0]!);
    },
  };

  const insertLesson = async (input: Omit<Lesson, "id" | "createdAt" | "updatedAt">): Promise<Lesson> => {
    const rows = await db.query<Row>(
      `insert into public.lessons (assignment_id, tutor_id, title, subject, start_at, duration_minutes, location_type, location, classroom_room_id, notes, report_required, status, recurrence_id, cancelled_at, cancelled_by, cancellation_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
      [
        input.assignmentId, input.tutorId, input.title.trim(), input.subject.trim(), input.startAt, input.durationMinutes, input.locationType, input.location ?? null, input.classroomRoomId ?? null, input.notes ?? null,
        input.reportRequired, input.status, isId(input.recurrenceId) ? input.recurrenceId : null, input.cancelledAt ?? null, isId(input.cancelledBy) ? input.cancelledBy : null, input.cancellationReason ?? null,
      ],
    );
    await replaceStudents("lesson_students", "lesson_id", rows[0]!.id, input.studentIds);
    return toLesson((await db.query<Row>(`${LESSON_SELECT} where l.id = $1`, [rows[0]!.id]))[0]!);
  };

  const lessons: LessonRepository = {
    list: async () => (await db.query<Row>(`${LESSON_SELECT} order by l.start_at, l.id`)).map(toLesson),
    get: async (id) => {
      const rows = isId(id) ? await db.query<Row>(`${LESSON_SELECT} where l.id = $1`, [id]) : [];
      return rows[0] ? toLesson(rows[0]) : null;
    },
    forTutor: async (tutorId) => (isId(tutorId) ? (await db.query<Row>(`${LESSON_SELECT} where l.tutor_id = $1 order by l.start_at, l.id`, [tutorId])).map(toLesson) : []),
    forStudent: async (studentId) =>
      isId(studentId) ? (await db.query<Row>(`${LESSON_SELECT} where exists (select 1 from public.lesson_students x where x.lesson_id = l.id and x.student_id = $1) order by l.start_at, l.id`, [studentId])).map(toLesson) : [],
    forClient: async (clientId) =>
      isId(clientId)
        ? (await db.query<Row>(
            `${LESSON_SELECT} where exists (select 1 from public.lesson_students x join public.client_students cs on cs.student_id = x.student_id and cs.status = 'active'
                                             where x.lesson_id = l.id and cs.client_id = $1) order by l.start_at, l.id`,
            [clientId],
          )).map(toLesson)
        : [],
    forRecurrence: async (recurrenceId) => (isId(recurrenceId) ? (await db.query<Row>(`${LESSON_SELECT} where l.recurrence_id = $1 order by l.start_at, l.id`, [recurrenceId])).map(toLesson) : []),
    overlapping: async (params) => {
      const rows = await db.query<Row>(
        `${LESSON_SELECT}
          where l.status <> 'CANCELLED' and ($4::uuid is null or l.id <> $4::uuid)
            and (($1::uuid is not null and l.tutor_id = $1::uuid)
              or ($2::uuid is not null and exists (select 1 from public.lesson_students x where x.lesson_id = l.id and x.student_id = $2::uuid)))
            and l.start_at < $3::timestamptz + make_interval(mins => $5::int)
            and $3::timestamptz < l.start_at + make_interval(mins => l.duration_minutes)
          order by l.start_at, l.id`,
        [isId(params.tutorId) ? params.tutorId : null, isId(params.studentId) ? params.studentId : null, params.startAt, isId(params.excludeLessonId) ? params.excludeLessonId : null, params.durationMinutes],
      );
      return rows.map(toLesson);
    },
    create: insertLesson,
    createMany: async (inputs) => {
      const created: Lesson[] = [];
      for (const input of inputs) created.push(await insertLesson(input));
      return created;
    },
    update: async (id, patch) => {
      const row = isId(id)
        ? await patchRow(db, "lessons", id, {
            assignment_id: patch.assignmentId, tutor_id: patch.tutorId, title: patch.title?.trim(), subject: patch.subject?.trim(), start_at: patch.startAt, duration_minutes: patch.durationMinutes,
            location_type: patch.locationType, location: patch.location, classroom_room_id: patch.classroomRoomId, notes: patch.notes, report_required: patch.reportRequired, status: patch.status,
            recurrence_id: patch.recurrenceId, cancelled_at: patch.cancelledAt, cancelled_by: isId(patch.cancelledBy) ? patch.cancelledBy : undefined, cancellation_reason: patch.cancellationReason,
          })
        : null;
      if (!row) throw new Error(`Lesson ${id} not found`);
      if (patch.studentIds) await replaceStudents("lesson_students", "lesson_id", id, patch.studentIds);
      return toLesson((await db.query<Row>(`${LESSON_SELECT} where l.id = $1`, [id]))[0]!);
    },
  };

  const toBlock = (r: Row): TutorAvailabilityBlock => ({ id: r.id, tutorId: r.tutor_id, type: r.type, weekday: r.weekday, startTime: hhmm(r.start_time), endTime: hhmm(r.end_time) });
  const availability: AvailabilityRepository = {
    forTutor: async (tutorId) => (isId(tutorId) ? (await db.query<Row>(`select * from public.tutor_availability_blocks where tutor_id = $1 order by weekday, start_time, id`, [tutorId])).map(toBlock) : []),
    create: async (input) => toBlock((await db.query<Row>(`insert into public.tutor_availability_blocks (tutor_id, type, weekday, start_time, end_time) values ($1, $2, $3, $4, $5) returning *`, [input.tutorId, input.type, input.weekday, input.startTime, input.endTime]))[0]!),
    remove: async (id) => void (isId(id) ? await db.query(`delete from public.tutor_availability_blocks where id = $1`, [id]) : undefined),
  };

  const toAttendance = (r: Row): LessonAttendanceRecord => ({
    lessonId: r.lesson_id, studentId: r.student_id, status: r.status, ...(r.arrival_time ? { arrivalTime: iso(r.arrival_time) } : {}), ...(r.departure_time ? { departureTime: iso(r.departure_time) } : {}),
    ...(r.notes ? { notes: r.notes } : {}), markedBy: r.marked_by ?? "", markedAt: iso(r.marked_at),
  });
  const attendance: AttendanceRepository = {
    forLesson: async (lessonId) => (isId(lessonId) ? (await db.query<Row>(`select * from public.lesson_attendance where lesson_id = $1 order by student_id`, [lessonId])).map(toAttendance) : []),
    upsert: async (record) => {
      const rows = await db.query<Row>(
        `insert into public.lesson_attendance (lesson_id, student_id, status, arrival_time, departure_time, notes, marked_by, marked_at) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (lesson_id, student_id) do update set status = excluded.status, arrival_time = excluded.arrival_time, departure_time = excluded.departure_time, notes = excluded.notes, marked_by = excluded.marked_by, marked_at = excluded.marked_at
         returning *`,
        [record.lessonId, record.studentId, record.status, record.arrivalTime ?? null, record.departureTime ?? null, record.notes ?? null, isId(record.markedBy) ? record.markedBy : null, record.markedAt],
      );
      return toAttendance(rows[0]!);
    },
  };

  const toEvent = (r: Row): LessonActivityEvent => ({ id: r.id, lessonId: r.lesson_id, type: r.type, message: r.message, ...(r.actor_id ? { actorId: r.actor_id } : {}), createdAt: iso(r.created_at) });
  const activity: ActivityRepository = {
    forLesson: async (lessonId) => (isId(lessonId) ? (await db.query<Row>(`select * from public.lesson_activity where lesson_id = $1 order by created_at, id`, [lessonId])).map(toEvent) : []),
    append: async (event) => toEvent((await db.query<Row>(`insert into public.lesson_activity (lesson_id, type, message, actor_id) values ($1, $2, $3, $4) returning *`, [event.lessonId, event.type, event.message, isId(event.actorId) ? event.actorId : null]))[0]!),
    recent: async (limit) => (await db.query<Row>(`select * from public.lesson_activity order by created_at desc, id desc limit $1`, [Math.min(Math.max(Math.trunc(limit), 0), 500)])).map(toEvent),
  };

  const reports: ReportRepository = {
    get: async (id) => {
      const rows = isId(id) ? await db.query<Row>(`select * from public.lesson_reports where id = $1`, [id]) : [];
      return rows[0] ? toReport(rows[0]) : null;
    },
    forLesson: async (lessonId) => {
      const rows = isId(lessonId) ? await db.query<Row>(`select * from public.lesson_reports where lesson_id = $1`, [lessonId]) : [];
      return rows[0] ? toReport(rows[0]) : null;
    },
    forStudent: async (studentId) =>
      isId(studentId)
        ? (await db.query<Row>(`select r.* from public.lesson_reports r where r.lesson_id in (select lesson_id from public.lesson_students where student_id = $1) order by r.created_at, r.id`, [studentId])).map(toReport)
        : [],
    create: async (input) => {
      const rows = await db.query<Row>(
        `insert into public.lesson_reports (lesson_id, tutor_id, status, public_summary, progress, areas_for_improvement, next_steps, engagement, confidence, internal_tutor_notes, submitted_at, approved_at, approved_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
        [input.lessonId, input.tutorId, input.status, input.publicSummary, input.progress ?? null, input.areasForImprovement ?? null, input.nextSteps ?? null, input.engagement ?? null, input.confidence ?? null, input.internalTutorNotes ?? null, input.submittedAt ?? null, input.approvedAt ?? null, isId(input.approvedBy) ? input.approvedBy : null],
      );
      return toReport(rows[0]!);
    },
    update: async (id, patch) => {
      const row = isId(id)
        ? await patchRow(db, "lesson_reports", id, {
            status: patch.status, public_summary: patch.publicSummary, progress: patch.progress, areas_for_improvement: patch.areasForImprovement, next_steps: patch.nextSteps, engagement: patch.engagement,
            confidence: patch.confidence, internal_tutor_notes: patch.internalTutorNotes, submitted_at: patch.submittedAt, approved_at: patch.approvedAt, approved_by: isId(patch.approvedBy) ? patch.approvedBy : undefined,
          })
        : null;
      if (!row) throw new Error(`LessonReport ${id} not found`);
      return toReport(row);
    },
  };

  const settings: SettingsRepository = {
    get: async (): Promise<PlatformSettings> => ({ requireReportApproval: ((await db.query<Row>(`select require_report_approval from public.platform_settings`))[0]?.require_report_approval ?? true) === true }),
    update: async (patch) => {
      if (patch.requireReportApproval !== undefined) await db.query(`update public.platform_settings set require_report_approval = $1`, [patch.requireReportApproval]);
      return settings.get();
    },
  };

  const toNotification = (r: Row): Notification => ({ id: r.id, userId: r.user_id, type: r.type, message: r.message, ...(r.link ? { link: r.link } : {}), read: r.read, createdAt: iso(r.created_at) });
  const notifications: NotificationRepository = {
    forUser: async (userId) => (isId(userId) ? (await db.query<Row>(`select * from public.notifications where user_id = $1 order by created_at desc, id`, [userId])).map(toNotification) : []),
    unreadCountForUser: async (userId) => (isId(userId) ? ((await db.query<Row>(`select count(*)::int as n from public.notifications where user_id = $1 and not read`, [userId]))[0]?.n ?? 0) : 0),
    create: async (input) => toNotification((await db.query<Row>(`insert into public.notifications (user_id, type, message, link) values ($1, $2, $3, $4) returning *`, [input.userId, input.type, input.message, input.link ?? null]))[0]!),
    markRead: async (id) => void (isId(id) ? await db.query(`update public.notifications set read = true where id = $1`, [id]) : undefined),
  };

  return { tutors, clients, students, assignments, lessons, availability, attendance, activity, reports, settings, notifications };
}
