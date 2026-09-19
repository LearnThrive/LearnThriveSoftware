import { formatInTimeZone, LEARNTHRIVE_DEFAULT_TIMEZONE as TZ } from "@/lib/scheduling/timezone";

/** One place for the date/time wording the product uses, so "Tue 3 Nov, 15:00" means the same
 * thing on every screen. Everything renders in the scheduling timezone (Europe/London). */

export function formatLessonDateTime(instant: string | Date): string {
  return formatInTimeZone(instant, TZ, { dateStyle: "medium", timeStyle: "short" });
}

export function formatLessonDayTime(instant: string | Date): string {
  return formatInTimeZone(instant, TZ, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatLongDate(instant: string | Date): string {
  return formatInTimeZone(instant, TZ, { dateStyle: "full" });
}

export function formatTime(instant: string | Date): string {
  return formatInTimeZone(instant, TZ, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateOnly(instant: string | Date): string {
  return formatInTimeZone(instant, TZ, { dateStyle: "medium" });
}

/** "in 12 minutes" / "3 days ago" — used where the gap matters more than the clock time
 * (plan6 sections 52 and 59: a Tutor wants to know how soon, not just when). */
export function formatRelative(instant: string | Date, now: Date = new Date()): string {
  const target = typeof instant === "string" ? new Date(instant) : instant;
  const diffMs = target.getTime() - now.getTime();
  const future = diffMs >= 0;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);

  if (minutes < 1) return "now";
  const say = (value: number, unit: string) => {
    const plural = `${value} ${unit}${value === 1 ? "" : "s"}`;
    return future ? `in ${plural}` : `${plural} ago`;
  };
  if (minutes < 60) return say(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return say(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return say(days, "day");
  const weeks = Math.round(days / 7);
  if (weeks < 9) return say(weeks, "week");
  return say(Math.round(days / 30), "month");
}

/** Lesson end time from its start and duration, for "18:00–19:00" ranges. */
export function formatTimeRange(startAt: string, durationMinutes: number): string {
  const end = new Date(new Date(startAt).getTime() + durationMinutes * 60_000);
  return `${formatTime(startAt)}–${formatTime(end)}`;
}
