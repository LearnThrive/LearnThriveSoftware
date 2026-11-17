import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const { zonedTimeToUtc, utcToZonedWallClock, weekdayInZone, formatInTimeZone } = loadTsFrom(import.meta.url, "../src/lib/scheduling/timezone.ts");
const { generateRecurrenceOccurrences } = loadTsFrom(import.meta.url, "../src/lib/scheduling/recurrence.ts");

const LONDON = "Europe/London";

test("timezone: a summer evening in Europe/London (BST, UTC+1) converts correctly", () => {
  // 17:00 on 15 July 2025 (BST) should be 16:00 UTC.
  const utc = zonedTimeToUtc({ year: 2025, month: 7, day: 15, hour: 17, minute: 0 }, LONDON);
  assert.equal(utc.toISOString(), "2025-07-15T16:00:00.000Z");
});

test("timezone: a winter evening in Europe/London (GMT, UTC+0) converts correctly", () => {
  // 17:00 on 15 January 2025 (GMT) should be 17:00 UTC — no offset.
  const utc = zonedTimeToUtc({ year: 2025, month: 1, day: 15, hour: 17, minute: 0 }, LONDON);
  assert.equal(utc.toISOString(), "2025-01-15T17:00:00.000Z");
});

test("timezone: round-trips through utcToZonedWallClock", () => {
  const utc = zonedTimeToUtc({ year: 2025, month: 3, day: 10, hour: 9, minute: 30 }, LONDON);
  const wall = utcToZonedWallClock(utc, LONDON);
  assert.deepEqual(wall, { year: 2025, month: 3, day: 10, hour: 9, minute: 30 });
});

test("timezone: weekdayInZone identifies the correct local weekday", () => {
  // 15 July 2025 is a Tuesday.
  const utc = zonedTimeToUtc({ year: 2025, month: 7, day: 15, hour: 17, minute: 0 }, LONDON);
  assert.equal(weekdayInZone(utc, LONDON), 2); // Tuesday
});

test("timezone: formatInTimeZone renders a human-readable London time", () => {
  const utc = new Date("2025-07-15T16:00:00.000Z");
  const formatted = formatInTimeZone(utc, LONDON, { hour: "2-digit", minute: "2-digit", hour12: false });
  assert.match(formatted, /17:00|5:00 pm/i);
});

test("recurrence: WEEKLY generates the same local weekday and time every week", () => {
  const first = zonedTimeToUtc({ year: 2025, month: 7, day: 15, hour: 17, minute: 0 }, LONDON); // Tuesday
  const occurrences = generateRecurrenceOccurrences(first, { frequency: "WEEKLY", endAfterOccurrences: 4 }, LONDON);
  assert.equal(occurrences.length, 4);
  for (const occurrence of occurrences) {
    assert.equal(weekdayInZone(occurrence, LONDON), 2, "every occurrence should be a Tuesday");
    const wall = utcToZonedWallClock(occurrence, LONDON);
    assert.equal(wall.hour, 17);
    assert.equal(wall.minute, 0);
  }
  // Exactly 7 days apart in wall-clock date terms.
  const days = occurrences.map((o) => utcToZonedWallClock(o, LONDON).day);
  assert.deepEqual(days, [15, 22, 29, 5]); // 5 = 5 August
});

test("recurrence: WEEKLY keeps the same LOCAL time across a DST boundary (the actual UTC offset changes, the wall clock doesn't)", () => {
  // British clocks went back on 26 October 2025. Start two weeks before that, at 17:00 local.
  const first = zonedTimeToUtc({ year: 2025, month: 10, day: 14, hour: 17, minute: 0 }, LONDON); // Tuesday, still BST
  const occurrences = generateRecurrenceOccurrences(first, { frequency: "WEEKLY", endAfterOccurrences: 3 }, LONDON);
  assert.equal(occurrences.length, 3);
  const wallTimes = occurrences.map((o) => utcToZonedWallClock(o, LONDON));
  // All three stay at 17:00 local, even though the third one (28 Oct) is after the clocks changed.
  for (const wall of wallTimes) assert.equal(wall.hour, 17);
  // But the underlying UTC instant shifts by an hour once GMT starts — proving this isn't just
  // naively adding 7*24 hours in UTC (which would have kept the UTC hour fixed and drifted the
  // local wall-clock time instead).
  const utcHours = occurrences.map((o) => o.getUTCHours());
  assert.deepEqual(utcHours, [16, 16, 17]); // BST, BST, GMT (after the 26 Oct change)
});

test("recurrence: BIWEEKLY skips alternate weeks", () => {
  const first = zonedTimeToUtc({ year: 2025, month: 7, day: 15, hour: 17, minute: 0 }, LONDON);
  const occurrences = generateRecurrenceOccurrences(first, { frequency: "BIWEEKLY", endAfterOccurrences: 3 }, LONDON);
  const days = occurrences.map((o) => utcToZonedWallClock(o, LONDON).day);
  assert.deepEqual(days, [15, 29, 12]); // 15 Jul, 29 Jul, 12 Aug — 14 days apart each time
});

test("recurrence: CUSTOM_WEEKDAYS generates one occurrence per selected weekday, per week", () => {
  // Start Tuesday 15 July; also want Thursday. Expect Tue 15, Thu 17, Tue 22, Thu 24.
  const first = zonedTimeToUtc({ year: 2025, month: 7, day: 15, hour: 17, minute: 0 }, LONDON);
  const occurrences = generateRecurrenceOccurrences(
    first, { frequency: "CUSTOM_WEEKDAYS", weekdays: [2, 4], endAfterOccurrences: 4 }, LONDON,
  );
  const days = occurrences.map((o) => utcToZonedWallClock(o, LONDON).day);
  assert.deepEqual(days, [15, 17, 22, 24]);
});

test("recurrence: stops at endDate (inclusive) rather than endAfterOccurrences", () => {
  const first = zonedTimeToUtc({ year: 2025, month: 7, day: 15, hour: 17, minute: 0 }, LONDON);
  const occurrences = generateRecurrenceOccurrences(first, { frequency: "WEEKLY", endDate: "2025-07-29" }, LONDON);
  const days = occurrences.map((o) => utcToZonedWallClock(o, LONDON).day);
  assert.deepEqual(days, [15, 22, 29]); // stops at (and includes) 29 Jul, doesn't reach 5 Aug
});

test("recurrence: a series with neither end condition is still bounded (no runaway generation)", () => {
  const first = zonedTimeToUtc({ year: 2025, month: 1, day: 7, hour: 17, minute: 0 }, LONDON);
  const occurrences = generateRecurrenceOccurrences(first, { frequency: "WEEKLY" }, LONDON);
  assert.ok(occurrences.length > 0);
  assert.ok(occurrences.length <= 104, `expected a bounded series, got ${occurrences.length} occurrences`);
});

test("recurrence: the first occurrence is always included and is exactly the given start time", () => {
  const first = zonedTimeToUtc({ year: 2025, month: 7, day: 15, hour: 17, minute: 0 }, LONDON);
  const occurrences = generateRecurrenceOccurrences(first, { frequency: "WEEKLY", endAfterOccurrences: 1 }, LONDON);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].getTime(), first.getTime());
});

// Tahasin sets the timetable: "every N weeks" and "these weekdays" as well as weekly and fortnightly. 6 October 2025 is a Monday.
const localDates = (dates) => dates.map((d) => { const w = utcToZonedWallClock(d, LONDON); return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")} ${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`; });
const mondayFive = zonedTimeToUtc({ year: 2025, month: 10, day: 6, hour: 17, minute: 0 }, LONDON);

test("recurrence: every 3 weeks keeps the weekday and the local time across the clock change", () => {
  const out = generateRecurrenceOccurrences(mondayFive, { frequency: "WEEKLY", intervalWeeks: 3, endAfterOccurrences: 3 }, LONDON);
  assert.deepEqual(localDates(out), ["2025-10-06 17:00", "2025-10-27 17:00", "2025-11-17 17:00"]);
});

test("recurrence: chosen weekdays with a two-week interval (Monday and Thursday, every other week)", () => {
  const out = generateRecurrenceOccurrences(mondayFive, { frequency: "WEEKLY", intervalWeeks: 2, weekdays: [1, 4], endAfterOccurrences: 4 }, LONDON);
  assert.deepEqual(localDates(out), ["2025-10-06 17:00", "2025-10-09 17:00", "2025-10-20 17:00", "2025-10-23 17:00"]);
});

test("recurrence: weekdays alone repeat weekly, and the old BIWEEKLY and CUSTOM_WEEKDAYS rules mean what they did", () => {
  assert.deepEqual(localDates(generateRecurrenceOccurrences(mondayFive, { frequency: "WEEKLY", weekdays: [1, 3], endAfterOccurrences: 4 }, LONDON)),
    ["2025-10-06 17:00", "2025-10-08 17:00", "2025-10-13 17:00", "2025-10-15 17:00"]);
  assert.deepEqual(localDates(generateRecurrenceOccurrences(mondayFive, { frequency: "BIWEEKLY", endAfterOccurrences: 3 }, LONDON)),
    ["2025-10-06 17:00", "2025-10-20 17:00", "2025-11-03 17:00"]);
  assert.deepEqual(localDates(generateRecurrenceOccurrences(mondayFive, { frequency: "CUSTOM_WEEKDAYS", weekdays: [1, 4], endAfterOccurrences: 3 }, LONDON)),
    ["2025-10-06 17:00", "2025-10-09 17:00", "2025-10-13 17:00"]);
});

test("recurrence: an end date stops a custom series, and a silly interval is clamped rather than stalling", () => {
  const out = generateRecurrenceOccurrences(mondayFive, { frequency: "WEEKLY", intervalWeeks: 2, endDate: "2025-11-03" }, LONDON);
  assert.deepEqual(localDates(out), ["2025-10-06 17:00", "2025-10-20 17:00", "2025-11-03 17:00"]);
  assert.equal(generateRecurrenceOccurrences(mondayFive, { frequency: "WEEKLY", intervalWeeks: 0, endAfterOccurrences: 2 }, LONDON).length, 2, "0 weeks is treated as 1");
  assert.equal(generateRecurrenceOccurrences(mondayFive, { frequency: "WEEKLY", intervalWeeks: 99, endAfterOccurrences: 2 }, LONDON).length, 2, "99 weeks is clamped to 12");
});
