import type { Pence } from "./types";

/** The charge for a lesson: the hourly rate times the minutes, to the nearest penny (halves round up). */
export function lessonAmount(hourlyPence: Pence, minutes: number): Pence {
  return Math.round((hourlyPence * minutes) / 60);
}

/** A percentage of an amount, to the nearest penny. */
export function percentOf(amount: Pence, percent: number): Pence {
  return Math.round((amount * percent) / 100);
}

/** "£12.50" (negative: "-£12.50"). */
export function formatPence(pence: Pence): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}£${Math.floor(abs / 100).toLocaleString("en-GB")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Pounds typed by a person ("12", "12.5", "£12.50") to whole pence, or null if it is not an amount. */
export function parsePounds(text: string): Pence | null {
  const t = text.trim().replace(/^£/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [pounds = "0", frac = ""] = t.split(".");
  return Number(pounds) * 100 + Number(frac.padEnd(2, "0"));
}
