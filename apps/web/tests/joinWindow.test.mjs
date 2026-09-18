import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTsFrom } from "./_tsLoader.mjs";

const { isWithinJoinWindow, JOIN_WINDOW_MINUTES } = loadTsFrom(import.meta.url, "../src/lib/scheduling/joinWindow.ts");

const lesson = { startAt: "2026-03-10T16:00:00.000Z", durationMinutes: 60 };
const start = new Date(lesson.startAt).getTime();

test("joinWindow: a Tutor can join well before a Student can, for the same lesson", () => {
  const twentyMinutesBefore = new Date(start - 20 * 60_000);
  assert.equal(isWithinJoinWindow(lesson, "TUTOR", twentyMinutesBefore), true);
  assert.equal(isWithinJoinWindow(lesson, "STUDENT", twentyMinutesBefore), false);
});

test("joinWindow: a Student can join within their own (shorter) window before start", () => {
  const fiveMinutesBefore = new Date(start - 5 * 60_000);
  assert.equal(isWithinJoinWindow(lesson, "STUDENT", fiveMinutesBefore), true);
});

test("joinWindow: neither role can join far too early", () => {
  const anHourBefore = new Date(start - 60 * 60_000);
  assert.equal(isWithinJoinWindow(lesson, "TUTOR", anHourBefore), false);
  assert.equal(isWithinJoinWindow(lesson, "STUDENT", anHourBefore), false);
});

test("joinWindow: still open a little after the lesson's scheduled end, for a lesson that overruns", () => {
  const end = start + lesson.durationMinutes * 60_000;
  const justAfterEnd = new Date(end + 10 * 60_000);
  assert.equal(isWithinJoinWindow(lesson, "STUDENT", justAfterEnd), true);
});

test("joinWindow: closes for good once the after-end grace period has fully elapsed", () => {
  const end = start + lesson.durationMinutes * 60_000;
  const longAfterEnd = new Date(end + (JOIN_WINDOW_MINUTES.AFTER_END + 5) * 60_000);
  assert.equal(isWithinJoinWindow(lesson, "TUTOR", longAfterEnd), false);
  assert.equal(isWithinJoinWindow(lesson, "STUDENT", longAfterEnd), false);
});
