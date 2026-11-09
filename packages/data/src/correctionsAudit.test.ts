// Correcting a person's record is audited (migration 0023): WHO changed WHICH fields of WHOSE record, never the old or the new value.
// The same assertions on the in-memory store and on Postgres (PGlite).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { InMemoryLibraryStore, SqlLibraryStore, type LibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { createFamily } from "./testing/fixtures";
import { createTestDb } from "./testing/pglite";

interface Harness {
  store: LibraryStore;
  ids(): Promise<{ admin: string; studentId: string; clientId: string; tutorId: string; removeTutor: (() => Promise<void>) | null }>;
  close(): Promise<void>;
}

function suite(name: string, make: () => Promise<Harness>): void {
  describe(`corrections audit: ${name}`, () => {
    test("a correction to a student and to a tutor is recorded with the field names only", async () => {
      const h = await make();
      try {
        const { admin, studentId, clientId, tutorId, removeTutor } = await h.ids();
        const now = new Date("2026-11-09T10:00:00Z");
        await h.store.identity.recordAudit({ actor: admin, action: "student_details_changed", clientId, studentId, fields: ["name", "yearGroup"], now });
        await h.store.identity.recordAudit({ actor: admin, action: "tutor_details_changed", tutorId, fields: ["email"], now });

        const student = await h.store.identity.auditFor(studentId);
        assert.equal(student[0]?.action, "student_details_changed");
        assert.deepEqual(student[0]?.fields, ["name", "yearGroup"]);
        assert.equal(student[0]?.actorProfileId, admin);

        const tutor = await h.store.identity.auditForTutor(tutorId);
        assert.deepEqual(tutor.map((a) => [a.action, a.fields]), [["tutor_details_changed", ["email"]]]);
        assert.equal((await h.store.identity.auditFor(studentId)).some((a) => a.action === "tutor_details_changed"), false, "a tutor's correction is not on a student's trail");
        assert.deepEqual(await h.store.identity.auditForTutor(randomUUID()), []);

        // An entry written the old way (no fields) still reads back, with no fields.
        await h.store.identity.recordAudit({ actor: admin, action: "linked_email_changed", clientId, studentId, now });
        assert.equal((await h.store.identity.auditFor(studentId))[0]?.fields, undefined);

        // When the tutor's record goes (a purge), the audit row stays but no longer points at them.
        if (removeTutor) {
          await removeTutor();
          assert.deepEqual(await h.store.identity.auditForTutor(tutorId), []);
        }
      } finally {
        await h.close();
      }
    });
  });
}

suite("in-memory", async () => {
  const store = new InMemoryLibraryStore();
  return {
    store,
    close: async () => {},
    ids: async () => {
      const tutorId = randomUUID();
      return {
        admin: randomUUID(), studentId: randomUUID(), clientId: randomUUID(), tutorId,
        // The foreign key that clears the pointer is Postgres's; the in-memory purge rewrites its own rows (the purge contract covers it).
        removeTutor: null,
      };
    },
  };
});

suite("sql on PGlite", async () => {
  const db = await createTestDb();
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) };
  return {
    store: new SqlLibraryStore(executor),
    close: () => db.close(),
    ids: async () => {
      const family = await createFamily(db, { name: "Family", students: ["Kid"] });
      const tutor = await createSqlDataProvider(executor).tutors.create({ name: "Tutor", email: "t@example.test", subjects: [], active: true });
      const admin = await db.createUser({ displayName: "Admin", adult: true });
      return {
        admin, studentId: family.studentIds[0]!, clientId: family.clientId, tutorId: tutor.id,
        removeTutor: async () => { await executor.query("delete from public.tutors where id = $1", [tutor.id]); },
      };
    },
  };
});

describe("migration 0023 on Postgres (PGlite)", () => {
  test("the lesson timeline accepts REPORT_RETURNED, and an assignment's approval override can be cleared back to null", async () => {
    const db = await createTestDb();
    try {
      const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) };
      const data = createSqlDataProvider(executor);
      const family = await createFamily(db, { name: "Family", students: ["Kid"] });
      const tutor = await data.tutors.create({ name: "Tutor", email: "t2@example.test", subjects: [], active: true });
      const assignment = await data.assignments.create({ title: "Maths", subject: "Maths", tutorId: tutor.id, studentIds: family.studentIds, clientIds: [family.clientId], status: "ACTIVE", requireReportApproval: false });
      const lesson = await data.lessons.create({
        assignmentId: assignment.id, tutorId: tutor.id, studentIds: family.studentIds, clientIds: [family.clientId], title: "Algebra", subject: "Maths",
        startAt: "2026-10-06T16:00:00Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "COMPLETED",
      } as never);

      const event = await data.activity.append({ lessonId: lesson.id, type: "REPORT_RETURNED", message: "Lesson report sent back for changes: add the homework" });
      assert.equal(event.type, "REPORT_RETURNED");
      await assert.rejects(data.activity.append({ lessonId: lesson.id, type: "REPORT_SHREDDED" as never, message: "x" }), "an unknown event type is still refused");

      assert.equal((await data.assignments.get(assignment.id))?.requireReportApproval, false);
      await data.assignments.update(assignment.id, { requireReportApproval: null });
      assert.equal((await data.assignments.get(assignment.id))?.requireReportApproval ?? null, null, "cleared: the platform setting applies again");
      await data.assignments.update(assignment.id, { requireReportApproval: true });
      assert.equal((await data.assignments.get(assignment.id))?.requireReportApproval, true);
    } finally {
      await db.close();
    }
  });
});
