import { extractQuotations } from "../research/quotations";
import type { QuoteStatus } from "../research/verify";
import type { StudyContext } from "./context";

/**
 * Practice marking of an English Literature essay against the AQA assessment objectives. The model writes the feedback; the SERVER decides what the
 * evidence allows. A mark above what the essay's evidence supports (quotations that could not be verified, no quotations at all, no context, a
 * fragment of an answer) is brought down and the reason is shown, so a fluent reply cannot talk its way to a high mark. The result is always practice
 * feedback: it is not an official mark, a grade, or a prediction, and never says otherwise.
 */
export interface Objective {
  id: "AO1" | "AO2" | "AO3" | "AO4";
  label: string;
  max: number;
  looksFor: string;
}

export interface MarkFrame {
  name: string;
  total: number;
  objectives: Objective[];
}

const AO1: Objective = { id: "AO1", label: "Response to the task and the text", max: 12, looksFor: "a personal, well-developed response to the question, with well-chosen references and quotations that support it" };
const AO2: Objective = { id: "AO2", label: "Language, form and structure", max: 12, looksFor: "analysis of the writer's methods, using subject terminology, tied to meaning and effect" };
const AO3: Objective = { id: "AO3", label: "Context", max: 6, looksFor: "understanding of the context of the text, linked to the question, not added on" };
const AO4: Objective = { id: "AO4", label: "Spelling, punctuation and grammar", max: 4, looksFor: "accurate spelling and punctuation, varied sentence structure and appropriate vocabulary" };

/** The AQA GCSE English Literature frames. Shakespeare and the modern text carry AO4 (34 marks); the 19th-century novel and the poetry do not (30). */
export function markFrame(ctx: Pick<StudyContext, "subject" | "board" | "qualification" | "work" | "marks">, text = ""): MarkFrame | null {
  if (ctx.subject !== "english_literature") return null;
  if (ctx.board && ctx.board !== "AQA") return null; // only AQA's published structure is encoded
  if (ctx.qualification && ctx.qualification !== "GCSE") return null;
  const is34 = ctx.marks === 34 || ((ctx.marks === null || ctx.marks === 30) && /\b(?:macbeth|inspector calls|romeo|othello|tempest|much ado|julius caesar|blood brothers|animal farm|lord of the flies|of mice and men)\b/i.test(`${ctx.work ?? ""} ${text}`));
  if (is34) return { name: "AQA GCSE English Literature: Shakespeare / modern text", total: 34, objectives: [AO1, AO2, AO3, AO4] };
  if (ctx.marks === 30 || /\b(?:christmas carol|jekyll|jane eyre|pride and prejudice|great expectations|frankenstein|power and conflict|anthology)\b/i.test(`${ctx.work ?? ""} ${text}`)) return { name: "AQA GCSE English Literature: 19th-century novel / poetry", total: 30, objectives: [AO1, AO2, AO3] };
  return null;
}

export interface Evidence {
  words: number;
  quotes: Array<{ text: string; status: QuoteStatus | "unchecked" }>;
  hasContext: boolean;
  /** For a "whole play" question: how many different parts of the text the essay refers to. */
  partsReferred: number;
  wholeTextQuestion: boolean;
}

const CONTEXT = /\b(?:context|contextual|written in|jacobean|elizabethan|edwardian|victorian|james i|king james|divine right|great chain of being|witchcraft|priestley|1606|1912|1945|1843|1886|audience (?:at the time|of the time|in)|society (?:at the time|of the time)|at the time|class system|capitalis\w*|socialis\w*|suffrage|patriarch\w*|gender roles?)\b/i;
const PARTS = /\b(?:act\s+[1-5]|act\s+(?:one|two|three|four|five)|scene\s+\d+|beginning|opening|end(?:ing)?|climax|conclusion|first|final|later|earlier|by the end|at the start)\b/gi;

export function essayEvidence(essay: string, question: string, statusOf: (quote: string) => QuoteStatus | "unchecked"): Evidence {
  const quotes = extractQuotations(essay).map((text) => ({ text, status: statusOf(text) }));
  return {
    words: (essay.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length,
    quotes,
    hasContext: CONTEXT.test(essay),
    partsReferred: new Set((essay.match(PARTS) ?? []).map((p) => p.toLowerCase())).size,
    wholeTextQuestion: /\b(?:whole (?:play|text|novel|poem)|throughout (?:the )?(?:play|text|novel)|at different points|elsewhere in the (?:play|text|novel))\b/i.test(question),
  };
}

export interface Adjustment {
  id: Objective["id"];
  from: number;
  to: number;
  reason: string;
}

export interface Capped {
  marks: Record<string, number>;
  total: number;
  adjustments: Adjustment[];
}

const BAD: ReadonlySet<string> = new Set(["paraphrase_or_misquote", "unsupported"]);

/** Brings each awarded mark down to what the evidence supports. Never raises one. */
export function capMarks(awarded: Record<string, number>, frame: MarkFrame, evidence: Evidence): Capped {
  const marks: Record<string, number> = {};
  const adjustments: Adjustment[] = [];
  const cap = (o: Objective, value: number, limit: number, reason: string) => {
    const allowed = Math.floor(limit);
    if (value > allowed) {
      adjustments.push({ id: o.id, from: value, to: allowed, reason });
      return allowed;
    }
    return value;
  };
  const checked = evidence.quotes.filter((q) => q.status !== "unchecked");
  const badShare = checked.length ? checked.filter((q) => BAD.has(q.status)).length / checked.length : 0;
  for (const o of frame.objectives) {
    let v = Math.max(0, Math.min(o.max, Math.round((awarded[o.id] ?? 0) * 2) / 2));
    if (evidence.words < 80) v = cap(o, v, o.max * 0.25, "this is only a few lines, which cannot show a developed response");
    else if (evidence.words < 200) v = cap(o, v, o.max * 0.55, "the answer is short and unfinished compared with a full response");
    else if (evidence.words < 300 && o.id !== "AO4") v = cap(o, v, o.max * 0.75, "the answer is shorter than a full response");
    if ((o.id === "AO1" || o.id === "AO2") && evidence.quotes.length === 0) v = cap(o, v, o.max * 0.5, "there are no quotations or close references to the text");
    if ((o.id === "AO1" || o.id === "AO2") && badShare >= 0.5 && checked.length >= 2) v = cap(o, v, o.max * 0.6, "at least half the quotations could not be matched to the text");
    else if (o.id === "AO1" && badShare > 0) v = cap(o, v, o.max * 0.8, "a quotation could not be matched to the text");
    if (o.id === "AO3" && !evidence.hasContext) v = cap(o, v, o.max * 0.34, "nothing links the context to the question");
    if (o.id === "AO1" && evidence.wholeTextQuestion && evidence.partsReferred < 2) v = cap(o, v, o.max * 0.75, "the question asks about the whole text, but the answer stays in one part");
    marks[o.id] = v;
  }
  return { marks, total: Object.values(marks).reduce((a, b) => a + b, 0), adjustments };
}

const NUMBER = "(\\d+(?:\\.\\d+)?)";

/** The marks the model awarded, read from its reply (for example "AO1: 9/12"). Only objectives found with the right maximum are returned. */
export function parseAwardedMarks(answer: string, frame: MarkFrame): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of frame.objectives) {
    const m = new RegExp(`\\b${o.id}\\b[^\\n\\d]{0,60}?${NUMBER}\\s*(?:/|out of)\\s*${o.max}\\b`, "i").exec(answer);
    if (m) out[o.id] = Number(m[1]);
  }
  return out;
}

export function describeFrame(frame: MarkFrame): string {
  return `${frame.name}, ${frame.total} marks: ${frame.objectives.map((o) => `${o.id} ${o.label} (${o.max}): looks for ${o.looksFor}`).join("; ")}.`;
}

/** The note shown after a marked reply when the evidence lowers a mark, or when the reply gave no readable marks. Empty when nothing needs saying. */
export function markingNote(answer: string, frame: MarkFrame, evidence: Evidence): string {
  const awarded = parseAwardedMarks(answer, frame);
  if (Object.keys(awarded).length < frame.objectives.length) return "";
  const capped = capMarks(awarded, frame, evidence);
  if (!capped.adjustments.length) return "";
  const lines = capped.adjustments.map((a) => `- ${a.id}: ${a.from} lowered to ${a.to}, because ${a.reason}.`);
  const before = Object.values(awarded).reduce((a, b) => a + b, 0);
  return `Marking check: the evidence in your essay supports a lower mark than I gave.\n${lines.join("\n")}\nPractice total: ${capped.total}/${frame.total} (I first wrote ${before}/${frame.total}). This is practice feedback, not an official mark or grade.`;
}
