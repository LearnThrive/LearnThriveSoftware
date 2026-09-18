import { randomUUID } from "node:crypto";
import type {
  Client, ClientStudentLink, Lesson, LessonActivityEvent, LessonAttendanceRecord, Student, TuitionAssignment, Tutor, TutorAvailabilityBlock,
} from "./domain";
import type {
  ActivityRepository, AssignmentRepository, AttendanceRepository, AvailabilityRepository, ClientRepository, DataProvider, LessonRepository,
  StudentRepository, TutorRepository,
} from "./repositories";

// Fixed, well-known ids for the seeded demo people (plan section 89's scenario) — not random,
// so apps/web's auth seed (devProvider.ts) can set matching AuthenticatedUser.profileId values
// and the two seed systems stay cross-referenced deterministically rather than by coincidence.
export const SEED_IDS = {
  tutorJamiePatel: "tutor-jamie-patel",
  clientSarahAhmed: "client-sarah-ahmed",
  studentAyaanAhmed: "student-ayaan-ahmed",
  assignmentGcseMaths: "assignment-gcse-maths-ayaan",
  availabilityTuesday: "availability-jamie-tuesday",
  availabilityThursday: "availability-jamie-thursday",
  lessonCompleted: "lesson-gcse-maths-completed",
  lessonUpcoming: "lesson-gcse-maths-upcoming",
  classroomRoomUpcoming: "classroom-room-gcse-maths-upcoming",
} as const;

function now() {
  return new Date().toISOString();
}

class InMemoryTutorRepository implements TutorRepository {
  constructor(private readonly store: Map<string, Tutor>) {}
  async list() { return [...this.store.values()]; }
  async get(id: string) { return this.store.get(id) ?? null; }
  async getByUserId(userId: string) { return [...this.store.values()].find((t) => t.userId === userId) ?? null; }
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
  const links: ClientStudentLink[] = [];

  tutorStore.set(SEED_IDS.tutorJamiePatel, {
    id: SEED_IDS.tutorJamiePatel, name: "Jamie Patel", email: "tutor@learnthrive.dev",
    subjects: ["Mathematics"], active: true, createdAt: now(),
  });
  clientStore.set(SEED_IDS.clientSarahAhmed, {
    id: SEED_IDS.clientSarahAhmed, name: "Sarah Ahmed", email: "client@learnthrive.dev",
    active: true, createdAt: now(),
  });
  studentStore.set(SEED_IDS.studentAyaanAhmed, {
    id: SEED_IDS.studentAyaanAhmed, name: "Ayaan Ahmed", yearGroup: "Year 10",
    active: true, createdAt: now(),
  });
  links.push({ clientId: SEED_IDS.clientSarahAhmed, studentId: SEED_IDS.studentAyaanAhmed });
  assignmentStore.set(SEED_IDS.assignmentGcseMaths, {
    id: SEED_IDS.assignmentGcseMaths, title: "GCSE Mathematics — Ayaan", subject: "Mathematics", level: "GCSE",
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
    title: "GCSE Mathematics — Ayaan", subject: "Mathematics", startAt: oneWeekAgo, durationMinutes: 60,
    locationType: "ONLINE", reportRequired: true, status: "COMPLETED", createdAt: oneWeekAgo, updatedAt: oneWeekAgo,
  });
  lessonStore.set(SEED_IDS.lessonUpcoming, {
    id: SEED_IDS.lessonUpcoming, assignmentId: SEED_IDS.assignmentGcseMaths, tutorId: SEED_IDS.tutorJamiePatel,
    studentIds: [SEED_IDS.studentAyaanAhmed], clientIds: [SEED_IDS.clientSarahAhmed],
    title: "GCSE Mathematics — Ayaan", subject: "Mathematics", startAt: nextTuesday, durationMinutes: 60,
    locationType: "ONLINE", reportRequired: true, status: "PLANNED", createdAt: now(), updatedAt: now(),
    classroomRoomId: SEED_IDS.classroomRoomUpcoming,
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
