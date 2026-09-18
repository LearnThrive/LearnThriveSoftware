// Plan section 62: "store timestamps in an unambiguous format... do not build calendar
// calculations around naïve local strings... handle DST." Lesson.startAt is always a real UTC
// instant (an ISO 8601 string with a Z). This module is the one place that converts between
// that and wall-clock time in a specific IANA timezone — no other file should do that
// conversion by hand (e.g. by just adding/subtracting a fixed number of hours, which breaks
// across a DST boundary).
//
// No date library dependency — built entirely on Intl.DateTimeFormat, which carries the same
// tzdata the rest of the JS runtime uses and therefore already knows every zone's real,
// historical and future DST transitions.

export const LEARNTHRIVE_DEFAULT_TIMEZONE = "Europe/London";

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Converts a wall-clock date/time *as experienced in* `timeZone` into the UTC instant it
 * represents. E.g. 17:00 on a July day in Europe/London (BST, UTC+1) becomes 16:00 UTC; the same
 * wall-clock time in January (GMT, UTC+0) becomes 17:00 UTC — the DST offset is resolved
 * correctly for the specific date given, not assumed fixed. */
export function zonedTimeToUtc(wall: WallClock, timeZone: string): Date {
  const utcGuess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  const offsetMs = tzOffsetAtInstant(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offsetMs);
}

/** The reverse: what wall-clock date/time does this UTC instant correspond to in `timeZone`. */
export function utcToZonedWallClock(instant: Date, timeZone: string): WallClock {
  const parts = partsInZone(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

/** How far `timeZone`'s local time is ahead of UTC at this specific instant, in milliseconds
 * (positive east of UTC — e.g. +3,600,000 for BST). Varies across a DST boundary by design. */
export function tzOffsetAtInstant(instant: Date, timeZone: string): number {
  const parts = partsInZone(instant, timeZone);
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asIfUtc - instant.getTime();
}

function partsInZone(instant: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return { year: map.year, month: map.month, day: map.day, hour: map.hour, minute: map.minute, second: map.second };
}

/** 0 (Sunday) - 6 (Saturday) that `instant` falls on *in* `timeZone` — not necessarily the same
 * weekday as in UTC, e.g. 23:30 UTC on a Monday can already be Tuesday in Europe/London in summer... */
export function weekdayInZone(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const short = formatter.format(instant);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short];
}

export function formatInTimeZone(instant: Date | string, timeZone = LEARNTHRIVE_DEFAULT_TIMEZONE, options: Intl.DateTimeFormatOptions = {}): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(date);
}
