import { evaluate, sameValue } from "@/lib/paper/maths";
import { extractQuotations, words } from "../research/quotations";
import type { QuoteStatus } from "../research/verify";
import type { StudyContext } from "./context";

/**
 * The last look at a finished reply, run by the server and costing no model call. It looks only for mistakes it can prove: a quotation that
 * verification could not match to the text, a quotation that was not checked at all, a sum that is plainly wrong. What it finds is shown to
 * the student as a short "Check" under the reply. It never rewrites the reply, and it says nothing when it finds nothing.
 */
export const quoteKey = (quote: string): string => words(quote).join(" ");

const BAD: ReadonlySet<string> = new Set(["paraphrase_or_misquote", "unsupported"]);

export interface QaInput {
  answer: string;
  ctx: Pick<StudyContext, "subject" | "work" | "activity">;
  /** Verdicts reached before the reply, by quoteKey. */
  verdicts: ReadonlyMap<string, QuoteStatus>;
}

const OPS: Record<string, string> = { "×": "*", x: "*", "÷": "/", "*": "*", "/": "/", "+": "+", "-": "-", "−": "-" };

/** Plain one-step sums written as "a op b = c" that are wrong. Chains, algebra and anything with letters or brackets nearby are left alone. */
export function wrongSums(text: string): string[] {
  const out: string[] = [];
  const re = /(\d+(?:\.\d+)?)\s*([+\-−×x÷*/])\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)/g;
  for (const m of text.matchAll(re)) {
    const adjacent = text[m.index! - 1] ?? "";
    const before = text.slice(Math.max(0, m.index! - 3), m.index!).trimEnd().slice(-1);
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 3).trimStart()[0] ?? "";
    // Not part of a longer sum or an algebra line: a letter or digit touching the start, an operator before it, or anything continuing it after.
    if (/[0-9A-Za-z.]/.test(adjacent) || /[+\-−×÷*/^(=)]/.test(before) || /[0-9A-Za-z+\-−×÷*/^(=%]/.test(after)) continue;
    const value = evaluate(`${m[1]} ${OPS[m[2]!]} ${m[3]}`, {});
    if (value === null || !Number.isFinite(value)) continue;
    if (!sameValue(value, Number(m[4]))) out.push(`${m[0].replace(/\s+/g, " ")} (it is ${Math.round(value * 1e6) / 1e6})`);
  }
  return out.slice(0, 3);
}

export function qaNotes({ answer, ctx, verdicts }: QaInput): string[] {
  const notes: string[] = [];
  const lit = ctx.subject === "english_literature" || ctx.activity === "quote_check";
  if (lit) {
    const wrong: string[] = [];
    const unchecked: string[] = [];
    for (const q of extractQuotations(answer)) {
      const known = verdicts.get(quoteKey(q));
      if (known) {
        if (BAD.has(known)) wrong.push(q);
        else if (known === "unverifiable" || known === "supported_secondary") unchecked.push(q);
        continue;
      }
      if (words(q).length >= 3) unchecked.push(q);
    }
    if (wrong.length) notes.push(`These quotations could not be matched to the sources I read, so do not rely on them until you have checked the text: ${wrong.slice(0, 3).map((q) => `"${q}"`).join(", ")}.`);
    if (unchecked.length) notes.push(`I could not check ${unchecked.length === 1 ? "this quotation" : "these quotations"} against the text: ${unchecked.slice(0, 3).map((q) => `"${q}"`).join(", ")}. Check the exact wording in your copy before using ${unchecked.length === 1 ? "it" : "them"} in an exam.`);
  }
  for (const sum of wrongSums(answer)) notes.push(`This arithmetic is wrong: ${sum}.`);
  return notes;
}
