import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 11 feature A2: a student's progress timeline shows what the person could already see on the
// lesson pages and nothing more.

const { getDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { studentProgressFor } = loadTsFrom(import.meta.url, "../src/lib/dashboard/progress.ts");

const tag = () => crypto.randomUUID().slice(0, 8);

async function world() {
  const data = getDataProvider();
  const t = tag();
  const tutorA = await data.tutors.create({ name: `Tutor A ${t}`, email: `a-${t}@example.test`, subjects: ["Maths"], active: true });
  const tutorB = await data.tutors.create({ name: `Tutor B ${t}`, email: `b-${t}@example.test`, subjects: ["English"], active: true });
  const studentA = await data.students.create({ name: `Student A ${t}`, active: true });
  const studentB = await data.students.create({ name: `Student B ${t}`, active: true });
  const clientA = await data.clients.create({ name: `Client A ${t}`, email: `ca-${t}@example.test`, active: true });
  const clientB = await data.clients.create({ name: `Client B ${t}`, email: `cb-${t}@example.test`, active: true });
  await data.students.linkClient(clientA.id, studentA.id);
  await data.students.linkClient(clientB.id, studentB.id);

  const lesson = async (tutor, student, client, title, startAt, status = "COMPLETED") => {
    const assignment = await data.assignments.create({ title, subject: "Maths", tutorId: tutor.id, studentIds: [student.id], clientIds: [client.id], status: "ACTIVE" });
    return data.lessons.create({
      assignmentId: assignment.id, tutorId: tutor.id, studentIds: [student.id], clientIds: [client.id], title, subject: "Maths",
      startAt, durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status,
    });
  };
  const approvedLesson = await lesson(tutorA, studentA, clientA, `Approved lesson ${t}`, "2026-09-01T16:00:00.000Z");
  const draftLesson = await lesson(tutorA, studentA, clientA, `Draft lesson ${t}`, "2026-09-08T16:00:00.000Z");
  const cancelledLesson = await lesson(tutorA, studentA, clientA, `Cancelled lesson ${t}`, "2026-09-15T16:00:00.000Z", "CANCELLED");
  const futureLesson = await lesson(tutorA, studentA, clientA, `Future lesson ${t}`, "2099-01-01T16:00:00.000Z", "PLANNED");
  const lessonB = await lesson(tutorB, studentB, clientB, `Other family lesson ${t}`, "2026-09-02T16:00:00.000Z");

  await data.reports.create({
    lessonId: approvedLesson.id, tutorId: tutorA.id, status: "APPROVED", publicSummary: `Fractions summary ${t}`, progress: "Good progress", nextSteps: "Decimals next",
    areasForImprovement: "Showing working", engagement: "HIGH", internalTutorNotes: `PRIVATE walrus ${t}`, confidence: "LOW",
    submittedAt: "2026-09-01T18:00:00.000Z", approvedAt: "2026-09-02T09:00:00.000Z",
  });
  await data.reports.create({
    lessonId: draftLesson.id, tutorId: tutorA.id, status: "DRAFT", publicSummary: `Draft summary ${t}`, internalTutorNotes: `PRIVATE draft note ${t}`,
  });
  await data.reports.create({
    lessonId: lessonB.id, tutorId: tutorB.id, status: "APPROVED", publicSummary: `Other family report ${t}`, internalTutorNotes: `PRIVATE other ${t}`,
    submittedAt: "2026-09-02T18:00:00.000Z", approvedAt: "2026-09-03T09:00:00.000Z",
  });

  const user = (role, profileId) => ({ id: `u-${role}-${profileId ?? "x"}`, email: "x@example.test", role, name: role, profileId });
  return {
    data, t, studentA, studentB, approvedLesson, draftLesson, cancelledLesson, futureLesson, lessonB,
    admin: user("ADMIN"),
    tutorA: user("TUTOR", tutorA.id), tutorB: user("TUTOR", tutorB.id),
    clientA: user("CLIENT", clientA.id), clientB: user("CLIENT", clientB.id),
    studentAUser: user("STUDENT", studentA.id),
  };
}

test("a Parent sees their child's timeline: approved report text only, newest first, cancelled lessons left out", async () => {
  const w = await world();
  const progress = await studentProgressFor(w.data, w.clientA, w.studentA.id);
  assert.ok(progress);
  assert.equal(progress.student.id, w.studentA.id);
  assert.deepEqual(progress.entries.map((e) => e.lessonId), [w.futureLesson.id, w.draftLesson.id, w.approvedLesson.id]);
  assert.ok(!progress.entries.some((e) => e.lessonId === w.cancelledLesson.id), "a cancelled lesson is not part of the learning");
  const approved = progress.entries.find((e) => e.lessonId === w.approvedLesson.id);
  assert.match(approved.report.publicSummary, /Fractions summary/);
  assert.equal(approved.report.nextSteps, "Decimals next");
  assert.equal(approved.report.engagement, "HIGH");
  const draft = progress.entries.find((e) => e.lessonId === w.draftLesson.id);
  assert.equal(draft.report, null, "a draft report is invisible to a Parent");
  assert.equal(progress.entries.find((e) => e.upcoming).lessonId, w.futureLesson.id);
  assert.equal(progress.completedCount, 2);
  assert.equal(progress.reportCount, 1);
});

test("a student that is not the person's own is null, which the page turns into a 404", async () => {
  const w = await world();
  assert.equal(await studentProgressFor(w.data, w.clientA, w.studentB.id), null, "Parent A asked for family B's child");
  assert.equal(await studentProgressFor(w.data, w.clientB, w.studentA.id), null);
  assert.equal(await studentProgressFor(w.data, w.tutorB, w.studentA.id), null, "an unassigned Tutor asked for the student");
  assert.equal(await studentProgressFor(w.data, w.studentAUser, w.studentB.id), null, "a Student asked for another Student");
  assert.equal(await studentProgressFor(w.data, w.clientA, "no-such-student"), null);
  assert.equal(await studentProgressFor(w.data, w.clientA, ""), null);
});

test("a Student sees only themselves; a Tutor their own student; an Admin anyone", async () => {
  const w = await world();
  assert.ok(await studentProgressFor(w.data, w.studentAUser, w.studentA.id));
  assert.ok(await studentProgressFor(w.data, w.tutorA, w.studentA.id));
  assert.ok(await studentProgressFor(w.data, w.admin, w.studentA.id));
  assert.ok(await studentProgressFor(w.data, w.admin, w.studentB.id));
});

test("the Tutor and the Admin see the draft and submitted reports (they own or oversee them)", async () => {
  const w = await world();
  for (const who of [w.tutorA, w.admin]) {
    const progress = await studentProgressFor(w.data, who, w.studentA.id);
    const draft = progress.entries.find((e) => e.lessonId === w.draftLesson.id);
    assert.equal(draft.report?.status, "DRAFT", who.role);
  }
});

test("no role ever receives a private tutor note or the tutor-only confidence rating", async () => {
  const w = await world();
  for (const who of [w.clientA, w.studentAUser, w.tutorA, w.admin]) {
    const text = JSON.stringify(await studentProgressFor(w.data, who, w.studentA.id));
    assert.doesNotMatch(text, /PRIVATE|walrus/, `${who.role} received an internal note`);
    assert.doesNotMatch(text, /internalTutorNotes|confidence/, `${who.role} received a tutor-only field name`);
  }
});

test("another family's lessons and reports never appear in a timeline", async () => {
  const w = await world();
  for (const who of [w.clientA, w.studentAUser, w.tutorA]) {
    const text = JSON.stringify(await studentProgressFor(w.data, who, w.studentA.id));
    assert.doesNotMatch(text, /Other family/, `${who.role} saw family B's data`);
  }
});

test("a role with no linked profile gets nothing", async () => {
  const w = await world();
  for (const role of ["TUTOR", "CLIENT", "STUDENT"]) {
    assert.equal(await studentProgressFor(w.data, { id: "o", email: "o@example.test", role, name: "O" }, w.studentA.id), null, role);
  }
});
