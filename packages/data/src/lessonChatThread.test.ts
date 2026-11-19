import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createLessonChatService, createSqlFileStore, createSqlLessonChatRepository, allowAllScanner, DEFAULT_LESSON_CHAT_CONFIG, type ChatActor, type ChatLesson } from "./lessonChat";
import { createSqlDataProvider } from "./sqlProvider";
import { createFamily } from "./testing/fixtures";
import { createTestDb, type TestDb } from "./testing/pglite";

// Migration 0029: one weekly lesson is one assignment with a lesson row per week, and its chat (and files) is ONE conversation across them.
describe("lesson chat carries over between the occurrences of one assignment (Postgres, on PGlite)", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) };
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
  const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");

  test("a message and a pdf sent in one lesson are read, and opened, in the next one; another assignment sees neither", async () => {
    const p = createSqlDataProvider(executor);
    const tutorUser = await db.createUser({ displayName: "Tutor", adult: true, role: "TUTOR" });
    const tutor = await p.tutors.create({ userId: tutorUser, name: "Tutor", email: "", subjects: [], active: true });
    const fam = await createFamily(db, { name: "Alpha", students: ["Alpha child"] });
    const learner = await db.createUser({ displayName: "Alpha child", adult: false, role: "STUDENT" });
    await executor.query(`insert into public.learner_identities (student_id, profile_id) values ($1, $2)`, [fam.studentIds[0], learner]);
    const studentId = fam.studentIds[0]!;
    const mk = async (assignmentId: string, startAt: string) => p.lessons.create({ assignmentId, tutorId: tutor.id, studentIds: [studentId], clientIds: [fam.clientId], title: "Maths", subject: "Maths", startAt, durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "PLANNED" });
    const assignment = await p.assignments.create({ title: "Maths", subject: "Maths", tutorId: tutor.id, studentIds: [studentId], clientIds: [fam.clientId], status: "ACTIVE" });
    const other = await p.assignments.create({ title: "English", subject: "English", tutorId: tutor.id, studentIds: [studentId], clientIds: [fam.clientId], status: "ACTIVE" });
    const week1 = await mk(assignment.id, minutes(-10));
    const week2 = await mk(assignment.id, minutes(7 * 24 * 60));
    const english = await mk(other.id, minutes(7 * 24 * 60));

    const chatLesson = (l: { id: string; assignmentId: string; tutorId: string; studentIds: string[]; clientIds: string[]; startAt: string; durationMinutes: number; status: string }): ChatLesson => ({ id: l.id, threadId: l.assignmentId, tutorId: l.tutorId, studentIds: l.studentIds, clientIds: l.clientIds, startAt: l.startAt, durationMinutes: l.durationMinutes, status: l.status });
    const service = createLessonChatService({
      lessons: { get: async (id) => { const l = await p.lessons.get(id); return l ? chatLesson(l as never) : null; } },
      repo: createSqlLessonChatRepository(executor),
      files: createSqlFileStore(executor),
      scanner: allowAllScanner,
      config: DEFAULT_LESSON_CHAT_CONFIG,
      otherTypes: { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", gif: "image/gif", csv: "text/csv" },
      urlSecret: "x".repeat(40),
    });
    const tutorActor: ChatActor = { accountId: tutorUser, name: "Tutor", roles: ["TUTOR"], tutorId: tutor.id, studentId: null, clientId: null, isSafeguardingLead: false };
    const studentActor: ChatActor = { accountId: learner, name: "Alpha child", roles: ["STUDENT"], tutorId: null, studentId, clientId: null, isSafeguardingLead: false };

    const said = await service.sendText(tutorActor, week1.id, "Bring your homework next week");
    assert.ok(said.ok, JSON.stringify(said));
    const sent = await service.sendFile(tutorActor, week1.id, { name: "worksheet.pdf", declaredType: "application/pdf", bytes: pdf });
    assert.ok(sent.ok, JSON.stringify(sent));

    // Other document and image types are stored and read back too (migration 0030): a Word file and a gif, as downloads.
    const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    const word = await service.sendFile(tutorActor, week1.id, { name: "notes.docx", declaredType: "", bytes: docx });
    assert.ok(word.ok, JSON.stringify(word));
    const gif = await service.sendFile(tutorActor, week1.id, { name: "diagram.gif", declaredType: "image/gif", bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]) });
    assert.ok(gif.ok, JSON.stringify(gif));
    for (const [name, bytes] of [["run.exe", new Uint8Array([1, 2, 3])], ["fake.csv", new Uint8Array([0x4d, 0x5a, 0x90, 0])], ["noext", new Uint8Array([1])]] as const) {
      const refused = await service.sendFile(tutorActor, week1.id, { name, declaredType: "", bytes });
      assert.equal(refused.ok, false, name);
    }

    // Next week's lesson shows the same conversation, and the student can open the file from it.
    const next = await service.list(studentActor, week2.id);
    assert.ok(next.ok);
    assert.deepEqual(next.messages.map((m) => m.text || m.file?.displayName), ["Bring your homework next week", "worksheet.pdf", "notes.docx", "diagram.gif"]);
    const wordRead = next.messages[2]!.file!;
    const wordUrl = new URL(wordRead.url, "http://x");
    const wordOpened = await service.openFile(studentActor, week2.id, wordRead.id, { u: wordUrl.searchParams.get("u")!, exp: wordUrl.searchParams.get("exp")!, sig: wordUrl.searchParams.get("sig")! });
    assert.ok(wordOpened.ok);
    assert.deepEqual([...wordOpened.bytes], [...docx]);
    const url = new URL(next.messages[1]!.file!.url, "http://x");
    assert.ok(url.pathname.startsWith(`/api/lessons/${week2.id}/files/`));
    const opened = await service.openFile(studentActor, week2.id, next.messages[1]!.file!.id, { u: url.searchParams.get("u")!, exp: url.searchParams.get("exp")!, sig: url.searchParams.get("sig")! });
    assert.ok(opened.ok);
    assert.deepEqual([...opened.bytes], [...pdf]);

    // A different assignment is a different conversation, and its lesson cannot open this thread's file.
    const unrelated = await service.list(studentActor, english.id);
    assert.ok(unrelated.ok);
    assert.equal(unrelated.messages.length, 0);
    const wrong = await service.openFile(studentActor, english.id, next.messages[1]!.file!.id, { u: studentActor.accountId, exp: String(Date.now() + 60_000), sig: "bad" });
    assert.equal(wrong.ok, false);

    // Sending is still only during that week's own lesson.
    const early = await service.sendText(tutorActor, week2.id, "too early");
    assert.equal(early.ok, false);
  });
});
