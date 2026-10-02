import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 features A6 (starting-soon reminders) and A8 (a parent's "this week"): derived at read time from what
// the person may already see.

const reminders = loadTsFrom(import.meta.url, "../src/lib/notifications/derivedReminders.ts");
const { getDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { weekSummaryFor, WEEK_DAYS } = loadTsFrom(import.meta.url, "../src/lib/dashboard/weekSummary.ts");

const NOW = new Date("2026-11-03T12:00:00.000Z");
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const lesson = (id, minutes, status = "PLANNED") => ({ id, title: `Lesson ${id}`, startAt: at(minutes), status });

test("only planned lessons inside the hour are reminders, soonest first", () => {
  const found = reminders.lessonsStartingSoon(
    [lesson("far", 120), lesson("soon", 25), lesson("nearer", 5), lesson("done", 10, "COMPLETED"), lesson("cancelled", 10, "CANCELLED"), lesson("past", -30), lesson("justStarted", -3)],
    NOW,
  );
  assert.deepEqual(found.map((r) => r.lessonId), ["justStarted", "nearer", "soon"]);
  assert.deepEqual(found.map((r) => r.minutesUntil), [0, 5, 25]);
});

test("the window boundaries: exactly an hour is in, an hour and a minute is out, six minutes ago is out", () => {
  assert.equal(reminders.lessonsStartingSoon([lesson("edge", 60)], NOW).length, 1);
  assert.equal(reminders.lessonsStartingSoon([lesson("out", 61)], NOW).length, 0);
  assert.equal(reminders.lessonsStartingSoon([lesson("late", -6)], NOW).length, 0);
  assert.equal(reminders.lessonsStartingSoon([lesson("custom", 120)], NOW, 180).length, 1);
});

test("the wording is plain and singular/plural correct", () => {
  assert.equal(reminders.reminderWording(0), "starting now");
  assert.equal(reminders.reminderWording(1), "starting now");
  assert.equal(reminders.reminderWording(25), "starts in 25 minutes");
  assert.equal(reminders.reminderWording(60), "starts in 1 hour");
  assert.equal(reminders.reminderWording(75), "starts in 1 hour 15 minutes");
  assert.equal(reminders.reminderWording(120), "starts in 2 hours");
});

test("isStartingSoon agrees with the list and never reminds about a cancelled or finished lesson", () => {
  assert.equal(reminders.isStartingSoon(lesson("x", 30), NOW), true);
  assert.equal(reminders.isStartingSoon(lesson("x", 90), NOW), false);
  assert.equal(reminders.isStartingSoon(lesson("x", 30, "CANCELLED"), NOW), false);
  assert.equal(reminders.isStartingSoon(lesson("x", 30, "COMPLETED"), NOW), false);
});

const tag = () => crypto.randomUUID().slice(0, 8);

async function family(name) {
  const data = getDataProvider();
  const t = tag();
  const tutor = await data.tutors.create({ name: `Tutor ${name} ${t}`, email: `t-${t}@example.test`, subjects: ["Maths"], active: true });
  const student = await data.students.create({ name: `Child ${name} ${t}`, active: true });
  const client = await data.clients.create({ name: `Parent ${name} ${t}`, email: `p-${t}@example.test`, active: true });
  await data.students.linkClient(client.id, student.id);
  const make = async (title, offsetDays, status = "PLANNED") => {
    const assignment = await data.assignments.create({ title, subject: "Maths", tutorId: tutor.id, studentIds: [student.id], clientIds: [client.id], status: "ACTIVE" });
    return data.lessons.create({
      assignmentId: assignment.id, tutorId: tutor.id, studentIds: [student.id], clientIds: [client.id], title, subject: "Maths",
      startAt: new Date(NOW.getTime() + offsetDays * 86_400_000).toISOString(), durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status,
    });
  };
  const user = { id: `u-${client.id}`, email: "p@example.test", role: "CLIENT", name: "Parent", profileId: client.id };
  return { data, tutor, student, client, make, user, t };
}

test("a Parent's week: lessons in the next seven days for their children only, soonest first, cancelled ones left out", async () => {
  const mine = await family("A");
  const other = await family("B");
  await mine.make(`In two days ${mine.t}`, 2);
  await mine.make(`In one day ${mine.t}`, 1);
  await mine.make(`In eight days ${mine.t}`, WEEK_DAYS + 1);
  await mine.make(`Cancelled ${mine.t}`, 3, "CANCELLED");
  await mine.make(`Yesterday ${mine.t}`, -1, "COMPLETED");
  await other.make(`Other family ${other.t}`, 2);

  const week = await weekSummaryFor(mine.data, mine.user, NOW);
  assert.deepEqual(week.lessons.map((l) => l.title), [`In one day ${mine.t}`, `In two days ${mine.t}`]);
  assert.deepEqual(week.lessons[0].childNames, [mine.student.name]);
  assert.ok(!JSON.stringify(week).includes(`Other family`), "another family's lesson appeared in this week");
});

test("a Parent's new reports: approved in the last seven days only; drafts, submitted and old ones never; no report text", async () => {
  const mine = await family("C");
  const recent = await mine.make(`Recent ${mine.t}`, -2, "COMPLETED");
  const old = await mine.make(`Old ${mine.t}`, -20, "COMPLETED");
  const submitted = await mine.make(`Submitted ${mine.t}`, -3, "COMPLETED");
  const draft = await mine.make(`Draft ${mine.t}`, -4, "COMPLETED");
  const create = (lesson, fields) => mine.data.reports.create({ lessonId: lesson.id, tutorId: mine.tutor.id, publicSummary: `SECRET summary ${lesson.id}`, internalTutorNotes: `PRIVATE ${lesson.id}`, ...fields });
  await create(recent, { status: "APPROVED", approvedAt: new Date(NOW.getTime() - 86_400_000).toISOString() });
  await create(old, { status: "APPROVED", approvedAt: new Date(NOW.getTime() - 15 * 86_400_000).toISOString() });
  await create(submitted, { status: "SUBMITTED" });
  await create(draft, { status: "DRAFT" });

  const week = await weekSummaryFor(mine.data, mine.user, NOW);
  assert.deepEqual(week.newReports.map((r) => r.lessonTitle), [`Recent ${mine.t}`]);
  assert.doesNotMatch(JSON.stringify(week), /SECRET|PRIVATE/, "report text or private notes appeared in the week summary");
});

test("a role with no linked profile has an empty week", async () => {
  const mine = await family("D");
  await mine.make(`Soon ${mine.t}`, 1);
  const week = await weekSummaryFor(mine.data, { id: "o", email: "o@example.test", role: "CLIENT", name: "O" }, NOW);
  assert.deepEqual(week, { lessons: [], newReports: [] });
});
