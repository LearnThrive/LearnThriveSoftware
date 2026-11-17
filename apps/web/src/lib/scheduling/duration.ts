/**
 * A lesson's length is stored in minutes. The scheduling forms ask for hours and minutes ("1 hour 30 minutes"), so this turns the two boxes
 * into one number and back, and says what is wrong in plain words. Pure.
 */
export const MIN_LESSON_MINUTES = 5;
export const MAX_LESSON_MINUTES = 8 * 60;

export type ParsedDuration = { ok: true; minutes: number } | { ok: false; message: string };

/** Hours and minutes as typed (either may be empty). Whole numbers only; the total must be 5 minutes to 8 hours. */
export function parseDuration(hours: string, minutes: string): ParsedDuration {
  const h = hours.trim() === "" ? 0 : Number(hours);
  const m = minutes.trim() === "" ? 0 : Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0) return { ok: false, message: "Enter the length as whole hours and minutes." };
  const total = h * 60 + m;
  if (total < MIN_LESSON_MINUTES) return { ok: false, message: `A lesson must be at least ${MIN_LESSON_MINUTES} minutes long.` };
  if (total > MAX_LESSON_MINUTES) return { ok: false, message: "A lesson can be at most 8 hours long." };
  return { ok: true, minutes: total };
}

/** 90 becomes { hours: 1, minutes: 30 }, to fill the two boxes. */
export function splitDuration(totalMinutes: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** 90 becomes "1 hour 30 minutes", 120 "2 hours", 45 "45 minutes". */
export function formatDuration(totalMinutes: number): string {
  const { hours, minutes } = splitDuration(totalMinutes);
  const parts = [hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "", minutes ? `${minutes} minute${minutes === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.join(" ") || "0 minutes";
}
