/**
 * Small helpers the careers application, the safeguarding reconfirmation and the subject request all use to
 * read what a visitor sent. No Node imports: the forms use them in the browser, the routes on the server.
 *
 * The rule throughout: the server never trusts the shape of what it receives. Every value is coerced to the
 * expected type (anything else becomes empty), trimmed, and checked against a limit; unknown keys are ignored.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_PATTERN = /^[0-9+()\s-]{7,25}$/;

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

/** A list of strings (anything else, and non-strings inside a list, are dropped), capped at `max` entries. */
export function asStringArray(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").slice(0, max);
}

/** A string-to-string record (the understanding answers), keys and values length-limited. */
export function asStringRecord(value: unknown, maxKeys = 20): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, maxKeys)) {
    if (typeof entry === "string" && key.length <= 60 && entry.length <= 60) out[key] = entry;
  }
  return out;
}

/** A single line: control characters and line breaks become spaces, runs of spaces collapse, trimmed. */
export function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** Free text: line breaks are kept (as \n), other control characters removed, outer space trimmed. */
export function cleanText(value: string): string {
  return (
    value
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Zl}\p{Zp}]/gu, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Whether a string is a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Strips anything that looks like markup from a short typed-in value (a subject name). */
export function stripMarkup(value: string): string {
  return value.replace(/<[^>]*>?/g, "").replace(/[<>]/g, "");
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
