import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 feature A4: the calendar file. RFC 5545 correctness, DST safety and a minimal payload.

const { buildIcs, escapeIcsText, foldIcsLine, formatIcsUtc } = loadTsFrom(import.meta.url, "../src/lib/calendar/ics.ts");

const lesson = (overrides = {}) => ({
  id: "lesson-1", title: "GCSE Maths", subject: "Maths", startAt: "2026-11-03T16:00:00.000Z", durationMinutes: 60,
  online: true, tutorName: "Tahasin Hasan", cancelled: false, url: "https://www.learnthrivetuition.co.uk/dashboard/lessons/lesson-1",
  whenLocal: "Tue, 3 Nov, 16:00-17:00 (UK time)", ...overrides,
});
const NOW = new Date("2026-10-02T12:00:00.000Z");
const unfold = (text) => text.replace(/\r\n /g, "");

test("a file is a VCALENDAR with CRLF line endings and one VEVENT per lesson", () => {
  const ics = buildIcs([lesson(), lesson({ id: "lesson-2", startAt: "2026-11-10T16:00:00.000Z" })], { now: NOW });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.equal((ics.match(/END:VEVENT/g) ?? []).length, 2);
  assert.ok(!/[^\r]\n/.test(ics), "every line break is CRLF");
});

test("times are exact UTC instants, so 16:00 London stays 16:00 London either side of a clock change", () => {
  // Autumn: BST ends 25 Oct 2026. A 16:00 London lesson is 15:00Z before it and 16:00Z after it.
  const beforeChange = buildIcs([lesson({ startAt: "2026-10-20T15:00:00.000Z" })], { now: NOW });
  const afterChange = buildIcs([lesson({ startAt: "2026-11-03T16:00:00.000Z" })], { now: NOW });
  assert.match(beforeChange, /DTSTART:20261020T150000Z/);
  assert.match(afterChange, /DTSTART:20261103T160000Z/);
  assert.doesNotMatch(beforeChange + afterChange, /RRULE|TZID|VTIMEZONE/, "no re-expanding recurrence rule and no timezone block to get wrong");
  assert.match(afterChange, /DTEND:20261103T170000Z/);
});

test("a series is separate events, each with its own instant and a stable UID", () => {
  const ics = buildIcs([lesson({ id: "a", startAt: "2026-10-20T15:00:00.000Z" }), lesson({ id: "b", startAt: "2026-11-03T16:00:00.000Z" })], { now: NOW });
  assert.match(ics, /UID:a@learnthrivetuition\.co\.uk/);
  assert.match(ics, /UID:b@learnthrivetuition\.co\.uk/);
  assert.equal(buildIcs([lesson()], { now: NOW }), buildIcs([lesson()], { now: NOW }), "deterministic for the same input");
});

test("the local time and the zone are written in words", () => {
  const ics = unfold(buildIcs([lesson()], { now: NOW }));
  assert.match(ics, /DESCRIPTION:Tue\\, 3 Nov\\, 16:00-17:00 \(UK time\)/);
  assert.match(ics, /X-WR-TIMEZONE:Europe\/London/);
});

test("text values are escaped: commas, semicolons, backslashes and newlines cannot break a line or inject a property", () => {
  assert.equal(escapeIcsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const nasty = lesson({ title: "Maths, Year 10; \"extra\"\r\nEND:VEVENT\r\nBEGIN:VEVENT", tutorName: "O'Neil\nSTATUS:CANCELLED" });
  const ics = unfold(buildIcs([nasty], { now: NOW }));
  assert.equal((ics.match(/^BEGIN:VEVENT/gm) ?? []).length, 1, "a title cannot start a second event (it is only text inside one value)");
  assert.equal((ics.match(/^END:VEVENT/gm) ?? []).length, 1);
  assert.equal((ics.match(/^STATUS:/gm) ?? []).length, 1, "a name cannot add a STATUS property");
  assert.match(ics, /STATUS:CONFIRMED/);
});

test("long lines are folded at 75 octets without splitting a multi-byte character", () => {
  const long = "X".repeat(200);
  const folded = foldIcsLine(`SUMMARY:${long}`);
  for (const physical of folded.split("\r\n")) assert.ok(new TextEncoder().encode(physical).length <= 75, "a folded line is at most 75 octets");
  assert.equal(folded.replace(/\r\n /g, ""), `SUMMARY:${long}`, "unfolding gives the original back");
  const accents = foldIcsLine(`SUMMARY:${"é".repeat(120)}`);
  assert.equal(accents.replace(/\r\n /g, ""), `SUMMARY:${"é".repeat(120)}`);
  for (const physical of accents.split("\r\n")) assert.ok(new TextEncoder().encode(physical).length <= 75);
});

test("a cancelled lesson is marked CANCELLED, an online one says so and an in-person one gives its place", () => {
  const ics = buildIcs([lesson({ cancelled: true }), lesson({ id: "p", online: false, location: "Library, Room 2" })], { now: NOW });
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /LOCATION:Online \(LearnThrive classroom\)/);
  assert.match(unfold(ics), /LOCATION:Library\\, Room 2/);
});

test("the file carries the minimum: no notes, no report text, no student or parent names", () => {
  const ics = unfold(buildIcs([lesson({ notes: "PRIVATE NOTE", report: "PRIVATE REPORT", studentNames: ["Child Name"] })], { now: NOW }));
  assert.doesNotMatch(ics, /PRIVATE|Child Name/);
  assert.match(ics, /Tutor: Tahasin Hasan/);
});

test("formatIcsUtc drops separators and milliseconds", () => {
  assert.equal(formatIcsUtc("2026-11-03T16:00:00.000Z"), "20261103T160000Z");
  assert.equal(formatIcsUtc(new Date("2027-01-01T00:00:05.250Z")), "20270101T000005Z");
});
