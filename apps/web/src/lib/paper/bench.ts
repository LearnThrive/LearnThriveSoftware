import type { LineBox } from "@/lib/assistant/documents";
import type { Placement, SolvedQuestion } from "./annotate";
import { equivalent, sameValue, valueOf } from "./maths";
import type { PaperQuestion, Rect } from "./questions";

/**
 * Scoring for the Paper Tutor benchmark (scripts/paper-bench.mjs, docs/PAPER_BENCHMARK.md). Pure functions: the same inputs always give the same
 * scores, so the scoring itself is unit-tested and a number in a report can be reproduced. What is measured, kept apart:
 *
 *   extraction     were the right questions found, with the right printed labels, in order, and nothing invented?
 *   transcription  how close is the text read to the text that is printed?
 *   answers        is the final answer right (judged against the annotator's answer, by calculation where it can be)?
 *   verification   of the answers shown, how many does the checker call verified, and how many of THOSE are wrong (false "verified")?
 *   placement      is every answer written inside its answer space, over no printing, at a readable size?
 *
 * A case is never "passed" by being skipped: a case with no file, or a hash that does not match, is reported as NOT RUN.
 */
export type Split = "dev" | "heldout";

export interface ExpectedQuestion {
  /** The label as printed: "1", "2(a)", "3(b)(ii)". */
  label: string;
  /** The question's printed text (or a distinctive part of it), for transcription scoring. */
  text?: string;
  /** The right final answer as the annotator wrote it ("x = 2 or x = -2", "3/4", "12 cm"). Absent: the question is not scored for its answer. */
  answer?: string;
  marks?: number | null;
}

export interface BenchCase {
  id: string;
  title: string;
  /** Tune on "dev" only. "heldout" cases are looked at once, to report, and never to change the code. */
  split: Split;
  source: { kind: "synthetic" } | { kind: "external"; board?: string; series?: string; url: string | null; licence: string; note?: string };
  /** The file, relative to the benchmark folder; null for a synthetic case (built by the harness). */
  file: string | null;
  sha256: string | null;
  expected: { pages?: number; skippedPages?: number[]; questions: ExpectedQuestion[] };
}

const norm = (label: string) => label.replace(/\s+/g, "").toLowerCase();

export interface ExtractionScore {
  expected: number;
  found: number;
  matched: number;
  missing: string[];
  extra: string[];
  /** The matched labels appear in the paper's order. */
  inOrder: boolean;
  precision: number;
  recall: number;
}

export function scoreExtraction(expected: readonly ExpectedQuestion[], found: readonly Pick<PaperQuestion, "number">[]): ExtractionScore {
  const want = expected.map((e) => norm(e.label));
  const got = found.map((f) => norm(f.number));
  const gotSet = new Set(got);
  const wantSet = new Set(want);
  const matched = want.filter((w) => gotSet.has(w));
  const order = got.filter((g) => wantSet.has(g));
  const inOrder = order.every((label, i) => label === matched[i]);
  return {
    expected: want.length,
    found: got.length,
    matched: matched.length,
    missing: expected.filter((e) => !gotSet.has(norm(e.label))).map((e) => e.label),
    extra: found.filter((f) => !wantSet.has(norm(f.number))).map((f) => f.number),
    inOrder,
    precision: got.length ? matched.length / got.length : 1,
    recall: want.length ? matched.length / want.length : 1,
  };
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9.%+\-=/^()]+/g, " ").trim().split(/\s+/).filter(Boolean);

/** Dice similarity of the two texts' words: 1 for the same words, 0 for none shared. Order and spacing do not matter (a wrapped line is the same words). */
export function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 && y.length === 0) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const w of x) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of y) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      shared += 1;
      counts.set(w, n - 1);
    }
  }
  return (2 * shared) / (x.length + y.length);
}

export interface TranscriptionScore {
  scored: number;
  mean: number;
  worst: Array<{ label: string; similarity: number }>;
}

/** How close the text read is to the printed text, for the questions both lists have (matched by label). Compared on the expected text's words, so a stem added to a part does not count against it. */
export function scoreTranscription(expected: readonly ExpectedQuestion[], found: ReadonlyArray<Pick<PaperQuestion, "number" | "text">>): TranscriptionScore {
  const byLabel = new Map(found.map((f) => [norm(f.number), f.text]));
  const rows: Array<{ label: string; similarity: number }> = [];
  for (const e of expected) {
    const text = byLabel.get(norm(e.label));
    if (e.text === undefined || text === undefined) continue;
    // Containment, not equality: what the annotator typed should be found in what was read (which may carry a stem).
    const want = words(e.text);
    const have = new Set(words(text));
    rows.push({ label: e.label, similarity: want.length ? want.filter((w) => have.has(w)).length / want.length : 1 });
  }
  return { scored: rows.length, mean: rows.length ? rows.reduce((t, r) => t + r.similarity, 0) / rows.length : 1, worst: [...rows].sort((a, b) => a.similarity - b.similarity).slice(0, 5) };
}

/** Is a final answer the annotator's answer? By value or by algebra where it can be told, else by the same words. */
export function sameAnswer(shown: string, expected: string): boolean {
  const clean = (s: string) => s.replace(/\\(?:left|right)/g, "").replace(/\$/g, "").replace(/\s+/g, " ").trim();
  const a = clean(shown);
  const b = clean(expected);
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const sets = (s: string) => s.split(/\bor\b|,|;|\band\b/i).map((p) => p.replace(/^[a-z]\s*=\s*/i, "").trim()).filter(Boolean);
  const left = sets(a);
  const right = sets(b);
  if (left.length !== right.length) return false;
  const one = (p: string, q: string) => {
    const x = valueOf(p);
    const y = valueOf(q);
    if (x !== null && y !== null) {
      if (!sameValue(x, y)) return false;
      // The annotator wrote an exact value (5/6, a surd) and the answer is a decimal for a value that does not terminate: a rounding the question did not ask for.
      const terminating = Math.abs(y * 1e6 - Math.round(y * 1e6)) < 1e-6;
      return terminating || q.includes(".") || !/\d\.\d/.test(p);
    }
    return equivalent(p, q) === true;
  };
  // The same solutions in any order.
  const used = new Set<number>();
  return left.every((p) => {
    const at = right.findIndex((q, i) => !used.has(i) && one(p, q));
    if (at < 0) return false;
    used.add(at);
    return true;
  });
}

export interface AnswerScore {
  /** Questions with an expected answer that were solved (asked). */
  scored: number;
  correct: number;
  accuracy: number;
  /** Shown as verified (or checked against the AI's reading) by the checker. */
  verified: number;
  /** Verified AND wrong: the number that must be zero. */
  falseVerified: Array<{ label: string; shown: string; expected: string }>;
  /** Correct AND verified, over correct: how much of what is right the checker can vouch for. */
  verifiedCoverage: number;
  status: Record<string, number>;
}

export function scoreAnswers(expected: readonly ExpectedQuestion[], solved: readonly SolvedQuestion[]): AnswerScore {
  const byLabel = new Map(solved.map((s) => [norm(s.number), s]));
  const status: Record<string, number> = {};
  let scored = 0;
  let correct = 0;
  let verified = 0;
  let correctAndVerified = 0;
  const falseVerified: AnswerScore["falseVerified"] = [];
  for (const e of expected) {
    const s = byLabel.get(norm(e.label));
    if (!s || e.answer === undefined) continue;
    scored += 1;
    status[s.status] = (status[s.status] ?? 0) + 1;
    const right = s.finalAnswer !== "" && sameAnswer(s.finalAnswer, e.answer);
    if (right) correct += 1;
    const vouched = s.status === "verified" || s.status === "checked_reading";
    if (vouched) verified += 1;
    if (vouched && right) correctAndVerified += 1;
    if (vouched && !right) falseVerified.push({ label: e.label, shown: s.finalAnswer, expected: e.answer });
  }
  return { scored, correct, accuracy: scored ? correct / scored : 1, verified, falseVerified, verifiedCoverage: correct ? correctAndVerified / correct : 1, status };
}

export interface PlacementScore {
  placements: number;
  /** Written over printing, below the minimum size, or off the page. */
  bad: Array<{ questionId: string; why: string }>;
  ok: number;
}

const overlaps = (a: Rect, line: LineBox) => a.x < line.x + line.w && a.x + a.w > line.x && a.y < line.y + line.h && a.y + a.h > line.y;

export function scorePlacement(placements: readonly Placement[], pages: ReadonlyArray<{ number: number; width: number; height: number; lines: LineBox[] }>, minSize = 11): PlacementScore {
  const bad: PlacementScore["bad"] = [];
  for (const p of placements) {
    const page = pages.find((x) => x.number === p.page);
    if (!page) {
      bad.push({ questionId: p.questionId, why: "no such page" });
      continue;
    }
    if (p.size < minSize) bad.push({ questionId: p.questionId, why: `written at ${p.size} pt` });
    else if (p.rect.x < 0 || p.rect.y < 0 || p.rect.x + p.rect.w > page.width + 1 || p.rect.y + p.rect.h > page.height + 1) bad.push({ questionId: p.questionId, why: "off the page" });
    else if (page.lines.some((l) => overlaps(p.rect, l))) bad.push({ questionId: p.questionId, why: "over printed text" });
  }
  return { placements: placements.length, bad, ok: placements.length - bad.length };
}

/** The numbers a release is held to, set BEFORE the held-out cases are run and not changed after seeing them. */
export const RELEASE_THRESHOLDS = {
  extractionRecall: 0.95,
  extractionPrecision: 0.95,
  transcription: 0.9,
  /** A wrong answer vouched for by the checker is the one failure that cannot be traded off. */
  falseVerified: 0,
  placementBad: 0,
} as const;

export interface CaseReport {
  id: string;
  split: Split;
  status: "run" | "not_run";
  reason?: string;
  extraction?: ExtractionScore;
  transcription?: TranscriptionScore;
  answers?: AnswerScore;
  placement?: PlacementScore;
  seconds?: number;
}

export interface Summary {
  split: Split | "all";
  cases: number;
  run: number;
  notRun: number;
  extractionRecall: number | null;
  extractionPrecision: number | null;
  transcription: number | null;
  answerAccuracy: number | null;
  verifiedCoverage: number | null;
  falseVerified: number;
  placementBad: number;
  seconds: number;
  /** Per threshold: met or not. "unmeasured" when no case measured it, which is never a pass. */
  gates: Record<string, "met" | "failed" | "unmeasured">;
}

const mean = (values: number[]) => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : null);

/** Micro-averaged over questions (a long paper counts for more than a short one), not over cases. */
export function summarise(reports: readonly CaseReport[], split: Split | "all"): Summary {
  const mine = reports.filter((r) => split === "all" || r.split === split);
  const run = mine.filter((r) => r.status === "run");
  const sum = <T>(pick: (r: CaseReport) => T | undefined, value: (t: T) => number) => run.reduce((t, r) => { const x = pick(r); return x === undefined ? t : t + value(x); }, 0);
  const expected = sum((r) => r.extraction, (e) => e.expected);
  const found = sum((r) => r.extraction, (e) => e.found);
  const matched = sum((r) => r.extraction, (e) => e.matched);
  const scoredText = sum((r) => r.transcription, (t) => t.scored);
  const scoredAnswers = sum((r) => r.answers, (a) => a.scored);
  const correct = sum((r) => r.answers, (a) => a.correct);
  const coverageNumber = sum((r) => r.answers, (a) => a.verifiedCoverage * a.correct);
  const falseVerified = sum((r) => r.answers, (a) => a.falseVerified.length);
  const placementBad = sum((r) => r.placement, (p) => p.bad.length);
  const placed = sum((r) => r.placement, (p) => p.placements);
  const recall = expected ? matched / expected : null;
  const precision = found ? matched / found : null;
  const transcription = scoredText ? sum((r) => r.transcription, (t) => t.mean * t.scored) / scoredText : null;
  const gate = (measured: boolean, ok: boolean): "met" | "failed" | "unmeasured" => (!measured ? "unmeasured" : ok ? "met" : "failed");
  return {
    split,
    cases: mine.length,
    run: run.length,
    notRun: mine.length - run.length,
    extractionRecall: recall,
    extractionPrecision: precision,
    transcription,
    answerAccuracy: scoredAnswers ? correct / scoredAnswers : null,
    verifiedCoverage: correct ? coverageNumber / correct : null,
    falseVerified,
    placementBad,
    seconds: mean(run.map((r) => r.seconds ?? 0)) ?? 0,
    gates: {
      extractionRecall: gate(recall !== null, (recall ?? 0) >= RELEASE_THRESHOLDS.extractionRecall),
      extractionPrecision: gate(precision !== null, (precision ?? 0) >= RELEASE_THRESHOLDS.extractionPrecision),
      transcription: gate(transcription !== null, (transcription ?? 0) >= RELEASE_THRESHOLDS.transcription),
      falseVerified: gate(scoredAnswers > 0, falseVerified <= RELEASE_THRESHOLDS.falseVerified),
      placementBad: gate(placed > 0, placementBad <= RELEASE_THRESHOLDS.placementBad),
    },
  };
}
