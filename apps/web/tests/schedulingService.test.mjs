import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const { getDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { detectConflicts, createLessonOrSeries, rescheduleLesson, cancelLesson } = loadTsFrom(import.meta.url, "../src/lib/scheduling/schedulingService.ts");

async function freshAssignment(data) {
  const tutor = await data.tutors.create({ name: "Test Tutor", email: `tutor-${crypto.randomUUID()}@example.test`, subjects: ["Physics"], active: true });
  const student = await data.students.create({ name: "Test Student", active: true });
  return data.assignments.create({
    title: "Physics — Test", subject: "Physics", tutorId: tutor.id, studentIds: [student.id], clientIds: [], status: "ACTIVE",
  });
}

test("createLessonOrSeries: a single lesson (no recurrence) creates exactly one row", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  const lessons = await createLessonOrSeries(data, {
    assignment, title: assignment.title, subject: assignment.subject,
    startAt: "2025-09-02T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: true,
  });
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].status, "PLANNED");
  assert.equal(lessons[0].recurrenceId, undefined);
});

test("createLessonOrSeries: a WEEKLY recurrence creates a real, independently editable row per occurrence", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  const lessons = await createLessonOrSeries(data, {
    assignment, title: assignment.title, subject: assignment.subject,
    startAt: "2025-09-02T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: false,
    recurrence: { frequency: "WEEKLY", endAfterOccurrences: 3 },
  });
  assert.equal(lessons.length, 3);
  const recurrenceId = lessons[0].recurrenceId;
  assert.ok(recurrenceId);
  assert.ok(lessons.every((l) => l.recurrenceId === recurrenceId));
  assert.ok(lessons.every((l) => l.id !== lessons[0].id || l === lessons[0])); // all distinct ids
  const ids = new Set(lessons.map((l) => l.id));
  assert.equal(ids.size, 3);

  const fromRepo = await data.lessons.forRecurrence(recurrenceId);
  assert.equal(fromRepo.length, 3);
});

test("detectConflicts: warns when the same Tutor already has an overlapping lesson", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  await data.lessons.create({
    assignmentId: assignment.id, tutorId: assignment.tutorId, studentIds: assignment.studentIds, clientIds: [],
    title: "Existing", subject: "Physics", startAt: "2025-09-03T10:00:00.000Z", durationMinutes: 60,
    locationType: "ONLINE", reportRequired: false, status: "PLANNED",
  });

  const warnings = await detectConflicts(data, {
    tutorId: assignment.tutorId, studentIds: assignment.studentIds,
    startAt: "2025-09-03T10:30:00.000Z", durationMinutes: 60, // overlaps 10:00-11:00
  });
  assert.ok(warnings.some((w) => w.kind === "TUTOR"));
});

test("detectConflicts: no warning for a lesson that doesn't overlap", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  await data.lessons.create({
    assignmentId: assignment.id, tutorId: assignment.tutorId, studentIds: assignment.studentIds, clientIds: [],
    title: "Existing", subject: "Physics", startAt: "2025-09-04T10:00:00.000Z", durationMinutes: 60,
    locationType: "ONLINE", reportRequired: false, status: "PLANNED",
  });
  const warnings = await detectConflicts(data, {
    tutorId: assignment.tutorId, studentIds: assignment.studentIds,
    startAt: "2025-09-04T11:00:00.000Z", durationMinutes: 60, // starts exactly when the other ends — no overlap
  });
  assert.equal(warnings.length, 0);
});

test("detectConflicts: a CANCELLED lesson never counts as a conflict", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  const existing = await data.lessons.create({
    assignmentId: assignment.id, tutorId: assignment.tutorId, studentIds: assignment.studentIds, clientIds: [],
    title: "Existing", subject: "Physics", startAt: "2025-09-05T10:00:00.000Z", durationMinutes: 60,
    locationType: "ONLINE", reportRequired: false, status: "PLANNED",
  });
  await data.lessons.update(existing.id, { status: "CANCELLED" });
  const warnings = await detectConflicts(data, {
    tutorId: assignment.tutorId, studentIds: assignment.studentIds,
    startAt: "2025-09-05T10:00:00.000Z", durationMinutes: 60,
  });
  assert.equal(warnings.length, 0);
});

test("rescheduleLesson: THIS_ONLY on a recurring lesson moves only that one occurrence", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  const lessons = await createLessonOrSeries(data, {
    assignment, title: assignment.title, subject: assignment.subject,
    startAt: "2025-09-02T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: false,
    recurrence: { frequency: "WEEKLY", endAfterOccurrences: 3 },
  });
  const second = lessons[1];
  await rescheduleLesson(data, second.id, "2025-09-10T09:00:00.000Z", "THIS_ONLY");

  const refreshed = await data.lessons.forRecurrence(lessons[0].recurrenceId);
  const moved = refreshed.find((l) => l.id === second.id);
  const others = refreshed.filter((l) => l.id !== second.id);
  assert.equal(moved.startAt, "2025-09-10T09:00:00.000Z");
  assert.equal(others.find((l) => l.id === lessons[0].id).startAt, lessons[0].startAt);
  assert.equal(others.find((l) => l.id === lessons[2].id).startAt, lessons[2].startAt);
});

test("rescheduleLesson: THIS_AND_FUTURE shifts this occurrence and every later one by the same delta, leaving earlier ones alone", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  const lessons = await createLessonOrSeries(data, {
    assignment, title: assignment.title, subject: assignment.subject,
    startAt: "2025-09-02T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: false,
    recurrence: { frequency: "WEEKLY", endAfterOccurrences: 3 },
  });
  const [first, second, third] = lessons;
  // Move the second occurrence one hour later; expect the third to shift by the same delta too.
  await rescheduleLesson(data, second.id, "2025-09-09T17:00:00.000Z", "THIS_AND_FUTURE");

  const refreshed = await data.lessons.forRecurrence(first.recurrenceId);
  const byId = Object.fromEntries(refreshed.map((l) => [l.id, l]));
  assert.equal(byId[first.id].startAt, first.startAt, "earlier occurrence must stay put");
  assert.equal(byId[second.id].startAt, "2025-09-09T17:00:00.000Z");
  assert.equal(byId[third.id].startAt, "2025-09-16T17:00:00.000Z", "later occurrence shifts by the same +1h delta");
});

test("rescheduleLesson: ENTIRE_SERIES shifts every occurrence, including ones earlier than the one edited", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  const lessons = await createLessonOrSeries(data, {
    assignment, title: assignment.title, subject: assignment.subject,
    startAt: "2025-09-02T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: false,
    recurrence: { frequency: "WEEKLY", endAfterOccurrences: 3 },
  });
  const [first, second, third] = lessons;
  await rescheduleLesson(data, second.id, "2025-09-09T17:00:00.000Z", "ENTIRE_SERIES");

  const refreshed = await data.lessons.forRecurrence(first.recurrenceId);
  const byId = Object.fromEntries(refreshed.map((l) => [l.id, l]));
  assert.equal(byId[first.id].startAt, "2025-09-02T17:00:00.000Z", "earlier occurrence also shifts under ENTIRE_SERIES");
  assert.equal(byId[third.id].startAt, "2025-09-16T17:00:00.000Z");
});

test("cancelLesson: records who/when/why and marks CANCELLED without deleting the row", async () => {
  const data = getDataProvider();
  const assignment = await freshAssignment(data);
  const lesson = await data.lessons.create({
    assignmentId: assignment.id, tutorId: assignment.tutorId, studentIds: assignment.studentIds, clientIds: [],
    title: "To cancel", subject: "Physics", startAt: "2025-09-06T10:00:00.000Z", durationMinutes: 60,
    locationType: "ONLINE", reportRequired: false, status: "PLANNED",
  });
  const cancelled = await cancelLesson(data, lesson.id, "admin-user-id", "Student unwell");
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.cancelledBy, "admin-user-id");
  assert.equal(cancelled.cancellationReason, "Student unwell");
  assert.ok(cancelled.cancelledAt);
  const stillThere = await data.lessons.get(lesson.id);
  assert.ok(stillThere, "cancelling must not delete the lesson row");
});
