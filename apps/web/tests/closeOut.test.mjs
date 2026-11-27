import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const { getDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { lessonsToCloseOut, closeOutLesson, CloseOutError } = loadTsFrom(import.meta.url, "../src/lib/lessons/closeOut.ts");
const { staysOpen } = loadTsFrom(import.meta.url, "../src/lib/lessons/closeOutGate.ts");
const { lessonBucketsFor, nextLessonForStudent } = loadTsFrom(import.meta.url, "../src/lib/dashboard/queries.ts");

const NOW = new Date("2026-03-10T20:00:00.000Z");
const FULL = { publicSummary: "Fractions.", progress: "Good.", areasForImprovement: "Decimals.", nextSteps: "Sheet 3.", engagement: "HIGH", confidence: "MEDIUM" };

async function world(role = "TUTOR") {
  const data = getDataProvider();
  const tutor = await data.tutors.create({ name: "Close Tutor", email: `t-${crypto.randomUUID()}@example.test`, subjects: ["Maths"], active: true });
  const student = await data.students.create({ name: "Close Student", active: true });
  const assignment = await data.assignments.create({ title: "Maths", subject: "Maths", tutorId: tutor.id, studentIds: [student.id], clientIds: [], status: "ACTIVE" });
  const lesson = (startAt, extra = {}) => data.lessons.create({
    assignmentId: assignment.id, tutorId: tutor.id, studentIds: [student.id], clientIds: [], title: "Maths", subject: "Maths",
    startAt, durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "PLANNED", ...extra,
  });
  const user = { id: `account-${tutor.id}`, role, roles: [role], profileId: tutor.id, tutorId: tutor.id, name: "Close Tutor", email: tutor.email };
  return { data, student, lesson, user };
}

test("only lessons that are over and still open wait to be closed out", async () => {
  const { data, lesson, user } = await world();
  const over = await lesson("2026-03-10T18:00:00.000Z");
  const running = await lesson("2026-03-10T19:30:00.000Z");
  await lesson("2026-03-09T18:00:00.000Z", { status: "COMPLETED" });
  await lesson("2026-03-09T16:00:00.000Z", { status: "CANCELLED" });
  await lesson("2026-03-11T18:00:00.000Z");

  assert.deepEqual((await lessonsToCloseOut(data, user, NOW)).map((l) => l.id), [over.id]);
  assert.deepEqual(await lessonsToCloseOut(data, { ...user, role: "CLIENT", roles: ["CLIENT"] }, NOW), [], "someone who does not teach");

  const buckets = await lessonBucketsFor(data, user, NOW);
  assert.deepEqual(buckets.needsAttention.map((l) => l.id), [over.id], "a lesson that is on now does not need attention");
  assert.deepEqual(buckets.ongoing.map((l) => l.id), [running.id]);
});

test("finishing needs attendance and the whole report; what was typed is kept when refused", async () => {
  const { data, student, lesson, user } = await world();
  const l = await lesson("2026-03-10T18:00:00.000Z");

  await assert.rejects(closeOutLesson(data, user, l.id, { attendance: {}, report: { publicSummary: "Fractions." } }, NOW),
    (e) => e instanceof CloseOutError && /attendance/.test(e.message) && /progress/.test(e.message) && /confidence/.test(e.message));
  assert.equal((await data.reports.forLesson(l.id)).publicSummary, "Fractions.");
  assert.equal((await data.lessons.get(l.id)).status, "PLANNED");

  assert.equal(await closeOutLesson(data, user, l.id, { attendance: { [student.id]: "ATTENDED" }, report: FULL }, NOW), "completed");
  assert.equal((await data.lessons.get(l.id)).status, "COMPLETED");
  assert.notEqual((await data.reports.forLesson(l.id)).status, "DRAFT");
  assert.deepEqual(await lessonsToCloseOut(data, user, NOW), []);
});

test("a no-show needs only a summary, and a lesson without a required report only attendance", async () => {
  const { data, student, lesson, user } = await world();
  const noShow = await lesson("2026-03-10T16:00:00.000Z");
  await closeOutLesson(data, user, noShow.id, { attendance: { [student.id]: "ABSENT" }, report: { publicSummary: "Did not attend." } }, NOW);
  assert.equal((await data.lessons.get(noShow.id)).status, "COMPLETED");

  const noReport = await lesson("2026-03-10T17:00:00.000Z", { reportRequired: false });
  await closeOutLesson(data, user, noReport.id, { attendance: { [student.id]: "LATE" }, report: { publicSummary: "" } }, NOW);
  assert.equal((await data.lessons.get(noReport.id)).status, "COMPLETED");
  assert.equal(await data.reports.forLesson(noReport.id), null);
});

test("a junior tutor is released once their part is written; the report is left for an administrator", async () => {
  const { data, student, lesson, user } = await world("JUNIOR_TUTOR");
  const l = await lesson("2026-03-10T18:00:00.000Z");
  assert.equal(await closeOutLesson(data, user, l.id, { attendance: { [student.id]: "ATTENDED" }, report: FULL }, NOW), "awaiting-admin");
  assert.equal((await data.reports.forLesson(l.id)).status, "DRAFT");
  assert.equal((await data.lessons.get(l.id)).status, "PLANNED");
  assert.deepEqual(await lessonsToCloseOut(data, user, NOW), []);
});

test("only the lesson's own tutor, once it has started", async () => {
  const { data, student, lesson, user } = await world();
  const later = await lesson("2026-03-11T18:00:00.000Z");
  const input = { attendance: { [student.id]: "ATTENDED" }, report: FULL };
  await assert.rejects(closeOutLesson(data, user, later.id, input, NOW), CloseOutError);
  const over = await lesson("2026-03-10T18:00:00.000Z");
  await assert.rejects(closeOutLesson(data, { ...user, profileId: "another-tutor", tutorId: "another-tutor" }, over.id, input, NOW), CloseOutError);
});

test("the classroom, the close-out screen and safeguarding concerns stay open; the rest of the dashboard does not", () => {
  for (const path of ["/dashboard/close-out", "/dashboard/close-out?lesson=1", "/dashboard/concerns?raised=SC", "/dashboard/lessons/abc/classroom?token=t"]) assert.ok(staysOpen(path), path);
  for (const path of ["/dashboard", "/dashboard/lessons", "/dashboard/lessons/abc", "/dashboard/calendar", "/dashboard/concerns-other", ""]) assert.ok(!staysOpen(path), path);
});

test("a lesson that is on now is still the next one on the dashboard, so a late student can find it", async () => {
  const { data, student, lesson, user } = await world();
  const running = await lesson("2026-03-10T19:30:00.000Z");
  await lesson("2026-03-11T18:00:00.000Z");
  const buckets = await lessonBucketsFor(data, user, NOW);
  assert.equal(buckets.next.id, running.id);
  assert.equal(nextLessonForStudent(buckets.all, student.id, NOW).id, running.id);
});
