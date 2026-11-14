import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const { getDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { createLessonOrSeries } = loadTsFrom(import.meta.url, "../src/lib/scheduling/schedulingService.ts");
const { markAttendance, completeLesson, LessonCompletionError } = loadTsFrom(import.meta.url, "../src/lib/attendance/attendanceService.ts");

async function freshLesson(data, studentCount = 1) {
  const tutor = await data.tutors.create({ name: "Test Tutor", email: `tutor-${crypto.randomUUID()}@example.test`, subjects: ["Physics"], active: true });
  const students = [];
  for (let i = 0; i < studentCount; i += 1) students.push(await data.students.create({ name: `Test Student ${i}`, active: true }));
  const assignment = await data.assignments.create({
    title: "Physics — Test", subject: "Physics", tutorId: tutor.id, studentIds: students.map((s) => s.id), clientIds: [], status: "ACTIVE",
  });
  const [lesson] = await createLessonOrSeries(data, {
    assignment, title: assignment.title, subject: assignment.subject,
    startAt: "2025-09-02T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: false,
  });
  return { lesson, students, tutor };
}

test("markAttendance: records a per-student status and logs an activity event", async () => {
  const data = getDataProvider();
  const { lesson, students, tutor } = await freshLesson(data);
  await markAttendance(data, lesson.id, students[0].id, { status: "LATE", notes: "Bus delay" }, tutor.id);

  const records = await data.attendance.forLesson(lesson.id);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "LATE");
  assert.equal(records[0].notes, "Bus delay");
  assert.equal(records[0].markedBy, tutor.id);

  const activity = await data.activity.forLesson(lesson.id);
  const marked = activity.find((e) => e.type === "ATTENDANCE_MARKED");
  assert.ok(marked);
  assert.match(marked.message, /LATE/);
});

test("markAttendance: marking the same Student again replaces their record, not appends a second one", async () => {
  const data = getDataProvider();
  const { lesson, students, tutor } = await freshLesson(data);
  await markAttendance(data, lesson.id, students[0].id, { status: "ABSENT" }, tutor.id);
  await markAttendance(data, lesson.id, students[0].id, { status: "ATTENDED" }, tutor.id);

  const records = await data.attendance.forLesson(lesson.id);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "ATTENDED");
});

test("createLessonOrSeries logs a CREATED activity event", async () => {
  const data = getDataProvider();
  const { lesson } = await freshLesson(data);
  const activity = await data.activity.forLesson(lesson.id);
  assert.equal(activity.length, 1);
  assert.equal(activity[0].type, "CREATED");
});

test("completeLesson: refuses to complete while any Student still has no attendance record", async () => {
  const data = getDataProvider();
  const { lesson, students, tutor } = await freshLesson(data, 2);
  await markAttendance(data, lesson.id, students[0].id, { status: "ATTENDED" }, tutor.id);
  // students[1] still has no record.
  await assert.rejects(() => completeLesson(data, lesson.id, tutor.id), LessonCompletionError);

  const unchanged = await data.lessons.get(lesson.id);
  assert.equal(unchanged.status, "PLANNED");
});

test("completeLesson: succeeds once every Student has an attendance record, and logs it", async () => {
  const data = getDataProvider();
  const { lesson, students, tutor } = await freshLesson(data, 2);
  await markAttendance(data, lesson.id, students[0].id, { status: "ATTENDED" }, tutor.id);
  await markAttendance(data, lesson.id, students[1].id, { status: "ABSENT" }, tutor.id);

  const completed = await completeLesson(data, lesson.id, tutor.id);
  assert.equal(completed.status, "COMPLETED");

  const activity = await data.activity.forLesson(lesson.id);
  assert.ok(activity.some((e) => e.type === "COMPLETED"));
});

test("completeLesson: a cancelled lesson can never be marked complete", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data, 0);
  await data.lessons.update(lesson.id, { status: "CANCELLED" });
  await assert.rejects(() => completeLesson(data, lesson.id, tutor.id), LessonCompletionError);
});

// Tahasin, 14 Nov 2026: a tutor waits 15 minutes from the scheduled start before marking a student as a no-show.
const { AttendanceError, NO_SHOW_WAIT_MINUTES, noShowAllowedFrom } = loadTsFrom(import.meta.url, "../src/lib/attendance/attendanceService.ts");

test("a student cannot be marked absent until 15 minutes after the lesson's scheduled start", async () => {
  const data = getDataProvider();
  const { lesson, students, tutor } = await freshLesson(data);
  const start = new Date(lesson.startAt).getTime();
  assert.equal(NO_SHOW_WAIT_MINUTES, 15);
  assert.equal(noShowAllowedFrom(lesson.startAt).getTime(), start + 15 * 60_000);

  await assert.rejects(() => markAttendance(data, lesson.id, students[0].id, { status: "ABSENT" }, tutor.id, new Date(start - 60_000)), AttendanceError, "before the lesson");
  await assert.rejects(() => markAttendance(data, lesson.id, students[0].id, { status: "ABSENT" }, tutor.id, new Date(start + 14 * 60_000 + 59_000)), AttendanceError, "a second short of 15 minutes");
  assert.equal((await data.attendance.forLesson(lesson.id)).length, 0, "a refused absence stores nothing and logs nothing");
  assert.equal((await data.activity.forLesson(lesson.id)).some((e) => e.type === "ATTENDANCE_MARKED"), false);

  const absent = await markAttendance(data, lesson.id, students[0].id, { status: "ABSENT" }, tutor.id, new Date(start + 15 * 60_000));
  assert.equal(absent.status, "ABSENT", "at exactly 15 minutes it is allowed");
});

test("the 15-minute wait applies only to ABSENT: a student can be marked present or late as soon as the lesson starts", async () => {
  const data = getDataProvider();
  const { lesson, students, tutor } = await freshLesson(data, 2);
  const start = new Date(lesson.startAt).getTime();
  assert.equal((await markAttendance(data, lesson.id, students[0].id, { status: "ATTENDED" }, tutor.id, new Date(start - 5 * 60_000))).status, "ATTENDED");
  assert.equal((await markAttendance(data, lesson.id, students[1].id, { status: "LATE" }, tutor.id, new Date(start + 3 * 60_000))).status, "LATE");
  assert.equal((await markAttendance(data, lesson.id, students[1].id, { status: "EXCUSED" }, tutor.id, new Date(start + 1_000))).status, "EXCUSED");
});
