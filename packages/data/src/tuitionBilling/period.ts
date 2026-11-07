// Dates for billing. Everything is a plain calendar date (yyyy-mm-dd) in London, the scheduling time zone (docs/SCHEDULING.md):
// "the month of 2 November" must not depend on the machine the code runs on, or on summer time.

const LONDON = "Europe/London";
const ymdFormat = new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" });

export const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The London calendar date of an instant. */
export function londonYmd(iso: string): string {
  return ymdFormat.format(new Date(iso));
}

const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** First and last day of a yyyy-mm period. */
export function periodBounds(period: string): { start: string; end: string } {
  if (!PERIOD.test(period)) throw new Error(`Not a billing period (yyyy-mm): ${period}`);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return { start: `${period}-01`, end: `${period}-${String(daysIn(year, month)).padStart(2, "0")}` };
}

export function periodOf(ymd: string): string {
  return ymd.slice(0, 7);
}

export function previousPeriod(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** The date `months` calendar months later, clamped to the end of a shorter month (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(ymd: string, months: number): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7)) - 1 + months;
  const day = Number(ymd.slice(8, 10));
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, daysIn(y, m + 1))).padStart(2, "0")}`;
}

/** Whole calendar months from a to b (b on or after a), counting a month only once its day has been reached. */
export function monthsBetween(a: string, b: string): number {
  let months = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
  if (addMonths(a, months) > b) months -= 1;
  return Math.max(0, months);
}

/** A contract year: the start date to the day before the same date a year later. */
export function contractEndFor(start: string): string {
  const next = addMonths(start, 12);
  const d = new Date(`${next}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
