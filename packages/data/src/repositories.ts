import type {
  Client, ClientStudentLink, Lesson, LessonActivityEvent, LessonAttendanceRecord, LessonReport, PlatformSettings, Student, TuitionAssignment,
  Tutor, TutorAvailabilityBlock,
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

export interface DataProvider {
  tutors: TutorRepository;
  clients: ClientRepository;
  students: StudentRepository;
  assignments: AssignmentRepository;
  lessons: LessonRepository;
  availability: AvailabilityRepository;
  attendance: AttendanceRepository;
  activity: ActivityRepository;
  reports: ReportRepository;
  settings: SettingsRepository;
}
