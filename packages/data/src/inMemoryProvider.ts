import { randomUUID } from "node:crypto";
import type {
  Client, ClientStudentLink, Lesson, LessonActivityEvent, LessonAttendanceRecord, LessonReport, Notification, PlatformSettings, Student,
  TuitionAssignment, Tutor, TutorAvailabilityBlock,
} from "./domain";
import type {
  ActivityRepository, AssignmentRepository, AttendanceRepository, AvailabilityRepository, ClientRepository, DataProvider, LessonRepository,
  NotificationRepository, PurgeItem, PurgeKept, PurgePreview, PurgeRecord, PurgeRepository, ReportRepository, SettingsRepository, StudentRepository, TutorRepository,
} from "./repositories";
import { ARCHIVED_TUTOR_ID, PURGE_NOTES } from "./repositories";

// Fixed, well-known ids for the seeded demo people (plan section 89's scenario) — not random,
// so apps/web's auth seed (devProvider.ts) can set matching AuthenticatedUser.profileId values
// and the two seed systems stay cross-referenced deterministically rather than by coincidence.
export const SEED_IDS = {
  tutorJamiePatel: "tutor-jamie-patel",
  tutorMeeraShah: "tutor-meera-shah",
  clientSarahAhmed: "client-sarah-ahmed",
  studentAyaanAhmed: "student-ayaan-ahmed",
  assignmentGcseMaths: "assignment-gcse-maths-ayaan",
  availabilityTuesday: "availability-jamie-tuesday",
  availabilityThursday: "availability-jamie-thursday",
  lessonCompleted: "lesson-gcse-maths-completed",
  lessonUpcoming: "lesson-gcse-maths-upcoming",
  classroomRoomUpcoming: "classroom-room-gcse-maths-upcoming",
  reportApproved: "report-gcse-maths-completed-approved",
} as const;

function now() {
  return new Date().toISOString();
}

class InMemoryTutorRepository implements TutorRepository {
  constructor(private readonly store: Map<string, Tutor>) {}
  async list() { return [...this.store.values()]; }
  async get(id: string) { return this.store.get(id) ?? null; }
  async getByUserId(userId: string) { return [...this.store.values()].find((t) => t.userId === userId) ?? null; }
  async linkLogin() { return "unsupported" as const; } // development tutors are linked by the seed (lib/dev/accounts.ts)
  async create(input: Omit<Tutor, "id" | "createdAt">) {
    const tutor: Tutor = { ...input, id: randomUUID(), createdAt: now() };
    this.store.set(tutor.id, tutor);
    return tutor;
  }
  async update(id: string, patch: Partial<Omit<Tutor, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Tutor ${id} not found`);
    const updated = { ...existing, ...patch };
    this.store.set(id, updated);
    return updated;
  }
}

class InMemoryClientRepository implements ClientRepository {
  constructor(private readonly store: Map<string, Client>) {}
  async list() { return [...this.store.values()]; }
  async get(id: string) { return this.store.get(id) ?? null; }
  async getByUserId(userId: string) { return [...this.store.values()].find((c) => c.userId === userId) ?? null; }
  async create(input: Omit<Client, "id" | "createdAt">) {
    const client: Client = { ...input, id: randomUUID(), createdAt: now() };
    this.store.set(client.id, client);
    return client;
  }
  async update(id: string, patch: Partial<Omit<Client, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Client ${id} not found`);
    const updated = { ...existing, ...patch };
    this.store.set(id, updated);
    return updated;
  }
}

class InMemoryStudentRepository implements StudentRepository {
  constructor(
    private readonly store: Map<string, Student>,
    private readonly clientStore: Map<string, Client>,
    private readonly links: ClientStudentLink[],
  ) {}
  async list() { return [...this.store.values()]; }
  async get(id: string) { return this.store.get(id) ?? null; }
  async getByUserId(userId: string) { return [...this.store.values()].find((s) => s.userId === userId) ?? null; }
  async create(input: Omit<Student, "id" | "createdAt">) {
    const student: Student = { ...input, id: randomUUID(), createdAt: now() };
    this.store.set(student.id, student);
    return student;
  }
  async update(id: string, patch: Partial<Omit<Student, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Student ${id} not found`);
    const updated = { ...existing, ...patch };
    this.store.set(id, updated);
    return updated;
  }
  async linkClient(clientId: string, studentId: string) {
    if (this.links.some((l) => l.clientId === clientId && l.studentId === studentId)) return;
    this.links.push({ clientId, studentId });
  }
  async unlinkClient(clientId: string, studentId: string) {
    const index = this.links.findIndex((l) => l.clientId === clientId && l.studentId === studentId);
    if (index !== -1) this.links.splice(index, 1);
  }
  async clientsFor(studentId: string) {
    return this.links.filter((l) => l.studentId === studentId)
      .map((l) => this.clientStore.get(l.clientId)).filter((c): c is Client => Boolean(c));
  }
  async studentsFor(clientId: string) {
    return this.links.filter((l) => l.clientId === clientId)
      .map((l) => this.store.get(l.studentId)).filter((s): s is Student => Boolean(s));
  }
  async allLinks() { return [...this.links]; }
}

class InMemoryAssignmentRepository implements AssignmentRepository {
  constructor(private readonly store: Map<string, TuitionAssignment>) {}
  async list() { return [...this.store.values()]; }
  async get(id: string) { return this.store.get(id) ?? null; }
  async forTutor(tutorId: string) { return [...this.store.values()].filter((a) => a.tutorId === tutorId); }
  async forStudent(studentId: string) { return [...this.store.values()].filter((a) => a.studentIds.includes(studentId)); }
  async forClient(clientId: string) { return [...this.store.values()].filter((a) => a.clientIds.includes(clientId)); }
  async create(input: Omit<TuitionAssignment, "id" | "createdAt">) {
    const assignment: TuitionAssignment = { ...input, id: randomUUID(), createdAt: now() };
    this.store.set(assignment.id, assignment);
    return assignment;
  }
  async update(id: string, patch: Partial<Omit<TuitionAssignment, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Tuition assignment ${id} not found`);
    const updated = { ...existing, ...patch };
    this.store.set(id, updated);
    return updated;
  }
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

class InMemoryLessonRepository implements LessonRepository {
  constructor(private readonly store: Map<string, Lesson>) {}
  async list() { return [...this.store.values()]; }
  async get(id: string) { return this.store.get(id) ?? null; }
  async forTutor(tutorId: string) { return [...this.store.values()].filter((l) => l.tutorId === tutorId); }
  async forStudent(studentId: string) { return [...this.store.values()].filter((l) => l.studentIds.includes(studentId)); }
  async forClient(clientId: string) { return [...this.store.values()].filter((l) => l.clientIds.includes(clientId)); }
  async forRecurrence(recurrenceId: string) {
    return [...this.store.values()].filter((l) => l.recurrenceId === recurrenceId).sort((a, b) => a.startAt.localeCompare(b.startAt));
  }
  async overlapping(params: { tutorId?: string; studentId?: string; startAt: string; durationMinutes: number; excludeLessonId?: string }) {
    const start = new Date(params.startAt).getTime();
    const end = start + params.durationMinutes * 60_000;
    return [...this.store.values()].filter((l) => {
      if (l.id === params.excludeLessonId) return false;
      if (l.status === "CANCELLED") return false;
      const matchesTutor = params.tutorId != null && l.tutorId === params.tutorId;
      const matchesStudent = params.studentId != null && l.studentIds.includes(params.studentId);
      if (!matchesTutor && !matchesStudent) return false;
      const lStart = new Date(l.startAt).getTime();
      const lEnd = lStart + l.durationMinutes * 60_000;
      return overlaps(start, end, lStart, lEnd);
    });
  }
  async create(input: Omit<Lesson, "id" | "createdAt" | "updatedAt">) {
    const timestamp = now();
    const lesson: Lesson = { ...input, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp };
    this.store.set(lesson.id, lesson);
    return lesson;
  }
  async createMany(inputs: Array<Omit<Lesson, "id" | "createdAt" | "updatedAt">>) {
    const created: Lesson[] = [];
    for (const input of inputs) created.push(await this.create(input));
    return created;
  }
  async update(id: string, patch: Partial<Omit<Lesson, "id" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Lesson ${id} not found`);
    const updated = { ...existing, ...patch, updatedAt: now() };
    this.store.set(id, updated);
    return updated;
  }
}

class InMemoryAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly store: Map<string, TutorAvailabilityBlock>) {}
  async forTutor(tutorId: string) { return [...this.store.values()].filter((b) => b.tutorId === tutorId); }
  async create(input: Omit<TutorAvailabilityBlock, "id">) {
    const block: TutorAvailabilityBlock = { ...input, id: randomUUID() };
    this.store.set(block.id, block);
    return block;
  }
  async remove(id: string) { this.store.delete(id); }
}

class InMemoryAttendanceRepository implements AttendanceRepository {
  // Keyed by `${lessonId}:${studentId}` — the natural composite key for "one record per Student
  // per Lesson" (plan section 38), without needing a synthetic id nothing else ever refers to.
  constructor(private readonly store: Map<string, LessonAttendanceRecord>) {}
  async forLesson(lessonId: string) {
    return [...this.store.values()].filter((r) => r.lessonId === lessonId);
  }
  async upsert(record: LessonAttendanceRecord) {
    this.store.set(`${record.lessonId}:${record.studentId}`, record);
    return record;
  }
}

class InMemoryActivityRepository implements ActivityRepository {
  constructor(private readonly store: Map<string, LessonActivityEvent>) {}
  async forLesson(lessonId: string) {
    return [...this.store.values()].filter((e) => e.lessonId === lessonId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async append(event: Omit<LessonActivityEvent, "id" | "createdAt">) {
    const full: LessonActivityEvent = { ...event, id: randomUUID(), createdAt: now() };
    this.store.set(full.id, full);
    return full;
  }
  async recent(limit: number) {
    return [...this.store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
}

class InMemoryNotificationRepository implements NotificationRepository {
  constructor(private readonly store: Map<string, Notification>, private readonly people: Array<Map<string, { userId?: string }>>) {}
  async forUser(userId: string) {
    return [...this.store.values()].filter((n) => n.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async unreadCountForUser(userId: string) {
    return [...this.store.values()].filter((n) => n.userId === userId && !n.read).length;
  }
  async create(input: Omit<Notification, "id" | "createdAt" | "read">) {
    const notification: Notification = { ...input, id: randomUUID(), read: false, createdAt: now() };
    this.store.set(notification.id, notification);
    return notification;
  }
  async markRead(id: string) {
    const existing = this.store.get(id);
    if (existing) this.store.set(id, { ...existing, read: true });
  }
  // A record made on a local server may carry its login. apps/web adds the development accounts (lib/data/provider.ts).
  async recipientFor(recordId: string) {
    return this.people.map((records) => records.get(recordId)?.userId).find(Boolean) ?? null;
  }
  async recipientsWithRole(): Promise<string[]> {
    return [];
  }
}

class InMemoryReportRepository implements ReportRepository {
  constructor(private readonly store: Map<string, LessonReport>, private readonly lessonStore: Map<string, Lesson>) {}
  async get(id: string) { return this.store.get(id) ?? null; }
  async forLesson(lessonId: string) {
    return [...this.store.values()].find((r) => r.lessonId === lessonId) ?? null;
  }
  async forStudent(studentId: string) {
    const lessonIds = new Set([...this.lessonStore.values()].filter((l) => l.studentIds.includes(studentId)).map((l) => l.id));
    return [...this.store.values()].filter((r) => lessonIds.has(r.lessonId));
  }
  async create(input: Omit<LessonReport, "id" | "createdAt" | "updatedAt">) {
    const timestamp = now();
    const report: LessonReport = { ...input, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp };
    this.store.set(report.id, report);
    return report;
  }
  async update(id: string, patch: Partial<Omit<LessonReport, "id" | "lessonId" | "tutorId" | "createdAt">>) {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`LessonReport ${id} not found`);
    const updated = { ...existing, ...patch, updatedAt: now() };
    this.store.set(id, updated);
    return updated;
  }
}

class InMemorySettingsRepository implements SettingsRepository {
  constructor(private settings: PlatformSettings) {}
  async get() { return this.settings; }
  async update(patch: Partial<PlatformSettings>) {
    this.settings = { ...this.settings, ...patch };
    return this.settings;
  }
}

const ARCHIVED_TUTOR: Tutor = { id: ARCHIVED_TUTOR_ID, name: "Former tutor", email: "", subjects: [], active: false, createdAt: new Date(0).toISOString() };

const stripName = (text: string | undefined, name: string): string | undefined => (text && name ? text.split(name).join("Student") : text);

class InMemoryPurgeRepository implements PurgeRepository {
  constructor(
    private readonly tutors: Map<string, Tutor>,
    private readonly clients: Map<string, Client>,
    private readonly students: Map<string, Student>,
    private readonly assignments: Map<string, TuitionAssignment>,
    private readonly lessons: Map<string, Lesson>,
    private readonly availability: Map<string, TutorAvailabilityBlock>,
    private readonly attendance: Map<string, LessonAttendanceRecord>,
    private readonly activity: Map<string, LessonActivityEvent>,
    private readonly reports: Map<string, LessonReport>,
    private readonly notifications: Map<string, Notification>,
    private readonly links: ClientStudentLink[],
    private readonly log: PurgeRecord[],
  ) {}

  private ofStudent(studentId: string) {
    const lessons = [...this.lessons.values()].filter((l) => l.studentIds.includes(studentId));
    const sole = lessons.filter((l) => l.studentIds.length === 1);
    const shared = lessons.filter((l) => l.studentIds.length > 1);
    const soleIds = new Set(sole.map((l) => l.id));
    const sharedIds = new Set(shared.map((l) => l.id));
    return {
      sole, shared, soleIds, sharedIds,
      attendance: [...this.attendance.values()].filter((r) => r.studentId === studentId),
      reportsRemoved: [...this.reports.values()].filter((r) => soleIds.has(r.lessonId)).length,
      reportsKept: [...this.reports.values()].filter((r) => sharedIds.has(r.lessonId)).length,
      assignments: [...this.assignments.values()].filter((a) => a.studentIds.includes(studentId)),
      guardianLinks: this.links.filter((l) => l.studentId === studentId).length,
    };
  }

  private items(pairs: Array<[string, number]>): PurgeItem[] {
    return pairs.filter(([, count]) => count > 0).map(([what, count]) => ({ what, count }));
  }

  /** Kept records are grouped by what they are, and a reason always survives: the preview must say why something stays. */
  private kept(items: PurgeKept[]): PurgeKept[] {
    const totals = new Map<string, { count: number; reason: string }>();
    for (const item of items) {
      const seen = totals.get(item.what);
      totals.set(item.what, { count: (seen?.count ?? 0) + item.count, reason: seen?.reason ?? item.reason });
    }
    return [...totals.entries()].filter(([, value]) => value.count > 0).map(([what, value]) => ({ what, count: value.count, reason: value.reason }));
  }

  async previewStudent(studentId: string): Promise<PurgePreview | null> {
    const student = this.students.get(studentId);
    if (!student) return null;
    const f = this.ofStudent(studentId);
    const logins = student.userId ? 1 : 0;
    const notifications = student.userId ? [...this.notifications.values()].filter((n) => n.userId === student.userId).length : 0;
    return {
      kind: "STUDENT",
      removes: this.items([
        ["Lessons that exist only for this student (with their attendance, report and timeline)", f.sole.length],
        ["Their attendance on lessons another student is still on", f.attendance.length],
        ["Reports on lessons only this student attended", f.reportsRemoved],
        ["Assignments they are on (removed from the assignment; an empty one is ended)", f.assignments.length],
        ["Guardian links", f.guardianLinks],
        ["Their learner login and its linked email", logins],
        ["Notifications", notifications],
        ["The student record", 1],
      ]),
      keeps: [
        ...(f.shared.length ? [{ what: "Lessons another student is still on (their name is taken out of the title and notes)", count: f.shared.length, reason: "Another child's record needs the lesson." }] : []),
        ...(f.reportsKept ? [{ what: "Reports on lessons another student is still on", count: f.reportsKept, reason: "The report covers a lesson another child still attends." }] : []),
      ] as PurgeKept[],
      profileIds: student.userId ? [student.userId] : [],
      files: [],
      notes: PURGE_NOTES,
    };
  }

  private removeStudent(studentId: string): Record<string, number> | null {
    const student = this.students.get(studentId);
    if (!student) return null;
    const f = this.ofStudent(studentId);
    const name = student.name;

    for (const lesson of f.shared) {
      this.lessons.set(lesson.id, { ...lesson, studentIds: lesson.studentIds.filter((id) => id !== studentId), title: stripName(lesson.title, name) ?? lesson.title, notes: stripName(lesson.notes, name), updatedAt: now() });
    }
    for (const lesson of f.sole) this.lessons.delete(lesson.id);
    for (const [key, record] of [...this.attendance.entries()]) if (record.studentId === studentId) this.attendance.delete(key);
    for (const [id, report] of [...this.reports.entries()]) if (f.soleIds.has(report.lessonId)) this.reports.delete(id);
    for (const [id, event] of [...this.activity.entries()]) {
      if (f.soleIds.has(event.lessonId)) this.activity.delete(id);
      else if (f.sharedIds.has(event.lessonId)) this.activity.set(id, { ...event, message: stripName(event.message, name) ?? event.message });
    }
    for (const [id, report] of [...this.reports.entries()]) {
      if (!f.sharedIds.has(report.lessonId)) continue;
      this.reports.set(id, {
        ...report,
        publicSummary: stripName(report.publicSummary, name) ?? report.publicSummary,
        progress: stripName(report.progress, name),
        areasForImprovement: stripName(report.areasForImprovement, name),
        nextSteps: stripName(report.nextSteps, name),
        internalTutorNotes: stripName(report.internalTutorNotes, name),
        updatedAt: now(),
      });
    }
    let assignmentsEnded = 0;
    for (const assignment of f.assignments) {
      const studentIds = assignment.studentIds.filter((id) => id !== studentId);
      if (studentIds.length === 0 && assignment.status !== "ENDED") assignmentsEnded += 1;
      this.assignments.set(assignment.id, {
        ...assignment,
        studentIds,
        // An assignment survives a purge (it is the parent of lessons a sibling may still have), so its free text is scrubbed the way a
        // shared lesson's is. The admin screen asks for a title like "GCSE Mathematics - Brian", so this is the normal case, not an edge one.
        title: stripName(assignment.title, name) ?? assignment.title,
        defaultLessonNotes: stripName(assignment.defaultLessonNotes, name),
        status: studentIds.length === 0 ? "ENDED" : assignment.status,
      });
    }
    const notifications = student.userId ? [...this.notifications.entries()].filter(([, n]) => n.userId === student.userId) : [];
    for (const [id] of notifications) this.notifications.delete(id);
    for (let i = this.links.length - 1; i >= 0; i -= 1) if (this.links[i]!.studentId === studentId) this.links.splice(i, 1);
    this.students.delete(studentId);

    return {
      lessonsRemoved: f.sole.length,
      lessonsKept: f.shared.length,
      attendanceRemoved: f.attendance.length,
      reportsRemoved: f.reportsRemoved,
      reportsKept: f.reportsKept,
      assignmentLinksRemoved: f.assignments.length,
      assignmentsEnded,
      guardianLinksRemoved: f.guardianLinks,
      loginsRemoved: student.userId ? 1 : 0,
      notificationsRemoved: notifications.length,
      chatsRemoved: 0,
      chatFilesRemoved: 0,
    };
  }

  async purgeStudent(studentId: string, actor: string): Promise<PurgeRecord | null> {
    const counts = this.removeStudent(studentId);
    if (!counts) return null;
    const record: PurgeRecord = { id: randomUUID(), kind: "STUDENT", actorId: actor, counts, at: now() };
    this.log.push(record);
    return record;
  }

  async previewTutor(tutorId: string): Promise<PurgePreview | null> {
    if (tutorId === ARCHIVED_TUTOR_ID) return null;
    const tutor = this.tutors.get(tutorId);
    if (!tutor) return null;
    const assignments = [...this.assignments.values()].filter((a) => a.tutorId === tutorId);
    const lessons = [...this.lessons.values()].filter((l) => l.tutorId === tutorId);
    const reports = [...this.reports.values()].filter((r) => r.tutorId === tutorId);
    const blocks = [...this.availability.values()].filter((b) => b.tutorId === tutorId);
    const notifications = tutor.userId ? [...this.notifications.values()].filter((n) => n.userId === tutor.userId).length : 0;
    return {
      kind: "TUTOR",
      removes: this.items([
        ["Tutor record", 1],
        ["Their login and its linked email", tutor.userId ? 1 : 0],
        ["Availability blocks", blocks.length],
        ["Notifications", notifications],
      ]),
      keeps: [
        ...(assignments.length ? [{ what: "Assignments they taught (moved to the archived tutor and ended)", count: assignments.length, reason: "A family's lesson history has to stay; the assignment is ended so nothing new is booked." }] : []),
        ...(lessons.length ? [{ what: "Lessons they taught (moved to the archived tutor so their name is gone)", count: lessons.length, reason: "Scheduling history for the students who attended." }] : []),
        ...(reports.length ? [{ what: "Reports they wrote (moved to the archived tutor)", count: reports.length, reason: "The report belongs to the student's record until that student is purged." }] : []),
      ] as PurgeKept[],
      profileIds: tutor.userId ? [tutor.userId] : [],
      files: [],
      notes: PURGE_NOTES,
    };
  }

  async purgeTutor(tutorId: string, actor: string): Promise<PurgeRecord | null> {
    if (tutorId === ARCHIVED_TUTOR_ID) return null;
    const tutor = this.tutors.get(tutorId);
    if (!tutor) return null;
    const assignments = [...this.assignments.values()].filter((a) => a.tutorId === tutorId);
    const lessons = [...this.lessons.values()].filter((l) => l.tutorId === tutorId);
    const reports = [...this.reports.values()].filter((r) => r.tutorId === tutorId);
    const blocks = [...this.availability.values()].filter((b) => b.tutorId === tutorId);
    const notifications = tutor.userId ? [...this.notifications.entries()].filter(([, n]) => n.userId === tutor.userId) : [];

    if (!this.tutors.has(ARCHIVED_TUTOR_ID)) this.tutors.set(ARCHIVED_TUTOR_ID, { ...ARCHIVED_TUTOR });
    for (const assignment of assignments) this.assignments.set(assignment.id, { ...assignment, tutorId: ARCHIVED_TUTOR_ID, status: "ENDED" });
    for (const lesson of lessons) this.lessons.set(lesson.id, { ...lesson, tutorId: ARCHIVED_TUTOR_ID, updatedAt: now() });
    for (const report of reports) this.reports.set(report.id, { ...report, tutorId: ARCHIVED_TUTOR_ID, updatedAt: now() });
    for (const block of blocks) this.availability.delete(block.id);
    for (const [id] of notifications) this.notifications.delete(id);
    this.tutors.delete(tutorId);

    const record: PurgeRecord = {
      id: randomUUID(), kind: "TUTOR", actorId: actor, at: now(),
      counts: {
        assignmentsEnded: assignments.length,
        lessonsAnonymised: lessons.length,
        reportsAnonymised: reports.length,
        availabilityBlocksRemoved: blocks.length,
        notificationsRemoved: notifications.length,
        loginsRemoved: tutor.userId ? 1 : 0,
      },
    };
    this.log.push(record);
    return record;
  }

  async previewFamily(clientId: string): Promise<PurgePreview | null> {
    const client = this.clients.get(clientId);
    if (!client) return null;
    const studentIds = this.links.filter((l) => l.clientId === clientId).map((l) => l.studentId);
    const children = (await Promise.all(studentIds.map((id) => this.previewStudent(id)))).filter((p): p is PurgePreview => Boolean(p));
    const sum = (items: Array<{ what: string; count: number }>) => {
      const totals = new Map<string, number>();
      for (const item of items) totals.set(item.what, (totals.get(item.what) ?? 0) + item.count);
      return this.items([...totals.entries()]);
    };
    const notifications = client.userId ? [...this.notifications.values()].filter((n) => n.userId === client.userId).length : 0;
    return {
      kind: "FAMILY",
      removes: [
        ...sum(children.flatMap((c) => c.removes)),
        ...this.items([["The family account", 1], ["The parent's login and its linked email", client.userId ? 1 : 0], ["Notifications", notifications]]),
      ],
      keeps: this.kept(children.flatMap((c) => c.keeps)),
      profileIds: [...new Set([...children.flatMap((c) => c.profileIds), ...(client.userId ? [client.userId] : [])])],
      files: children.flatMap((c) => c.files),
      notes: PURGE_NOTES,
    };
  }

  async purgeFamily(clientId: string, actor: string): Promise<PurgeRecord | null> {
    const client = this.clients.get(clientId);
    if (!client) return null;
    const studentIds = [...new Set(this.links.filter((l) => l.clientId === clientId).map((l) => l.studentId))];
    const totals: Record<string, number> = {};
    for (const id of studentIds) {
      const counts = this.removeStudent(id);
      if (!counts) continue;
      for (const [key, value] of Object.entries(counts)) totals[key] = (totals[key] ?? 0) + value;
    }
    const notifications = client.userId ? [...this.notifications.entries()].filter(([, n]) => n.userId === client.userId) : [];
    for (const [id] of notifications) this.notifications.delete(id);
    for (let i = this.links.length - 1; i >= 0; i -= 1) if (this.links[i]!.clientId === clientId) this.links.splice(i, 1);
    this.clients.delete(clientId);

    const record: PurgeRecord = {
      id: randomUUID(), kind: "FAMILY", actorId: actor, at: now(),
      counts: {
        ...totals,
        familiesRemoved: 1,
        parentNotificationsRemoved: notifications.length,
        loginsRemoved: (totals.loginsRemoved ?? 0) + (client.userId ? 1 : 0),
      },
    };
    this.log.push(record);
    return record;
  }

  async recent(limit: number): Promise<PurgeRecord[]> {
    return [...this.log].sort((a, b) => b.at.localeCompare(a.at)).slice(0, Math.min(Math.max(Math.trunc(limit), 0), 500));
  }
}

function seedProvider(): DataProvider {
  const tutorStore = new Map<string, Tutor>();
  const clientStore = new Map<string, Client>();
  const studentStore = new Map<string, Student>();
  const assignmentStore = new Map<string, TuitionAssignment>();
  const lessonStore = new Map<string, Lesson>();
  const availabilityStore = new Map<string, TutorAvailabilityBlock>();
  const attendanceStore = new Map<string, LessonAttendanceRecord>();
  const activityStore = new Map<string, LessonActivityEvent>();
  const reportStore = new Map<string, LessonReport>();
  const notificationStore = new Map<string, Notification>();
  const purgeStore: PurgeRecord[] = [];
  const links: ClientStudentLink[] = [];

  // The tutor record of the development administrator who teaches (apps/web lib/dev/accounts.ts).
  tutorStore.set(SEED_IDS.tutorMeeraShah, {
    id: SEED_IDS.tutorMeeraShah, name: "Meera Shah", email: "teaching-admin@learnthrive.dev", subjects: ["English"], active: true, createdAt: now(),
  });
  tutorStore.set(SEED_IDS.tutorJamiePatel, {
    id: SEED_IDS.tutorJamiePatel, name: "Tahasin Hasan", email: "tutor@learnthrive.dev",
    subjects: ["Mathematics"], active: true, createdAt: now(),
  });
  clientStore.set(SEED_IDS.clientSarahAhmed, {
    id: SEED_IDS.clientSarahAhmed, name: "Abdurrahman Mustafa", email: "client@learnthrive.dev",
    active: true, createdAt: now(),
  });
  studentStore.set(SEED_IDS.studentAyaanAhmed, {
    id: SEED_IDS.studentAyaanAhmed, name: "Brian James Khalawon", yearGroup: "Year 10",
    active: true, createdAt: now(),
  });
  links.push({ clientId: SEED_IDS.clientSarahAhmed, studentId: SEED_IDS.studentAyaanAhmed });
  assignmentStore.set(SEED_IDS.assignmentGcseMaths, {
    id: SEED_IDS.assignmentGcseMaths, title: "GCSE Mathematics — Brian", subject: "Mathematics", level: "GCSE",
    tutorId: SEED_IDS.tutorJamiePatel, studentIds: [SEED_IDS.studentAyaanAhmed], clientIds: [SEED_IDS.clientSarahAhmed],
    status: "ACTIVE", defaultDurationMinutes: 60, defaultLocationType: "ONLINE", createdAt: now(),
  });

  // A weekly Tuesday 16:00-18:00 availability window and a Thursday half-day, in the
  // scheduling default timezone (Europe/London — see apps/web/src/lib/scheduling/timezone.ts).
  availabilityStore.set(SEED_IDS.availabilityTuesday, {
    id: SEED_IDS.availabilityTuesday, tutorId: SEED_IDS.tutorJamiePatel, type: "AVAILABLE",
    weekday: 2, startTime: "16:00", endTime: "18:00",
  });
  availabilityStore.set(SEED_IDS.availabilityThursday, {
    id: SEED_IDS.availabilityThursday, tutorId: SEED_IDS.tutorJamiePatel, type: "AVAILABLE",
    weekday: 4, startTime: "09:00", endTime: "13:00",
  });

  // One completed lesson (in the past) and one planned lesson (in the future) — plan section 89's
  // "several upcoming/completed lessons" for the demo scenario, kept to two since a from-scratch
  // in-memory seed doesn't need more to exercise every status/timing code path meaningfully.
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const nextTuesday = (() => {
    const d = new Date();
    d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7));
    d.setHours(16, 0, 0, 0);
    return d.toISOString();
  })();
  lessonStore.set(SEED_IDS.lessonCompleted, {
    id: SEED_IDS.lessonCompleted, assignmentId: SEED_IDS.assignmentGcseMaths, tutorId: SEED_IDS.tutorJamiePatel,
    studentIds: [SEED_IDS.studentAyaanAhmed], clientIds: [SEED_IDS.clientSarahAhmed],
    title: "GCSE Mathematics — Brian", subject: "Mathematics", startAt: oneWeekAgo, durationMinutes: 60,
    locationType: "ONLINE", reportRequired: true, status: "COMPLETED", createdAt: oneWeekAgo, updatedAt: oneWeekAgo,
  });
  lessonStore.set(SEED_IDS.lessonUpcoming, {
    id: SEED_IDS.lessonUpcoming, assignmentId: SEED_IDS.assignmentGcseMaths, tutorId: SEED_IDS.tutorJamiePatel,
    studentIds: [SEED_IDS.studentAyaanAhmed], clientIds: [SEED_IDS.clientSarahAhmed],
    title: "GCSE Mathematics — Brian", subject: "Mathematics", startAt: nextTuesday, durationMinutes: 60,
    locationType: "ONLINE", reportRequired: true, status: "PLANNED", createdAt: now(), updatedAt: now(),
    classroomRoomId: SEED_IDS.classroomRoomUpcoming,
  });

  // Plan section 89's "one approved report" — attached to the one completed seed lesson, since a
  // report on a lesson that hasn't happened yet wouldn't make sense as demo data.
  reportStore.set(SEED_IDS.reportApproved, {
    id: SEED_IDS.reportApproved, lessonId: SEED_IDS.lessonCompleted, tutorId: SEED_IDS.tutorJamiePatel, status: "APPROVED",
    publicSummary: "We covered simultaneous equations and practised exam-style questions.",
    progress: "Brian is much more confident solving by substitution.",
    areasForImprovement: "Still working on elimination method for trickier pairs.",
    nextSteps: "Complete the worksheet on page 42 before next lesson.",
    engagement: "HIGH", confidence: "MEDIUM",
    internalTutorNotes: "Brian seemed tired today — worth checking in with Abdurrahman about workload.",
    submittedAt: oneWeekAgo, approvedAt: oneWeekAgo,
    createdAt: oneWeekAgo, updatedAt: oneWeekAgo,
  });

  return {
    tutors: new InMemoryTutorRepository(tutorStore),
    clients: new InMemoryClientRepository(clientStore),
    students: new InMemoryStudentRepository(studentStore, clientStore, links),
    assignments: new InMemoryAssignmentRepository(assignmentStore),
    lessons: new InMemoryLessonRepository(lessonStore),
    availability: new InMemoryAvailabilityRepository(availabilityStore),
    attendance: new InMemoryAttendanceRepository(attendanceStore),
    activity: new InMemoryActivityRepository(activityStore),
    reports: new InMemoryReportRepository(reportStore, lessonStore),
    settings: new InMemorySettingsRepository({ requireReportApproval: true }),
    notifications: new InMemoryNotificationRepository(notificationStore, [tutorStore, clientStore, studentStore]),
    purges: new InMemoryPurgeRepository(
      tutorStore, clientStore, studentStore, assignmentStore, lessonStore, availabilityStore, attendanceStore, activityStore, reportStore,
      notificationStore, links, purgeStore,
    ),
  };
}

// Fast-Refresh-survival singleton, same reasoning as apps/web/src/lib/auth's stores — the whole
// point of this seed data is to be there consistently across dev-server file edits, not reset
// every time someone saves a file.
const globalForData = globalThis as unknown as { __learnthriveDataProvider?: DataProvider };
export function getDataProvider(): DataProvider {
  if (!globalForData.__learnthriveDataProvider) globalForData.__learnthriveDataProvider = seedProvider();
  return globalForData.__learnthriveDataProvider;
}

// Plan section 98: a deliberate development-only way to discard whatever's accumulated during a
// working session (extra people, lessons, reports, notifications created while testing) and
// return to the fixed demo scenario — without restarting the whole dev server. Re-seeding uses
// the same fixed SEED_IDS every time, so anything cross-referencing them (e.g. devProvider.ts's
// AuthenticatedUser.profileId values) stays valid across a reset; only records created beyond
// the seed scenario are lost, which is the point. See the guarded route at
// apps/web/src/app/api/dev/reset/route.ts for why this is never reachable outside development.
export function resetDataProvider(): DataProvider {
  globalForData.__learnthriveDataProvider = seedProvider();
  return globalForData.__learnthriveDataProvider;
}
