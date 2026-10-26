import { extractQuotations } from "./quotations";

/**
 * Citations the model attaches to its own quotations ("structured citations").
 *
 * Before this, a quotation was recovered from the reply's prose with a regular expression and then looked for on the web. The server never knew which
 * source the model MEANT, only that some page somewhere might carry the words, which is why a long answer's tenth quotation could only be reported as
 * unchecked: the search budget runs out long before an essay does.
 *
 * So the research block now hands the model NUMBERED sources and asks it to write the number straight after any passage it quotes:
 *
 *     Lady Macbeth calls on the spirits to "unsex me here" [[cite:1]].
 *
 * The server reads those numbers and checks the quotation against THAT page, which it has already read, so no search is spent. The marker is only the
 * model's CLAIM about where the words came from: whether the words are really there is still decided by the wording and the source's tier
 * (research/verify.ts), never by the model. What the marker buys is a narrower, cheaper, more complete check, not a weaker one.
 *
 * A quotation with no marker is not an error: it goes through the old path (extract, search, match), so a reply that ignores the rule loses nothing. A
 * marker with no quotation attached says nothing and is simply removed. The markers are stripped from the text before the student sees a word of it.
 */
export interface ParsedCitation {
  /** The number the reply cited, 1-based, as listed in the research block. */
  number: number;
  /** The quotation the marker follows in its own sentence, when there is one. */
  quotation: string | null;
  /** The sentence the marker was written in, markers removed. */
  sentence: string;
}

export const CITATION_MARKER = /\[\[\s*cite\s*:\s*(\d{1,2})\s*\]\]/gi;

/** Removing a marker leaves a space before a full stop, or a run of spaces. Tidy exactly those, and nothing else (markdown matters). */
const tidy = (text: string): string => text.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{3,}/g, " ").replace(/\n{3,}/g, "\n\n");

export const stripCitations = (text: string): string => tidy(text.replace(CITATION_MARKER, ""));

// Its own non-global copy: a `g` regular expression remembers where it last matched, so `CITATION_MARKER.test` cannot be used as a plain question.
const MARKER_PRESENT = /\[\[\s*cite\s*:\s*\d{1,2}\s*\]\]/i;

/**
 * Whether there is a marker in the text at all. The strip is only run when there is one: it tidies spacing, and an answer that never had a marker must not
 * have a single character of it touched.
 */
export const hasCitations = (text: string): boolean => MARKER_PRESENT.test(text);

/**
 * The reply's citations, and the same reply with every marker removed. Each citation is attached to the last quotation in the sentence the marker was
 * written in — the `"unsex me here" [[cite:1]]` shape — and to nothing when that sentence has no quotation.
 */
export function parseCitations(text: string): { text: string; citations: ParsedCitation[] } {
  const citations: ParsedCitation[] = [];
  let out = "";
  let last = 0;
  for (const m of text.matchAll(CITATION_MARKER)) {
    const at = m.index ?? 0;
    out += text.slice(last, at);
    const sentence = (text.slice(0, at).split(/(?<=[.!?\n])\s+/).pop() ?? "").trim();
    citations.push({ number: Number(m[1]), quotation: extractQuotations(sentence).at(-1) ?? null, sentence: stripCitations(sentence) });
    last = at + m[0].length;
  }
  out += text.slice(last);
  return { text: tidy(out), citations };
}

/** The rule that goes into the research block, beside the numbered sources it refers to. Empty when there are no sources to cite. */
export const citationRule = (sources: number): string =>
  sources > 0
    ? `When you quote a source's exact words, write the number of that source immediately after the quotation, in double square brackets, like this: "the words" [[cite:1]]. Give every quotation one of these numbers, and use only the numbers listed above.`
    : "";
