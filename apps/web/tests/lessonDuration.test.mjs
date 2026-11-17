import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The scheduling forms take a lesson's length as hours and minutes (src/lib/scheduling/duration.ts).
const { parseDuration, splitDuration, formatDuration } = loadTsFrom(import.meta.url, "../src/lib/scheduling/duration.ts");

test("hours and minutes make one number of minutes, either box may be empty", () => {
  assert.deepEqual(parseDuration("1", "30"), { ok: true, minutes: 90 });
  assert.deepEqual(parseDuration("", "45"), { ok: true, minutes: 45 });
  assert.deepEqual(parseDuration("2", ""), { ok: true, minutes: 120 });
  assert.deepEqual(parseDuration("0", "90"), { ok: true, minutes: 90 }, "90 minutes typed as minutes is fine");
  assert.deepEqual(parseDuration(" 1 ", " 0 "), { ok: true, minutes: 60 });
});

test("a length that cannot be a lesson is refused with a reason", () => {
  for (const [h, m] of [["", ""], ["0", "0"], ["0", "4"], ["8", "1"], ["9", "0"], ["1.5", "0"], ["-1", "30"], ["x", "0"], ["1", "-5"]]) {
    const result = parseDuration(h, m);
    assert.equal(result.ok, false, `${h}h ${m}m`);
    assert.ok(result.message.length > 0);
  }
  assert.equal(parseDuration("8", "0").ok, true, "exactly 8 hours is allowed");
  assert.equal(parseDuration("0", "5").ok, true, "exactly 5 minutes is allowed");
});

test("minutes split back into the two boxes and read as words", () => {
  assert.deepEqual(splitDuration(90), { hours: 1, minutes: 30 });
  assert.deepEqual(splitDuration(45), { hours: 0, minutes: 45 });
  assert.deepEqual(splitDuration(120), { hours: 2, minutes: 0 });
  assert.equal(formatDuration(90), "1 hour 30 minutes");
  assert.equal(formatDuration(120), "2 hours");
  assert.equal(formatDuration(45), "45 minutes");
  assert.equal(formatDuration(61), "1 hour 1 minute");
});
