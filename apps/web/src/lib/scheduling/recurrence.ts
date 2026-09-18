import type { RecurrenceInput } from "@learnthrive/data/domain";
import { utcToZonedWallClock, weekdayInZone, zonedTimeToUtc, type WallClock } from "./timezone";

// A materialised, deterministic occurrence list (plan section 28: "Implement deterministic
// recurrence logic") — every occurrence is generated up front as a concrete date, never computed
// lazily/virtually, since each one becomes its own independently editable Lesson row (see
// docs/SCHEDULING.md's note on why "this lesson only / this and future / entire series" needs
// real rows, not a computed series).

// A safety cap for series with neither endAfterOccurrences nor endDate set, and a hard ceiling
// even when one is — nothing about "schedule weekly forever" is a legitimate tutoring request,
// and an unbounded loop here would be a real (if accidental) denial-of-service against the
// in-memory store.
const DEFAULT_MAX_OCCURRENCES = 52;
const HARD_MAX_OCCURRENCES = 104;

function addCalendarDays(wall: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function compareDate(a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

/** Generates every occurrence's UTC start instant for a recurring series, given the first
 * occurrence's own UTC instant, the recurrence rule, and the timezone the rule's weekdays/
 * cadence are expressed in. Reasons entirely in wall-clock terms (only converting to UTC per
 * occurrence at the end) so a series crossing a DST boundary keeps the same *local* time —
 * e.g. a weekly 17:00 Europe/London lesson stays at 17:00 local, not "16:00 or 18:00 depending
 * on which side of the clock change it falls". */
export function generateRecurrenceOccurrences(
  firstOccurrenceUtc: Date,
  rule: RecurrenceInput,
  timeZone: string,
): Date[] {
  const firstWall = utcToZonedWallClock(firstOccurrenceUtc, timeZone);
  const firstWeekday = weekdayInZone(firstOccurrenceUtc, timeZone);
  const targetWeekdays = new Set(
    rule.frequency === "CUSTOM_WEEKDAYS" ? (rule.weekdays?.length ? rule.weekdays : [firstWeekday]) : [firstWeekday],
  );
  const weekCadence = rule.frequency === "BIWEEKLY" ? 2 : 1;

  const maxOccurrences = Math.min(rule.endAfterOccurrences ?? DEFAULT_MAX_OCCURRENCES, HARD_MAX_OCCURRENCES);
  const endDate = rule.endDate ? parseIsoDate(rule.endDate) : null;
  // A generous day horizon so a low-frequency CUSTOM_WEEKDAYS rule (e.g. one day a fortnight)
  // still has room to reach maxOccurrences before this loop gives up.
  const horizonDays = HARD_MAX_OCCURRENCES * 7 * 2;

  // The Sunday that starts firstWall's week, used to compute which "week number" any later date
  // falls in — needed to apply the fortnightly cadence relative to the *first* occurrence's week.
  const firstWeekStart = addCalendarDays(firstWall, -firstWeekday);

  const occurrences: Date[] = [];
  for (let offset = 0; offset <= horizonDays && occurrences.length < maxOccurrences; offset += 1) {
    const candidateDate = addCalendarDays(firstWall, offset);
    if (compareDate(candidateDate, firstWall) < 0) continue;
    if (endDate && compareDate(candidateDate, endDate) > 0) break;

    const candidateWeekday = weekdayInZone(zonedTimeToUtc({ ...candidateDate, hour: 12, minute: 0 }, timeZone), timeZone);
    if (!targetWeekdays.has(candidateWeekday)) continue;

    const daysSinceFirstWeekStart = addCalendarDaysDiff(firstWeekStart, candidateDate);
    const weekIndex = Math.floor(daysSinceFirstWeekStart / 7);
    if (weekIndex % weekCadence !== 0) continue;

    const wall: WallClock = { ...candidateDate, hour: firstWall.hour, minute: firstWall.minute };
    occurrences.push(zonedTimeToUtc(wall, timeZone));
  }
  return occurrences;
}

function addCalendarDaysDiff(from: { year: number; month: number; day: number }, to: { year: number; month: number; day: number }): number {
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}
