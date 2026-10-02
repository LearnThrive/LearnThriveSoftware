/**
 * iCalendar (RFC 5545) output for "Add to calendar" (plan15 Wave 11, feature A4). A pure builder: no I/O, no
 * framework, so it is unit-tested directly (tests/ics.test.mjs).
 *
 * DST SAFETY, and why every occurrence is its own event in UTC. A lesson's `startAt` is already an exact
 * instant: the scheduling service converts "every Tuesday at 16:00 London time" into the right UTC instant
 * for each date, including across the clocks changing (docs/SCHEDULING.md). Writing each occurrence out as
 * its own VEVENT with that instant (`DTSTART:...Z`) therefore keeps 16:00 as 16:00 London time on both sides
 * of a clock change, with no RRULE for a calendar app to re-expand wrongly and no VTIMEZONE block to get
 * wrong. The local time and the zone are written into the description in words, because "16:00" with no
 * zone is how people end up an hour out.
 *
 * WHAT IT DOES NOT CONTAIN: no lesson notes, no student or parent names beyond what the caller passes in
 * `attendees` (the route passes none), nothing from a report. A calendar file is saved to a phone and
 * forwarded, so it carries the minimum: what, when, where, with whom (the tutor), and a link.
 */
export interface IcsLesson {
  id: string;
  title: string;
  subject: string;
  /** ISO 8601 UTC instant. */
  startAt: string;
  durationMinutes: number;
  /** For "In person": where. Absent for an online lesson. */
  location?: string;
  online: boolean;
  tutorName?: string;
  cancelled: boolean;
  /** An absolute link back to the lesson page. */
  url: string;
  /** "Tue 3 Nov 2026, 16:00-17:00 (UK time)": already formatted by the caller in the scheduling zone. */
  whenLocal: string;
}

const CRLF = "\r\n";

/** RFC 5545 section 3.3.11: backslash, semicolon, comma and newlines are escaped in text values. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** `20261103T160000Z`: the basic UTC form every calendar app reads. */
export function formatIcsUtc(instant: string | Date): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Lines longer than 75 octets are folded (section 3.1): a CRLF and one space, continued. Folding counts
 * UTF-8 bytes and never splits a multi-byte character.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join(CRLF);
}

export function buildIcs(lessons: readonly IcsLesson[], options: { now?: Date; calendarName?: string } = {}): string {
  const stamp = formatIcsUtc(options.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LearnThrive Tuition//Lessons//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName ?? "LearnThrive lessons")}`,
    "X-WR-TIMEZONE:Europe/London",
  ];

  for (const lesson of lessons) {
    const end = new Date(new Date(lesson.startAt).getTime() + lesson.durationMinutes * 60_000);
    const place = lesson.online ? "Online (LearnThrive classroom)" : lesson.location ?? "In person";
    const description = [
      lesson.whenLocal,
      lesson.tutorName ? `Tutor: ${lesson.tutorName}` : "",
      lesson.online ? "Join from your LearnThrive dashboard shortly before the lesson." : "",
      lesson.url,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${lesson.id}@learnthrivetuition.co.uk`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatIcsUtc(lesson.startAt)}`,
      `DTEND:${formatIcsUtc(end)}`,
      `SUMMARY:${escapeIcsText(`${lesson.title} (${lesson.subject})`)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `LOCATION:${escapeIcsText(place)}`,
      `URL:${lesson.url}`,
      `STATUS:${lesson.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
