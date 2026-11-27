import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { createFamily } from "./testing/fixtures";
import { createTestDb, type TestDb } from "./testing/pglite";

// Migration 0027 (lesson chat) on PGlite, in-process: what the DATABASE refuses by itself, and who row-level security lets read. The web app checks
// first (lessonChat.test.ts); these prove the second lock holds when the application is bypassed. Nothing here touches a live project.

describe("lesson chat in Postgres (migration 0027, on PGlite)", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const owner = <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params));
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => owner<T>(sql, params) };
  const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

  /** Two lessons for two families and two tutors, each with a student who has their own learner login, plus an administrator and a junior tutor. */
  async function world() {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const tutorUser = await db.createUser({ displayName: "Tutor", adult: true, role: "TUTOR" });
    const juniorUser = await db.createUser({ displayName: "Junior", adult: true, role: "JUNIOR_TUTOR" });
    const tutor = await p.tutors.create({ userId: tutorUser, name: "Tutor", email: "", subjects: [], active: true });
    const juniorTutor = await p.tutors.create({ userId: juniorUser, name: "Junior", email: "", subjects: [], active: true });
    const adminUser = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });

    const family = async (name: string) => {
      const f = await createFamily(db, { name, students: [`${name} child`] });
      const learner = await db.createUser({ displayName: `${name} child`, adult: false, role: "STUDENT" });
      await owner(`insert into public.learner_identities (student_id, profile_id) values ($1, $2)`, [f.studentIds[0], learner]);
      return { ...f, learner, studentId: f.studentIds[0]! };
    };
    const a = await family("Alpha");
    const b = await family("Bravo");

    const lessonFor = async (tutorId: string, f: { studentId: string; clientId: string }, startAt: string, status = "PLANNED") => {
      const assignment = await p.assignments.create({ title: "Maths", subject: "Maths", tutorId, studentIds: [f.studentId], clientIds: [f.clientId], status: "ACTIVE" });
      return p.lessons.create({ assignmentId: assignment.id, tutorId, studentIds: [f.studentId], clientIds: [f.clientId], title: "Maths", subject: "Maths", startAt, durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: status as "PLANNED" });
    };
    const now = await lessonFor(tutor.id, a, minutes(-10)); // on now
    const bLesson = await lessonFor(tutor.id, b, minutes(-10));
    const juniorLesson = await lessonFor(juniorTutor.id, a, minutes(-10));
    const cancelled = await lessonFor(tutor.id, a, minutes(-10), "CANCELLED");
    const future = await lessonFor(tutor.id, a, minutes(300));
    const past = await lessonFor(tutor.id, a, minutes(-300));
    void store;
    return { p, tutorUser, juniorUser, adminUser, tutor, juniorTutor, a, b, now, bLesson, juniorLesson, cancelled, future, past };
  }

  const send = (lessonId: string, profile: string, party: "tutor" | "student" | "admin", record: string, body = "hello") =>
    owner<{ id: string }>(`insert into public.lesson_messages (lesson_id, sender_profile_id, sender_party, sender_record_id, sender_name, body) values ($1, $2, $3, $4, 'Someone', $5) returning id`, [lessonId, profile, party, record, body]);

  test("the lesson's tutor and an enrolled student can add a message, and the time stored is the database's", async () => {
    const w = await world();
    const t = await send(w.now.id, w.tutorUser, "tutor", w.tutor.id);
    const s = await send(w.now.id, w.a.learner, "student", w.a.studentId);
    assert.equal(t.length + s.length, 2);
    const row = await owner<{ created_at: Date }>(`select created_at from public.lesson_messages where id = $1`, [t[0]!.id]);
    assert.ok(Math.abs(row[0]!.created_at.getTime() - Date.now()) < 60_000);
    // A back-dated value is overwritten.
    const forged = await owner<{ id: string }>(`insert into public.lesson_messages (lesson_id, sender_profile_id, sender_party, sender_record_id, sender_name, created_at) values ($1, $2, 'tutor', $3, 'T', '2001-01-01') returning id`, [w.now.id, w.tutorUser, w.tutor.id]);
    const stored = await owner<{ created_at: Date }>(`select created_at from public.lesson_messages where id = $1`, [forged[0]!.id]);
    assert.ok(stored[0]!.created_at.getFullYear() >= 2025, "created_at cannot be back-dated");
  });

  test("refused by the database: a cancelled lesson, an unassigned tutor, another family's student, a junior tutor", async () => {
    const w = await world();
    await assert.rejects(() => send(w.cancelled.id, w.tutorUser, "tutor", w.tutor.id), /cancelled lesson has no chat/);
    // The lesson's tutor is the record AND the person: a different tutor's login, or a different record, is refused.
    const otherTutorUser = await db.createUser({ displayName: "Other", adult: true, role: "TUTOR" });
    await assert.rejects(() => send(w.now.id, otherTutorUser, "tutor", w.tutor.id), /Only the lesson's tutor/);
    await assert.rejects(() => send(w.now.id, w.tutorUser, "tutor", w.juniorTutor.id), /Only the lesson's tutor/);
    // A student of another lesson, and a login claiming to be a student it is not.
    await assert.rejects(() => send(w.now.id, w.b.learner, "student", w.b.studentId), /enrolled in this lesson/);
    await assert.rejects(() => send(w.now.id, w.b.learner, "student", w.a.studentId), /enrolled in this lesson/);
    // The junior tutor's own lesson: the tutor record is theirs, but they hold JUNIOR_TUTOR and not TUTOR.
    await assert.rejects(() => send(w.juniorLesson.id, w.juniorUser, "tutor", w.juniorTutor.id), /Only the lesson's tutor/);
    // A parent's login cannot be a sender.
    await assert.rejects(() => send(w.now.id, w.a.userId, "student", w.a.studentId), /enrolled in this lesson/);
    assert.equal((await owner(`select 1 from public.lesson_messages where lesson_id = any($1::uuid[])`, [[w.cancelled.id, w.future.id, w.past.id, w.juniorLesson.id]])).length, 0);
  });

  test("migration 0032: an administrator may send as an administrator at any time, as themself, on a lesson that is not cancelled", async () => {
    const w = await world();
    for (const lesson of [w.now, w.future, w.past, w.bLesson]) assert.equal((await send(lesson.id, w.adminUser, "admin", w.adminUser)).length, 1);
    const row = await owner<{ sender_party: string }>(`select sender_party from public.lesson_messages where lesson_id = $1 and sender_profile_id = $2`, [w.past.id, w.adminUser]);
    assert.equal(row[0]!.sender_party, "admin");
    await assert.rejects(() => send(w.cancelled.id, w.adminUser, "admin", w.adminUser), /cancelled lesson has no chat/);
    // Not an administrator, or an administrator claiming to be somebody else.
    await assert.rejects(() => send(w.now.id, w.tutorUser, "admin", w.tutorUser), /Only an administrator/);
    await assert.rejects(() => send(w.now.id, w.a.learner, "admin", w.a.learner), /Only an administrator/);
    await assert.rejects(() => send(w.now.id, w.adminUser, "admin", w.tutorUser), /Only an administrator/);
    await assert.rejects(() => owner(`insert into public.lesson_messages (lesson_id, sender_profile_id, sender_party, sender_record_id, sender_name) values ($1, $2, 'parent', $2, 'X')`, [w.now.id, w.adminUser]), /./, "no other party exists");
  });

  test("migration 0035: the lesson's tutor and an enrolled student may send before and after the lesson, and a notification may say so", async () => {
    const w = await world();
    for (const lesson of [w.future, w.past]) {
      assert.equal((await send(lesson.id, w.tutorUser, "tutor", w.tutor.id)).length, 1);
      assert.equal((await send(lesson.id, w.a.learner, "student", w.a.studentId)).length, 1);
    }
    await w.p.notifications.create({ userId: w.tutorUser, type: "LESSON_MESSAGE", message: "A message", link: "/dashboard/lessons" });
  });

  test("a message is never edited or deleted: only an administrator's removal may mark it, once", async () => {
    const w = await world();
    const id = (await send(w.now.id, w.tutorUser, "tutor", w.tutor.id, "original"))[0]!.id;
    await assert.rejects(() => owner(`update public.lesson_messages set body = 'edited' where id = $1`, [id]), /never edited/);
    await assert.rejects(() => owner(`update public.lesson_messages set lesson_id = $2 where id = $1`, [id, w.bLesson.id]), /never edited/);
    await assert.rejects(() => owner(`delete from public.lesson_messages where id = $1`, [id]), /never deleted|are never deleted/);
    await assert.rejects(() => owner(`update public.lesson_messages set removed_at = now(), removed_by = $2, removal_reason = 'x' where id = $1`, [id, w.tutorUser]), /Only an administrator removes/);
    await assert.rejects(() => owner(`update public.lesson_messages set removed_at = now(), removed_by = $2 where id = $1`, [id, w.adminUser]), /check|violat/i, "a reason is required");
    await owner(`update public.lesson_messages set removed_at = now(), removed_by = $2, removal_reason = 'Not appropriate' where id = $1`, [id, w.adminUser]);
    await assert.rejects(() => owner(`update public.lesson_messages set removal_reason = 'again' where id = $1`, [id]), /already removed/);
    const row = await owner<{ body: string; removal_reason: string }>(`select body, removal_reason from public.lesson_messages where id = $1`, [id]);
    assert.deepEqual(row[0], { body: "original", removal_reason: "Not appropriate" }, "kept, marked");
  });

  test("a purge may still go: deleting a lesson takes its messages and file records with it, and a purged person only has their id cleared", async () => {
    const w = await world();
    const id = (await send(w.bLesson.id, w.tutorUser, "tutor", w.tutor.id))[0]!.id;
    await owner(`insert into public.lesson_files (lesson_id, message_id, storage_key, content_type, size_bytes, display_name, uploaded_by) values ($1, $2, $3, 'image/png', 10, 'a.png', $4)`, [w.bLesson.id, id, `lessons/${w.bLesson.id}/11111111-1111-4111-8111-111111111111.png`, w.tutorUser]);
    await owner(`update public.lesson_messages set sender_profile_id = null where id = $1`, [id]);
    await owner(`update public.lesson_files set uploaded_by = null where message_id = $1`, [id]);
    await owner(`delete from public.lessons where id = $1`, [w.bLesson.id]);
    assert.equal((await owner(`select 1 from public.lesson_messages where id = $1`, [id])).length, 0);
    assert.equal((await owner(`select 1 from public.lesson_files where message_id = $1`, [id])).length, 0);
  });

  test("a file record: its own lesson only, a generated key only, a plain display name only; and it is append-only", async () => {
    const w = await world();
    const id = (await send(w.now.id, w.a.learner, "student", w.a.studentId))[0]!.id;
    const insert = (over: Partial<{ lesson: string; key: string; type: string; size: number; name: string }> = {}) =>
      owner(`insert into public.lesson_files (lesson_id, message_id, storage_key, content_type, size_bytes, display_name) values ($1, $2, $3, $4, $5, $6)`, [over.lesson ?? w.now.id, id, over.key ?? `lessons/${w.now.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`, over.type ?? "image/png", over.size ?? 100, over.name ?? "diagram.png"]);
    await assert.rejects(() => insert({ lesson: w.bLesson.id }), /belongs to the lesson of its message/);
    await assert.rejects(() => insert({ key: "../../etc/passwd" }), /check|violat/i);
    await assert.rejects(() => insert({ key: `lessons/${w.now.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.exe` }), /check|violat/i);
    await assert.rejects(() => insert({ type: "text/html" }), /check|violat/i);
    await assert.rejects(() => insert({ size: 26214401 }), /check|violat/i);
    await assert.rejects(() => insert({ size: 0 }), /check|violat/i);
    for (const bad of ["../a.png", "a/b.png", "a\\b.png", "c:a.png", ""]) await assert.rejects(() => insert({ name: bad }), /check|violat/i, bad);
    await insert();
    await assert.rejects(() => owner(`update public.lesson_files set display_name = 'x.png' where message_id = $1`, [id]), /append-only/);
    await assert.rejects(() => owner(`delete from public.lesson_files where message_id = $1`, [id]), /never deleted/);
  });

  test("the access log is append-only", async () => {
    const w = await world();
    const row = await owner<{ id: string }>(`insert into public.lesson_chat_access_log (lesson_id, actor_profile_id, actor_kind, action) values ($1, $2, 'admin', 'read_messages') returning id`, [w.now.id, w.adminUser]);
    await assert.rejects(() => owner(`update public.lesson_chat_access_log set action = 'read_file' where id = $1`, [row[0]!.id]), /append-only/);
    await assert.rejects(() => owner(`delete from public.lesson_chat_access_log where id = $1`, [row[0]!.id]), /append-only/);
    await assert.rejects(() => owner(`insert into public.lesson_chat_access_log (lesson_id, actor_kind, action) values ($1, 'tutor', 'read_messages')`, [w.now.id]), /check|violat/i);
    await owner(`update public.lesson_chat_access_log set actor_profile_id = null where id = $1`, [row[0]!.id]); // a purged person: the one allowed change
  });

  test("row-level security: participants read their lesson; a parent only after it ends; nobody else; no API role writes; administrators read through the server", async () => {
    const w = await world();
    const mine = (await send(w.now.id, w.tutorUser, "tutor", w.tutor.id, "mine"))[0]!.id;
    const removed = (await send(w.now.id, w.a.learner, "student", w.a.studentId, "removed one"))[0]!.id;
    await owner(`update public.lesson_messages set removed_at = now(), removed_by = $2, removal_reason = 'x' where id = $1`, [removed, w.adminUser]);
    await send(w.bLesson.id, w.tutorUser, "tutor", w.tutor.id, "bravo family's");
    const read = (user: string | null) => (user === null ? db.asAnon((q) => q.query<{ body: string }>(`select body from public.lesson_messages order by body`)) : db.asUser(user, (q) => q.query<{ body: string }>(`select body from public.lesson_messages order by body`)));

    assert.deepEqual((await read(w.tutorUser)).map((r) => r.body), ["bravo family's", "mine"], "the tutor: both of their lessons, and not the removed message");
    assert.deepEqual((await read(w.a.learner)).map((r) => r.body), ["mine"], "an enrolled student: their lesson only, and not the removed message");
    assert.deepEqual((await read(w.b.learner)).map((r) => r.body), ["bravo family's"], "another student: only theirs");
    assert.deepEqual(await read(w.a.userId), [], "a parent: not while the lesson is on");
    assert.deepEqual(await read(w.adminUser), [], "an administrator reads through the server, where every read is audited: there is no policy for them");
    assert.deepEqual(await read(w.juniorUser), [], "a junior tutor of another lesson");
    await assert.rejects(() => read(null), /permission denied/i, "signed out");

    // The lesson ends: the parent of that family (and only that family) can now read it.
    await owner(`update public.lessons set start_at = now() - interval '3 hours' where id = $1`, [w.now.id]);
    assert.deepEqual((await read(w.a.userId)).map((r) => r.body), ["mine"], "after the lesson, the parent of the student on it");
    assert.deepEqual((await read(w.b.userId)).map((r) => r.body), [], "the other family's parent still sees nothing of Alpha's (and Bravo's lesson is still on)");

    // Nobody writes through the API, whatever they are.
    for (const user of [w.tutorUser, w.a.learner, w.a.userId, w.adminUser]) {
      await assert.rejects(() => db.asUser(user, (q) => q.query(`insert into public.lesson_messages (lesson_id, sender_party, sender_record_id, sender_name) values ($1, 'tutor', $2, 'x')`, [w.now.id, w.tutor.id])), /permission denied/i);
      await assert.rejects(() => db.asUser(user, (q) => q.query(`update public.lesson_messages set body = 'x'`)), /permission denied/i);
      await assert.rejects(() => db.asUser(user, (q) => q.query(`delete from public.lesson_messages`)), /permission denied/i);
      await assert.rejects(() => db.asUser(user, (q) => q.query(`select * from public.lesson_chat_access_log`)), /permission denied/i, "the log is the server's");
    }
    void mine;
  });
});
