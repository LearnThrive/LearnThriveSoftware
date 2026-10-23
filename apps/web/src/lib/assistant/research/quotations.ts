/**
 * Comparing a quotation a student (or the model) wrote with the words of a source. "Exact" survives differences that are not differences of words:
 * capitals, punctuation, spacing, curly quotes, line breaks, and `...` for a stretch left out. "Variant" is close but not the same words (a modernised
 * spelling, a word dropped, a different edition): worth saying so, never worth calling a match. Everything else is "none".
 */
export type QuoteKind = "exact" | "variant" | "none";

export interface QuoteMatch {
  kind: QuoteKind;
  /** 0 to 1: the share of the quotation's words found in order in the best-fitting stretch of the source. */
  similarity: number;
  /** The words of the source that matched, when there was a match (so the reply can show what the text really says). */
  matched: string;
  /** A quotation of fewer than three words proves little whatever it matches. */
  short: boolean;
  elided: boolean;
}

export const words = (text: string): string[] =>
  text
    .normalize("NFKD")
    .replace(new RegExp("\\p{M}", "gu"), "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

const ELISION = /\.{2,}|…|\[\s*(?:\.{2,}|…)\s*\]|\(\s*(?:\.{2,}|…)\s*\)/;

/** Edit distance, stopping early once it passes `limit`. */
function near(a: string, b: string, limit: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > limit) return false;
    prev = row;
  }
  return prev[b.length]! <= limit;
}

const same = (a: string, b: string): boolean => a === b || (a.length >= 5 && b.length >= 5 && near(a, b, 1));

/** Index of the first place `needle` occurs in `hay` at or after `from` with every word equal, or -1. */
function find(hay: string[], needle: string[], from: number, loose: boolean): number {
  outer: for (let i = from; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (loose ? !same(hay[i + j]!, needle[j]!) : hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function matchQuotation(claimed: string, source: string): QuoteMatch {
  const segments = claimed.split(ELISION).map(words).filter((s) => s.length);
  const all = segments.flat();
  const hay = words(source);
  const none: QuoteMatch = { kind: "none", similarity: 0, matched: "", short: all.length < 3, elided: segments.length > 1 };
  if (!all.length || !hay.length) return none;
  const elided = segments.length > 1;
  // Every segment, in order, word for word.
  let at = 0;
  let first = -1;
  let last = 0;
  let ok = true;
  for (const seg of segments) {
    const i = find(hay, seg, at, false);
    if (i < 0) {
      ok = false;
      break;
    }
    if (first < 0) first = i;
    at = i + seg.length;
    last = at;
  }
  if (ok) return { kind: "exact", similarity: 1, matched: hay.slice(first, last).join(" "), short: all.length < 3, elided };
  // The same, allowing a one-letter difference in longer words (o'erleaps / overleaps, spelling variants).
  at = 0;
  first = -1;
  ok = true;
  for (const seg of segments) {
    const i = find(hay, seg, at, true);
    if (i < 0) {
      ok = false;
      break;
    }
    if (first < 0) first = i;
    at = i + seg.length;
    last = at;
  }
  if (ok) return { kind: "variant", similarity: 0.95, matched: hay.slice(first, last).join(" "), short: all.length < 3, elided };
  if (all.length < 3) return none;
  // Best-fitting stretch: the longest run of the quotation's words found in order, over windows of about the same length.
  let best = 0;
  let bestAt = 0;
  const span = all.length + 3;
  for (let start = 0; start < hay.length; start += 1) {
    const window = hay.slice(start, start + span);
    let a = 0;
    let hits = 0;
    for (const w of window) {
      if (a < all.length && same(w, all[a]!)) {
        hits += 1;
        a += 1;
      }
    }
    if (hits > best) {
      best = hits;
      bestAt = start;
    }
  }
  const similarity = best / all.length;
  return similarity >= 0.8 ? { kind: "variant", similarity, matched: hay.slice(bestAt, bestAt + span).join(" "), short: false, elided } : { kind: "none", similarity, matched: "", short: false, elided };
}

/** Quoted passages of three or more words in a text (straight, curly and single quotes; apostrophes inside words do not open or close one). */
export function extractQuotations(text: string): string[] {
  const found: string[] = [];
  const patterns = [/[“"]([^“”"\n]{8,300}?)[”"]/g, /(?<![A-Za-z0-9])['‘]([^'‘’\n]*(?:['’][A-Za-z][^'‘’\n]*)*?)['’](?![A-Za-z0-9])/g];
  for (const re of patterns) for (const m of text.matchAll(re)) if (words(m[1]!).length >= 3 && !found.includes(m[1]!.trim())) found.push(m[1]!.trim());
  return found;
}
