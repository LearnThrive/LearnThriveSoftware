import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTsFrom } from "./_tsLoader.mjs";

const { isWithinJoinWindow, JOIN_WINDOW_MINUTES } = loadTsFrom(import.meta.url, "../src/lib/scheduling/joinWindow.ts");

const lesson = { startAt: "2026-03-10T16:00:00.000Z", durationMinutes: 60 };
const start = new Date(lesson.startAt).getTime();

test("joinWindow: a lesson's Tutor and Students can join from 30 minutes before the start; a meeting guest from 10", () => {
  const at = (minutes) => new Date(start - minutes * 60_000);
  for (const role of ["TUTOR", "STUDENT"]) {
    assert.equal(isWithinJoinWindow(lesson, role, at(30)), true, role);
    assert.equal(isWithinJoinWindow(lesson, role, at(31)), false, role);
  }
  assert.equal(isWithinJoinWindow(lesson, "GUEST", at(20)), false);
  assert.equal(isWithinJoinWindow(lesson, "GUEST", at(10)), true);
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
