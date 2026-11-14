// CSV for the accountant and the monthly pay run (docs/TUITION_BILLING.md). Pure, so it is tested without a server.
//
// A cell that begins with = + - @ (or a tab or carriage return) would be run as a FORMULA by a spreadsheet that opens the file, and a name or a
// note typed by a person is not trusted: such a TEXT cell gets a leading apostrophe, which a spreadsheet shows as plain text. Quotes, commas
// and line breaks are escaped the standard way. Money is written in pounds with two decimals, never as pence, so the file reads as money; it
// is passed as `money(pence)` so a negative amount stays a number and is not mistaken for text that starts with a minus.

import type { Pence } from "./types";

export interface MoneyCell {
  readonly pence: Pence;
}
export const money = (pence: Pence): MoneyCell => ({ pence });

export type CsvValue = string | number | MoneyCell;

const FORMULA_START = /^[=+\-@\t\r]/;

/** 12345 -> "123.45", -250 -> "-2.50". */
export function poundsText(pence: Pence): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function csvCell(value: CsvValue): string {
  if (typeof value === "object") return poundsText(value.pence);
  let text = String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
