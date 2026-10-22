/**
 * One behavioural contract for the tuition domain provider (DataProvider), run against the in-memory development provider and the
 * Postgres provider on PGlite (and the real local stack). Records are made by the tests themselves (never the development seed), and
 * assertions are about THOSE records, so a provider may hold others.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DataProvider } from "../repositories";

export interface DataHarness {
  provider: DataProvider;
  /** A family: an adult account holder and their client record. */
  family(name?: string): Promise<{ clientId: string; userId: string }>;
  /** A login (an auth profile) the records can point at: a tutor's login, a notification recipient, an approver. */
  login(): Promise<string>;
  /**
   * True when the provider derives the families on an assignment or lesson from the students' ACTIVE guardian links at read time (the
   * Postgres provider). The in-memory development provider stores the family ids the caller gives it.
   */
  derivesFamilies: boolean;
}

const START = "2026-11-02T16:00:00.000Z";
const addMinutes = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

export function dataProviderContract(name: string, make: () => Promise<{ harness: DataHarness; close(): Promise<void> }>): void {
  describe(`domain provider contract: ${name}`, () => {
    let h: DataHarness;
    let close: () => Promise<void>;
    let p: DataProvider;

    const tutor = async (label = "Tutor") => p.tutors.create({ name: label, email: `${label.toLowerCase().replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2)}@example.test`, subjects: ["Maths"], active: true });
    const student = async (clientId: string, label = "Kid") => {
      const s = await p.students.create({ name: label, active: true, ...({ clientId } as object) });
      await p.students.linkClient(clientId, s.id);
      return s;
    };
    /** The families who pay for these students, as the admin screen works them out before it saves. */
    const familiesOf = async (studentIds: string[]) => [...new Set((await Promise.all(studentIds.map((id) => p.students.clientsFor(id)))).flat().map((c) => c.id))];
    const assignment = async (tutorId: string, studentIds: string[], over: Record<string, unknown> = {}) =>
      p.assignments.create({ title: "GCSE Maths", subject: "Maths", tutorId, studentIds, clientIds: await familiesOf(studentIds), status: "ACTIVE", defaultDurationMinutes: 60, defaultLocationType: "ONLINE", ...over });
    const lesson = async (a: { id: string; tutorId: string; studentIds: string[] }, over: Record<string, unknown> = {}) =>
      p.lessons.create({
        assignmentId: a.id, tutorId: a.tutorId, studentIds: a.studentIds, clientIds: await familiesOf(a.studentIds), title: "Algebra", subject: "Maths", startAt: START, durationMinutes: 60, locationType: "ONLINE" as const,
        reportRequired: true, status: "PLANNED" as const, ...over,
      });

    test("setup", async () => {
      ({ harness: h, close } = await make());
      p = h.provider;
    });

    test("tutors: create, read, update, find by login", async () => {
      const login = await h.login();
      const t = await p.tutors.create({ userId: login, name: "Ms Patel", email: "patel@example.test", subjects: ["Maths", "Physics"], active: true });
      assert.ok(t.id && t.createdAt);
      assert.equal((await p.tutors.get(t.id))?.name, "Ms Patel");
      assert.equal((await p.tutors.getByUserId(login))?.id, t.id);
      assert.deepEqual((await p.tutors.get(t.id))?.subjects, ["Maths", "Physics"]);
      const updated = await p.tutors.update(t.id, { subjects: ["Maths"], active: false });
      assert.deepEqual([updated.subjects, updated.active, updated.name], [["Maths"], false, "Ms Patel"], "a patch keeps what it does not name");
      assert.ok((await p.tutors.list()).some((x) => x.id === t.id));
      assert.equal(await p.tutors.get("00000000-0000-4000-8000-000000000000"), null);
      assert.equal(await p.tutors.getByUserId("00000000-0000-4000-8000-000000000000"), null);
      await assert.rejects(() => p.tutors.update("00000000-0000-4000-8000-000000000000", { name: "x" }), /not found/);
      const noLogin = await p.tutors.create({ name: "No Login", email: "nologin@example.test", subjects: [], active: true });
      assert.equal((await p.tutors.get(noLogin.id))?.email, "nologin@example.test", "a tutor without a login keeps a contact address");
      assert.equal((await p.tutors.get(noLogin.id))?.userId, undefined);
    });

    test("families and students: a student belongs to a family, links are many to many, and an ended link stops counting", async () => {
      const a = await h.family("Alpha");
      const b = await h.family("Beta");
      const ava = await student(a.clientId, "Ava");
      const ben = await student(b.clientId, "Ben");
      assert.equal((await p.students.get(ava.id))?.name, "Ava");
      assert.equal((await p.clients.get(a.clientId))?.id, a.clientId);
      assert.equal((await p.clients.getByUserId(a.userId))?.id, a.clientId);
      assert.deepEqual((await p.students.studentsFor(a.clientId)).map((s) => s.id), [ava.id]);
      assert.deepEqual((await p.students.clientsFor(ava.id)).map((c) => c.id), [a.clientId]);
      // A second guardian (shared custody) and a second child.
      await p.students.linkClient(b.clientId, ava.id);
      await p.students.linkClient(b.clientId, ava.id);
      assert.deepEqual((await p.students.clientsFor(ava.id)).map((c) => c.id).sort(), [a.clientId, b.clientId].sort());
      assert.equal((await p.students.allLinks()).filter((l) => l.studentId === ava.id).length, 2);
      await p.students.unlinkClient(b.clientId, ava.id);
      assert.deepEqual((await p.students.clientsFor(ava.id)).map((c) => c.id), [a.clientId], "the second guardian is gone");
      assert.deepEqual((await p.students.studentsFor(b.clientId)).map((s) => s.id), [ben.id]);
      const updated = await p.students.update(ava.id, { yearGroup: "Year 9" });
      assert.equal(updated.yearGroup, "Year 9");
      assert.equal(updated.name, "Ava");
      assert.equal(await p.students.get("00000000-0000-4000-8000-000000000000"), null);
      assert.equal(await p.clients.get("00000000-0000-4000-8000-000000000000"), null);
    });

    test("assignments: the families on one are exactly those who pay for its students, found by tutor, student and client", async () => {
      const a = await h.family("A");
      const b = await h.family("B");
      const ava = await student(a.clientId, "Ava");
      const ben = await student(b.clientId, "Ben");
      const t = await tutor("Assign");
      const group = await assignment(t.id, [ava.id, ben.id], { level: "GCSE" });
      assert.deepEqual(group.studentIds.sort(), [ava.id, ben.id].sort());
      assert.deepEqual([...group.clientIds].sort(), [a.clientId, b.clientId].sort());
      assert.equal(group.level, "GCSE");
      assert.equal(group.defaultDurationMinutes, 60);
      assert.deepEqual((await p.assignments.forTutor(t.id)).map((x) => x.id), [group.id]);
      assert.ok((await p.assignments.forStudent(ava.id)).some((x) => x.id === group.id));
      assert.ok((await p.assignments.forClient(a.clientId)).some((x) => x.id === group.id));
      assert.equal((await p.assignments.forClient(a.clientId)).filter((x) => x.id !== group.id).length, 0);
      const ended = await p.assignments.update(group.id, { status: "ENDED" });
      assert.deepEqual([ended.status, ended.title, ended.subject], ["ENDED", "GCSE Maths", "Maths"], "ending keeps the rest");
      assert.equal((await p.assignments.get(group.id))?.status, "ENDED");
      const changed = await p.assignments.update(group.id, { studentIds: [ava.id], clientIds: [a.clientId] });
      assert.deepEqual(changed.studentIds, [ava.id]);
      assert.deepEqual(changed.clientIds, [a.clientId], "a student taken off an assignment takes their family with them");
      await assert.rejects(() => p.assignments.update("00000000-0000-4000-8000-000000000000", { status: "PAUSED" }), /not found/);
      assert.equal(await p.assignments.get("00000000-0000-4000-8000-000000000000"), null);
    });

    test("a guardian link that has been ended removes that family from the assignments and lessons it was on", async (t0) => {
      if (!h.derivesFamilies) return void t0.skip("this provider stores the family ids it is given");
      const a = await h.family("Owner");
      const second = await h.family("Second");
      const ava = await student(a.clientId, "Ava");
      await p.students.linkClient(second.clientId, ava.id);
      const t = await tutor("Link");
      const asg = await assignment(t.id, [ava.id]);
      const lesson = await p.lessons.create({ assignmentId: asg.id, tutorId: asg.tutorId, studentIds: asg.studentIds, clientIds: [], title: "Algebra", subject: "Maths", startAt: START, durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "PLANNED" });
      assert.ok((await p.lessons.get(lesson.id))!.clientIds.includes(second.clientId));
      assert.ok((await p.assignments.forClient(second.clientId)).some((x) => x.id === asg.id));
      await p.students.unlinkClient(second.clientId, ava.id);
      assert.equal((await p.lessons.get(lesson.id))!.clientIds.includes(second.clientId), false);
      assert.equal((await p.assignments.forClient(second.clientId)).length, 0);
      assert.equal((await p.lessons.forClient(second.clientId)).length, 0);
      assert.ok((await p.lessons.forClient(a.clientId)).some((l) => l.id === lesson.id), "the owning family keeps it");
    });

    test("lessons: create, read by tutor, student, client and series, update, and the overlap check", async () => {
      const f = await h.family("Lessons");
      const ava = await student(f.clientId, "Ava");
      const ben = await student(f.clientId, "Ben");
      const t = await tutor("Lesson");
      const other = await tutor("Other");
      const asg = await assignment(t.id, [ava.id]);
      const asg2 = await assignment(other.id, [ben.id]);
      const recurrenceId = "11111111-1111-4111-8111-111111111111";
      const first = await lesson(asg, { recurrenceId, notes: "Quadratics" });
      assert.ok(first.id && first.createdAt && first.updatedAt);
      assert.deepEqual([first.studentIds, first.clientIds, first.notes, first.recurrenceId], [[ava.id], [f.clientId], "Quadratics", recurrenceId]);
      const families = await familiesOf(asg.studentIds);
      const base = { assignmentId: asg.id, tutorId: asg.tutorId, studentIds: asg.studentIds, clientIds: families, title: "Algebra", subject: "Maths", durationMinutes: 60, locationType: "ONLINE" as const, reportRequired: true, status: "PLANNED" as const, recurrenceId };
      const [second, third] = await p.lessons.createMany([{ ...base, startAt: addMinutes(START, 7 * 24 * 60) }, { ...base, startAt: addMinutes(START, 14 * 24 * 60) }]);
      assert.deepEqual((await p.lessons.forRecurrence(recurrenceId)).map((l) => l.id), [first.id, second!.id, third!.id], "a series in time order");
      assert.deepEqual((await p.lessons.forTutor(t.id)).map((l) => l.id), [first.id, second!.id, third!.id]);
      assert.equal((await p.lessons.forStudent(ben.id)).length, 0);
      assert.equal((await p.lessons.forClient(f.clientId)).length, 3);

      // Overlap: a half-open interval, for the tutor or the student, ignoring cancelled lessons and the lesson being moved.
      const during = { startAt: addMinutes(START, 30), durationMinutes: 60 };
      assert.deepEqual((await p.lessons.overlapping({ tutorId: t.id, ...during })).map((l) => l.id), [first.id]);
      assert.deepEqual((await p.lessons.overlapping({ studentId: ava.id, ...during })).map((l) => l.id), [first.id]);
      assert.equal((await p.lessons.overlapping({ tutorId: t.id, startAt: addMinutes(START, 60), durationMinutes: 60 })).length, 0, "back to back is not an overlap");
      assert.equal((await p.lessons.overlapping({ tutorId: other.id, ...during })).length, 0);
      assert.equal((await p.lessons.overlapping({ tutorId: t.id, ...during, excludeLessonId: first.id })).length, 0, "moving a lesson ignores itself");
      const cancelled = await p.lessons.update(first.id, { status: "CANCELLED", cancelledAt: addMinutes(START, -60), cancellationReason: "Ill" });
      assert.deepEqual([cancelled.status, cancelled.cancellationReason], ["CANCELLED", "Ill"]);
      assert.equal((await p.lessons.overlapping({ tutorId: t.id, ...during })).length, 0, "a cancelled lesson does not block the slot");
      const moved = await p.lessons.update(second!.id, { startAt: addMinutes(START, 2 * 24 * 60), durationMinutes: 45 });
      assert.deepEqual([moved.startAt, moved.durationMinutes, moved.title], [addMinutes(START, 2 * 24 * 60), 45, "Algebra"]);
      assert.ok(moved.updatedAt >= second!.updatedAt);
      assert.equal((await p.lessons.update(second!.id, { studentIds: [ava.id, ben.id] })).studentIds.length, 2);
      assert.ok((await p.lessons.forStudent(ben.id)).some((l) => l.id === second!.id));
      assert.equal(await p.lessons.get("00000000-0000-4000-8000-000000000000"), null);
      await assert.rejects(() => p.lessons.update("00000000-0000-4000-8000-000000000000", { title: "x" }), /not found/);
      void asg2;
    });

    test("availability blocks, attendance (one record per student per lesson), and the append-only activity timeline", async () => {
      const f = await h.family("Att");
      const ava = await student(f.clientId, "Ava");
      const ben = await student(f.clientId, "Ben");
      const t = await tutor("Att");
      const asg = await assignment(t.id, [ava.id, ben.id]);
      const lessonRow = await lesson(asg);
      const marker = await h.login();

      const block = await p.availability.create({ tutorId: t.id, type: "AVAILABLE", weekday: 2, startTime: "16:00", endTime: "20:00" });
      await p.availability.create({ tutorId: t.id, type: "UNAVAILABLE", weekday: 2, startTime: "18:00", endTime: "18:30" });
      assert.deepEqual((await p.availability.forTutor(t.id)).map((b) => [b.type, b.weekday, b.startTime, b.endTime]), [["AVAILABLE", 2, "16:00", "20:00"], ["UNAVAILABLE", 2, "18:00", "18:30"]]);
      await p.availability.remove(block.id);
      assert.equal((await p.availability.forTutor(t.id)).length, 1);

      await p.attendance.upsert({ lessonId: lessonRow.id, studentId: ava.id, status: "ATTENDED", markedBy: marker, markedAt: START });
      await p.attendance.upsert({ lessonId: lessonRow.id, studentId: ben.id, status: "ABSENT", notes: "Ill", markedBy: marker, markedAt: START });
      await p.attendance.upsert({ lessonId: lessonRow.id, studentId: ava.id, status: "LATE", arrivalTime: addMinutes(START, 10), markedBy: marker, markedAt: addMinutes(START, 11) });
      const records = await p.attendance.forLesson(lessonRow.id);
      assert.equal(records.length, 2, "marking again replaces, never appends");
      assert.deepEqual(records.find((r) => r.studentId === ava.id)?.status, "LATE");
      assert.equal(records.find((r) => r.studentId === ava.id)?.arrivalTime, addMinutes(START, 10));
      assert.equal(records.find((r) => r.studentId === ben.id)?.notes, "Ill");

      const e1 = await p.activity.append({ lessonId: lessonRow.id, type: "CREATED", message: "Created", actorId: marker });
      await new Promise((r) => setTimeout(r, 5));
      const e2 = await p.activity.append({ lessonId: lessonRow.id, type: "ATTENDANCE_MARKED", message: "Marked" });
      assert.deepEqual((await p.activity.forLesson(lessonRow.id)).map((e) => e.id), [e1.id, e2.id], "oldest first");
      assert.equal(e2.actorId, undefined, "a system event has no actor");
      assert.equal((await p.activity.recent(1))[0]?.id, e2.id, "recent: newest first, capped");
    });

    test("reports: one per lesson, kept as written, found by student; the settings default can be changed", async () => {
      const f = await h.family("Rep");
      const ava = await student(f.clientId, "Ava");
      const t = await tutor("Rep");
      const asg = await assignment(t.id, [ava.id]);
      const lessonRow = await lesson(asg);
      const approver = await h.login();
      const draft = await p.reports.create({ lessonId: lessonRow.id, tutorId: t.id, status: "DRAFT", publicSummary: "Good", internalTutorNotes: "Needs a push", confidence: "MEDIUM" });
      assert.equal(draft.internalTutorNotes, "Needs a push");
      assert.equal((await p.reports.forLesson(lessonRow.id))?.id, draft.id);
      assert.equal((await p.reports.get(draft.id))?.publicSummary, "Good");
      const submitted = await p.reports.update(draft.id, { status: "SUBMITTED", submittedAt: START, progress: "Quadratics", engagement: "HIGH" });
      assert.deepEqual([submitted.status, submitted.progress, submitted.engagement, submitted.internalTutorNotes], ["SUBMITTED", "Quadratics", "HIGH", "Needs a push"], "a patch keeps what it does not name");
      const approved = await p.reports.update(draft.id, { status: "APPROVED", approvedAt: addMinutes(START, 60), approvedBy: approver });
      assert.deepEqual([approved.status, approved.approvedBy], ["APPROVED", approver]);
      assert.deepEqual((await p.reports.forStudent(ava.id)).map((r) => r.id), [draft.id]);
      assert.equal(await p.reports.forLesson("00000000-0000-4000-8000-000000000000"), null);
      await assert.rejects(() => p.reports.update("00000000-0000-4000-8000-000000000000", { status: "APPROVED" }), /not found/);

      const before = await p.settings.get();
      const flipped = await p.settings.update({ requireReportApproval: !before.requireReportApproval });
      assert.equal(flipped.requireReportApproval, !before.requireReportApproval);
      assert.equal((await p.settings.get()).requireReportApproval, !before.requireReportApproval);
      await p.settings.update({ requireReportApproval: before.requireReportApproval });
    });

    test("notifications: per recipient, newest first, unread counted, marked read", async () => {
      const me = await h.login();
      const you = await h.login();
      const n1 = await p.notifications.create({ userId: me, type: "LESSON_REMINDER", message: "Soon", link: "/dashboard/lessons/x" });
      await new Promise((r) => setTimeout(r, 5));
      const n2 = await p.notifications.create({ userId: me, type: "REPORT_AVAILABLE", message: "Report" });
      await p.notifications.create({ userId: you, type: "SCHEDULING_CONFLICT", message: "Not yours" });
      assert.deepEqual((await p.notifications.forUser(me)).map((n) => n.id), [n2.id, n1.id]);
      assert.equal(n1.read, false);
      assert.equal(n1.link, "/dashboard/lessons/x");
      assert.equal(await p.notifications.unreadCountForUser(me), 2);
      await p.notifications.markRead(n1.id);
      assert.equal(await p.notifications.unreadCountForUser(me), 1);
      assert.equal((await p.notifications.forUser(you)).length, 1, "another person's are untouched");
      await p.notifications.markRead("00000000-0000-4000-8000-000000000000");
    });

    test("teardown", async () => {
      await close();
    });
  });
}
