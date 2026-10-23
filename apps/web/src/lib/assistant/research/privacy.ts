/**
 * What may leave the building in a search. A student's essay can carry their name, school, address or contact details, and a search engine (even one
 * we run, which asks others) is not the place for them. Queries are built from the smallest non-identifying pieces (a quoted phrase, a work and its
 * author, a few topic words), never from pasted text, and any free-text query a model writes is cleaned before it is sent.
 */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:\+?44\s?|0)(?:\d[\s-]?){9,10}\d|\b\d{3,5}[\s-]\d{3,4}[\s-]?\d{3,4}\b/g;
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const NAME_INTRO = /\b(?:my\s+name\s+is|i\s*am\s+called|i['’]m\s+called|call\s+me|this\s+is\s+me,?|written\s+by|by\s+me,?|name\s*:)\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?/giu;
const SCHOOL = /\b(?:i\s+(?:go|went|attend)\s+to|i\s+am\s+(?:at|in)|i['’]m\s+(?:at|in)|from|at)\s+(?:the\s+)?[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3}\s+(?:school|academy|college|grammar|high|sixth\s+form)\b/giu;
const ADDRESS = /\b\d{1,4}\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?\s+(?:street|road|avenue|lane|close|drive|way|crescent|gardens|court|place)\b/giu;

/** Free text with personal details taken out, whitespace collapsed. */
export function stripPersonal(text: string): string {
  return text
    .replace(EMAIL, " ")
    .replace(PHONE, " ")
    .replace(POSTCODE, " ")
    .replace(URL_RE, " ")
    .replace(NAME_INTRO, " ")
    .replace(SCHOOL, " ")
    .replace(ADDRESS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const MAX_QUERY_CHARS = 140;

export type QueryVerdict = { ok: true; query: string; removed: boolean } | { ok: false; reason: string };

/** A model-written search query made safe: personal details removed, and refused if it is really a pasted passage rather than a short phrase. */
export function cleanQuery(raw: string): QueryVerdict {
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat) return { ok: false, reason: "empty query" };
  const cleaned = stripPersonal(flat);
  if (cleaned.length > MAX_QUERY_CHARS || cleaned.split(/\s+/).length > 24) return { ok: false, reason: "a search query is a short phrase, not a passage of the student's work" };
  if (cleaned.length < 3) return { ok: false, reason: "nothing left to search for once personal details were removed" };
  return { ok: true, query: cleaned, removed: cleaned !== flat };
}

/** A query for an exact quotation: the quoted words (capped), the work and its author, and nothing from the surrounding essay. */
export function quotationQuery(parts: { quotation: string; work?: string; author?: string }): string {
  const words = stripPersonal(parts.quotation.replace(/["“”‘’]/g, " ")).split(/\s+/).filter(Boolean).slice(0, 10).join(" ");
  return [`"${words}"`, parts.work, parts.author].filter(Boolean).join(" ").slice(0, MAX_QUERY_CHARS);
}
