// Tutor pay (what each tutor is owed for a month) and the CSV the accountant and the pay run use (Tahasin, 14 Nov 2026).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { csvCell, money, poundsText, toCsv, tutorPay, tutorRateOn, type TutorPayAttendance, type TutorPayLesson, type TutorRate } from "./tuitionBilling";

const rate = (tutorId: string, hourlyPence: number, effectiveFrom: string): TutorRate => ({ id: `${tutorId}-${effectiveFrom}`, tutorId, hourlyPence, effectiveFrom, createdBy: "u", createdAt: "x" });
const lesson = (over: Partial<TutorPayLesson> = {}): TutorPayLesson => ({ id: "l1", tutorId: "t1", title: "Algebra", startAt: "2026-10-06T16:00:00Z", durationMinutes: 60, status: "COMPLETED", studentIds: ["s1"], ...over });
const pay = (lessons: TutorPayLesson[], rates: TutorRate[], attendance: TutorPayAttendance[] = [], period = "2026-10") =>
  tutorPay({ period, tutors: [{ id: "t1", name: "Tutor One" }, { id: "t2", name: "Tutor Two" }], lessons, attendance, rates });

describe("tutor pay", () => {
  test("a completed lesson in the month is paid at the rate in force that day, for its length, once", () => {
    const [one, two] = pay([lesson(), lesson({ id: "l2", startAt: "2026-10-13T16:00:00Z", durationMinutes: 90, studentIds: ["s1", "s2"] })], [rate("t1", 2000, "2026-01-01")]);
    assert.deepEqual(one!.lines.map((l) => [l.minutes, l.amountPence]), [[60, 2000], [90, 3000]], "a group lesson pays once, not per child");
    assert.equal(one!.totalPence, 5000);
    assert.equal(one!.totalMinutes, 150);
    assert.equal(two!.totalPence, 0);
  });

  test("a change of rate applies from its date: the newest rate that has started", () => {
    const rates = [rate("t1", 2000, "2026-01-01"), rate("t1", 2500, "2026-10-10"), rate("t2", 9900, "2026-01-01")];
    assert.equal(tutorRateOn(rates, "t1", "2026-10-09")?.hourlyPence, 2000);
    assert.equal(tutorRateOn(rates, "t1", "2026-10-10")?.hourlyPence, 2500);
    assert.equal(tutorRateOn(rates, "t1", "2025-12-31"), null, "before their first rate there is none");
    const [one] = pay([lesson({ startAt: "2026-10-06T16:00:00Z" }), lesson({ id: "l2", startAt: "2026-10-13T16:00:00Z" })], rates);
    assert.deepEqual(one!.lines.map((l) => l.amountPence), [2000, 2500]);
  });

  test("only COMPLETED lessons count, only in the month (by London date), and only for that tutor", () => {
    const lessons = [
      lesson({ id: "planned", status: "PLANNED" }), lesson({ id: "cancelled", status: "CANCELLED" }),
      lesson({ id: "september", startAt: "2026-09-30T22:30:00Z" }), // 23:30 on 30 Sept in London (BST): September
      lesson({ id: "october-edge", startAt: "2026-09-30T23:30:00Z" }), // 00:30 on 1 Oct in London: October
      lesson({ id: "other", tutorId: "t2" }),
    ];
    const [one, two] = pay(lessons, [rate("t1", 2000, "2026-01-01"), rate("t2", 3000, "2026-01-01")]);
    assert.deepEqual(one!.lines.map((l) => l.lessonId), ["october-edge"]);
    assert.deepEqual(two!.lines.map((l) => l.lessonId), ["other"]);
  });

  test("a lesson with no pay rate yet is listed at nothing and counted, not guessed", () => {
    const [one] = pay([lesson()], []);
    assert.equal(one!.unpricedLessons, 1);
    assert.deepEqual(one!.lines.map((l) => [l.ratePence, l.amountPence]), [[null, 0]]);
    assert.equal(one!.totalPence, 0);
  });

  test("a lesson where every child was absent is left out and listed for a person to decide (the tutor waited, but pay for that is undecided)", () => {
    const attendance: TutorPayAttendance[] = [{ lessonId: "l1", studentId: "s1", status: "ABSENT" }];
    const [one] = pay([lesson(), lesson({ id: "l2", studentIds: ["s1", "s2"] })], [rate("t1", 2000, "2026-01-01")], [...attendance, { lessonId: "l2", studentId: "s1", status: "ABSENT" }, { lessonId: "l2", studentId: "s2", status: "LATE" }]);
    assert.deepEqual(one!.allAbsentLessons.map((l) => l.lessonId), ["l1"]);
    assert.deepEqual(one!.lines.map((l) => l.lessonId), ["l2"], "one child came, so the lesson is paid");
    assert.equal(one!.totalPence, 2000);
  });

  test("the pay for a part-hour rounds half up to the penny, like a family's charge", () => {
    const [one] = pay([lesson({ durationMinutes: 45 })], [rate("t1", 2250, "2026-01-01")]);
    assert.equal(one!.totalPence, 1688, "£22.50 an hour for 45 minutes is £16.875, to the penny £16.88");
  });

  test("a bad period is refused", () => {
    assert.throws(() => pay([], [], [], "2026-13"), /yyyy-mm/);
  });
});

describe("csv", () => {
  test("text with a comma, a quote or a line break is quoted the standard way", () => {
    assert.equal(csvCell("Smith, J"), '"Smith, J"');
    assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
    assert.equal(csvCell("two\nlines"), '"two\nlines"');
    assert.equal(csvCell("plain"), "plain");
  });

  test("text that a spreadsheet would run as a formula gets a leading apostrophe", () => {
    for (const bad of ["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      assert.match(csvCell(bad), /^"?'/, `${JSON.stringify(bad)} is neutralised`);
    }
    assert.equal(csvCell("ok -dash"), "ok -dash", "only a leading character matters");
  });

  test("money is pounds and pence, including a negative amount, which is a number and not neutralised", () => {
    assert.equal(poundsText(12345), "123.45");
    assert.equal(poundsText(5), "0.05");
    assert.equal(poundsText(-250), "-2.50");
    assert.equal(poundsText(0), "0.00");
    assert.equal(csvCell(money(-250)), "-2.50");
    assert.equal(csvCell(3), "3");
  });

  test("a whole file: a header row and one line per record, CRLF between lines", () => {
    assert.equal(toCsv(["Name", "Owed"], [["A, B", money(1500)], ["=bad", money(-100)]]), 'Name,Owed\r\n"A, B",15.00\r\n\'=bad,-1.00\r\n');
  });
});
