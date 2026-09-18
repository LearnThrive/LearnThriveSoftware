import { randomUUID } from "node:crypto";
import type { Client, ClientStudentLink, Student, TuitionAssignment, Tutor } from "./domain";
import type { AssignmentRepository, ClientRepository, DataProvider, StudentRepository, TutorRepository } from "./repositories";

// Fixed, well-known ids for the seeded demo people (plan section 89's scenario) — not random,
// so apps/web's auth seed (devProvider.ts) can set matching AuthenticatedUser.profileId values
// and the two seed systems stay cross-referenced deterministically rather than by coincidence.
export const SEED_IDS = {
  tutorJamiePatel: "tutor-jamie-patel",
  clientSarahAhmed: "client-sarah-ahmed",
  studentAyaanAhmed: "student-ayaan-ahmed",
  assignmentGcseMaths: "assignment-gcse-maths-ayaan",
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

function seedProvider(): DataProvider {
  const tutorStore = new Map<string, Tutor>();
  const clientStore = new Map<string, Client>();
  const studentStore = new Map<string, Student>();
  const assignmentStore = new Map<string, TuitionAssignment>();
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

  return {
    tutors: new InMemoryTutorRepository(tutorStore),
    clients: new InMemoryClientRepository(clientStore),
    students: new InMemoryStudentRepository(studentStore, clientStore, links),
    assignments: new InMemoryAssignmentRepository(assignmentStore),
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
