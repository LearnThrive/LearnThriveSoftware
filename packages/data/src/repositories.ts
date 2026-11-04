import type {
  Client, ClientStudentLink, Lesson, LessonActivityEvent, LessonAttendanceRecord, LessonReport, Notification, PlatformSettings, Student,
  TuitionAssignment, Tutor, TutorAvailabilityBlock,
} from "./domain";

// Every repository interface follows the same shape deliberately — a future
// SupabaseTutorRepository/SupabaseClientRepository/etc. implements these same interfaces (see
// docs/SUPABASE_MIGRATION.md); nothing above the repository layer (dashboards, route handlers,
// business-rule services) should ever know or care which one is backing it.

export interface TutorRepository {
  list(): Promise<Tutor[]>;
  get(id: string): Promise<Tutor | null>;
  getByUserId(userId: string): Promise<Tutor | null>;
  create(input: Omit<Tutor, "id" | "createdAt">): Promise<Tutor>;
  update(id: string, patch: Partial<Omit<Tutor, "id" | "createdAt">>): Promise<Tutor>;
  /**
   * Gives a tutor record a login: the person with this username becomes that tutor. A CLIENT becomes a TUTOR; an ADMIN stays an ADMIN and
   * gains the tutor tools (docs/ROLE_PERMISSIONS.md), so nobody is ever demoted. Refused for an account that owns a family, is a learner or
   * already teaches, and for a tutor who already has a login: nobody is ever converted by guessing. Audited. 'unsupported' where the
   * provider has no real accounts (development).
   */
  linkLogin(tutorId: string, username: string, actor: string): Promise<"ok" | "no_tutor" | "no_account" | "not_eligible" | "unsupported">;
}

export interface ClientRepository {
  list(): Promise<Client[]>;
  get(id: string): Promise<Client | null>;
  getByUserId(userId: string): Promise<Client | null>;
  create(input: Omit<Client, "id" | "createdAt">): Promise<Client>;
  update(id: string, patch: Partial<Omit<Client, "id" | "createdAt">>): Promise<Client>;
}

export interface StudentRepository {
  list(): Promise<Student[]>;
  get(id: string): Promise<Student | null>;
  getByUserId(userId: string): Promise<Student | null>;
  create(input: Omit<Student, "id" | "createdAt">): Promise<Student>;
  update(id: string, patch: Partial<Omit<Student, "id" | "createdAt">>): Promise<Student>;
  // Relationship queries — a join table (ClientStudentLink), not a foreign key on either side.
  linkClient(clientId: string, studentId: string): Promise<void>;
  unlinkClient(clientId: string, studentId: string): Promise<void>;
  clientsFor(studentId: string): Promise<Client[]>;
  studentsFor(clientId: string): Promise<Student[]>;
  allLinks(): Promise<ClientStudentLink[]>;
}

export interface AssignmentRepository {
  list(): Promise<TuitionAssignment[]>;
  get(id: string): Promise<TuitionAssignment | null>;
  forTutor(tutorId: string): Promise<TuitionAssignment[]>;
  forStudent(studentId: string): Promise<TuitionAssignment[]>;
  forClient(clientId: string): Promise<TuitionAssignment[]>;
  create(input: Omit<TuitionAssignment, "id" | "createdAt">): Promise<TuitionAssignment>;
  update(id: string, patch: Partial<Omit<TuitionAssignment, "id" | "createdAt">>): Promise<TuitionAssignment>;
}

export interface LessonRepository {
  list(): Promise<Lesson[]>;
  get(id: string): Promise<Lesson | null>;
  forTutor(tutorId: string): Promise<Lesson[]>;
  forStudent(studentId: string): Promise<Lesson[]>;
  forClient(clientId: string): Promise<Lesson[]>;
  forRecurrence(recurrenceId: string): Promise<Lesson[]>;
  // Overlap check for conflict detection — [startAt, startAt+durationMinutes). excludeLessonId
  // lets rescheduling a lesson check against every *other* lesson without tripping over itself.
  overlapping(params: { tutorId?: string; studentId?: string; startAt: string; durationMinutes: number; excludeLessonId?: string }): Promise<Lesson[]>;
  create(input: Omit<Lesson, "id" | "createdAt" | "updatedAt">): Promise<Lesson>;
  createMany(inputs: Array<Omit<Lesson, "id" | "createdAt" | "updatedAt">>): Promise<Lesson[]>;
  update(id: string, patch: Partial<Omit<Lesson, "id" | "createdAt">>): Promise<Lesson>;
}

export interface AvailabilityRepository {
  forTutor(tutorId: string): Promise<TutorAvailabilityBlock[]>;
  create(input: Omit<TutorAvailabilityBlock, "id">): Promise<TutorAvailabilityBlock>;
  remove(id: string): Promise<void>;
}

export interface AttendanceRepository {
  forLesson(lessonId: string): Promise<LessonAttendanceRecord[]>;
  // One record per (lessonId, studentId) — marking the same Student again replaces their record
  // rather than appending a second one, since only the current attendance decision matters.
  upsert(record: LessonAttendanceRecord): Promise<LessonAttendanceRecord>;
}

export interface ActivityRepository {
  forLesson(lessonId: string): Promise<LessonActivityEvent[]>;
  append(event: Omit<LessonActivityEvent, "id" | "createdAt">): Promise<LessonActivityEvent>;
  // Platform-wide, newest first — plan section 53's Admin "recent activity" feed. Deliberately
  // separate from forLesson() rather than one method with an optional lessonId, since the two
  // callers (a single lesson's timeline vs. the whole platform's feed) want different shapes of
  // "all of it" (unbounded vs. capped) for different reasons.
  recent(limit: number): Promise<LessonActivityEvent[]>;
}

export interface NotificationRepository {
  forUser(userId: string): Promise<Notification[]>; // newest first
  unreadCountForUser(userId: string): Promise<number>;
  create(input: Omit<Notification, "id" | "createdAt" | "read">): Promise<Notification>;
  markRead(id: string): Promise<void>;
  /** The login behind a tutor, family or student record, or null: many records have none, and they simply get no notification. */
  recipientFor(recordId: string): Promise<string | null>;
  /** Every login with this role, except one that has been disabled. */
  recipientsWithRole(role: "ADMIN" | "TUTOR" | "CLIENT" | "STUDENT"): Promise<string[]>;
}

export interface ReportRepository {
  get(id: string): Promise<LessonReport | null>;
  forLesson(lessonId: string): Promise<LessonReport | null>; // one report per Lesson
  forStudent(studentId: string): Promise<LessonReport[]>; // via the Lesson's studentIds — for the progress timeline
  create(input: Omit<LessonReport, "id" | "createdAt" | "updatedAt">): Promise<LessonReport>;
  update(id: string, patch: Partial<Omit<LessonReport, "id" | "lessonId" | "tutorId" | "createdAt">>): Promise<LessonReport>;
}

export interface SettingsRepository {
  get(): Promise<PlatformSettings>;
  update(patch: Partial<PlatformSettings>): Promise<PlatformSettings>;
}

/**
 * The purge tool (launch checklist 3.7, docs/LAWFUL_BASES.md): when a student or a tutor leaves, their records are removed in one audited
 * step, apart from the exceptions the owners confirmed. A purge is final, so it is always previewed first.
 *
 * Nothing here stores a name, an email or the id of the person purged: the log row holds the date, the administrator, what kind and
 * numbers (3.7.5), so the log cannot become the record the purge removed. `profileIds` and `files` in a preview are for the action to
 * act on, never for the log.
 */
export type PurgeKind = "STUDENT" | "TUTOR" | "FAMILY";

/**
 * Lessons and reports must always name a tutor (NOT NULL, ON DELETE RESTRICT), so a purged tutor's history hangs on this archived row
 * instead of a real person. It is never purged itself, and it appears in tutor lists as an inactive "Former tutor".
 */
export const ARCHIVED_TUTOR_ID = "00000000-0000-4000-8000-0000000000fe";

/** The lawful-bases position every purge preview states (docs/LAWFUL_BASES.md). */
export const PURGE_NOTES = [
  "A purge is final. The records listed above are deleted, not archived.",
  "Financial records (invoices and Stripe references) are kept for the period the accountant sets, usually 6 years. None are held in this app yet.",
  "Safeguarding records are kept separately by the safeguarding lead, who is not part of this app.",
  "A database backup keeps a copy until it ages out; a restore must not undo a purge (docs/SUPABASE_RUNBOOK.md).",
];

export interface PurgeItem {
  /** What it is, in plain words: "Lessons that exist only for this student". */
  what: string;
  count: number;
}

export interface PurgeKept extends PurgeItem {
  /** Why it stays: another child is on it, the law requires it, and so on. */
  reason: string;
}

export interface PurgePreview {
  kind: PurgeKind;
  /** What will be deleted, by what it is. */
  removes: PurgeItem[];
  /** What stays, and why. */
  keeps: PurgeKept[];
  /** Logins that will be deleted from Auth by the action, after their database rows. */
  profileIds: string[];
  /** Stored objects to delete BEFORE any row (empty at launch: tuition has no uploads of its own). */
  files: string[];
  /** The lawful-bases position, in the words the administrator sees before confirming. */
  notes: string[];
}

export interface PurgeRecord {
  id: string;
  kind: PurgeKind;
  actorId: string | null;
  /** Row counts by what was removed. Numbers only, never the person's id or name. */
  counts: Record<string, number>;
  at: string;
}

export interface PurgeRepository {
  /** null when there is no such record (or it is the archived tutor, which is never a person). */
  previewStudent(studentId: string): Promise<PurgePreview | null>;
  previewTutor(tutorId: string): Promise<PurgePreview | null>;
  previewFamily(clientId: string): Promise<PurgePreview | null>;
  /** Removes the records and writes the log row, in one transaction. null when there was nothing to purge. */
  purgeStudent(studentId: string, actor: string): Promise<PurgeRecord | null>;
  purgeTutor(tutorId: string, actor: string): Promise<PurgeRecord | null>;
  purgeFamily(clientId: string, actor: string): Promise<PurgeRecord | null>;
  /** Newest first. Counts only, so this is safe to show an administrator. */
  recent(limit: number): Promise<PurgeRecord[]>;
}

export interface DataProvider {
  tutors: TutorRepository;
  /** The purge tool (3.7): every later removal path goes through this, never a bare delete. */
  purges: PurgeRepository;
  clients: ClientRepository;
  students: StudentRepository;
  assignments: AssignmentRepository;
  lessons: LessonRepository;
  availability: AvailabilityRepository;
  attendance: AttendanceRepository;
  activity: ActivityRepository;
  reports: ReportRepository;
  settings: SettingsRepository;
  notifications: NotificationRepository;
}
