import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ChatProvider, ProviderCapabilities, ProviderHealth, ProviderMessage, StreamChunk } from "@/lib/assistant/types";
import { similarity, type Split } from "./bench";
import type { MarkedQuestion } from "./mark";
import { markCompleted, extractQuestions } from "./paper";
import type { SolveDeps } from "./solve";

/**
 * Validating the marker against work marked by a qualified person. The scoring is here and it is pure; the human-marked responses are NOT here and are
 * not made up: until a permissioned, anonymised set exists the marker is UNVALIDATED, its numeric marks stay behind PAPER_MARKS_RELEASED, and nothing in
 * this file says how reliable it is. Synthetic responses (typed, scripted) test the PIPELINE and the arithmetic of this scoring; they do not prove
 * anything about real handwriting.
 *
 * Reported (all kept apart, none merged into one score):
 *   transcription          is what was read what the student wrote (their final answer and working)?
 *   exact mark agreement   of the questions the marker FULLY assessed, how many got exactly the human's mark; the distribution of the error
 *   correctness decisions  false positives (a wrong answer called correct) and false negatives (a right answer called wrong), and so the
 *                          rate at which CORRECT student work is marked wrong
 *   method / follow-through  agreement on method marks, and whether follow-through marks went to a person instead of being guessed
 *   states                 blank, unreadable and answered told apart (a blank or unreadable answer is never "wrong")
 *   review rate            how many questions the marker sent to a person, and so how much is EXCLUDED from the accuracy figures above
 */
export type StudentState = "blank" | "unreadable" | "answered";
export type Condition = "crossed_out" | "poor_scan" | "ambiguous" | "alternative_method" | "follow_through" | "partial_credit";

export interface HumanMarkedQuestion {
  label: string;
  state: StudentState;
  /** What the student wrote as their final answer, and their working lines, as a person reads them. */
  answer: string;
  working?: string[];
  /** The human marker's decision on the final answer. */
  answerCorrect: boolean;
  /** Marks the human awarded for the question, and the method marks within them. */
  marks: number | null;
  outOf: number | null;
  methodMarks?: number;
  /** The human applied a follow-through (error carried forward) mark. */
  followThrough?: boolean;
  conditions?: Condition[];
}

export interface HumanMarkedCase {
  id: string;
  split: Split;
  /** "handwritten" is permissioned and anonymised real work, marked by a qualified person; "synthetic" tests the pipeline only. */
  kind: "handwritten" | "synthetic";
  /** Who marked it (a role, not a name) and under what permission; required for handwritten. */
  provenance: string;
  questions: HumanMarkedQuestion[];
}

export interface MarkingScore {
  questions: number;
  transcription: { scored: number; mean: number };
  /** Questions the marker fully assessed (no mark pending, no review): the only ones the agreement figures are about. */
  assessed: number;
  review: { count: number; rate: number };
  exactAgreement: { compared: number; exact: number; rate: number | null };
  /** marker minus human, in whole marks, over the compared questions. */
  errorDistribution: Record<string, number>;
  withinOneMark: number | null;
  correctness: { humanCorrect: number; humanWrong: number; falsePositives: number; falseNegatives: number; correctMarkedWrong: number | null; wrongMarkedCorrect: number | null };
  methodMarks: { compared: number; agree: number; rate: number | null };
  followThrough: { cases: number; sentToPerson: number; matched: number };
  states: { blankMarkedWrong: number; unreadableMarkedWrong: number; stateErrors: number };
  conditions: Record<string, { questions: number; falseNegatives: number }>;
}

const norm = (label: string) => label.replace(/\s+/g, "").toLowerCase();

const methodOf = (q: MarkedQuestion): number => {
  const awards = new Map(q.assessment.awards.map((a) => [a.criterionId, a]));
  return q.assessment.criteria.filter((c) => c.kind !== "A").reduce((t, c) => t + (awards.get(c.id)?.status === "awarded" ? c.marks : 0), 0);
};

/** Scores the marker's output for one human-marked case. Questions the marker did not return are counted as sent for review (nothing was claimed). */
export function scoreMarking(human: readonly HumanMarkedQuestion[], marked: readonly MarkedQuestion[]): MarkingScore {
  const byLabel = new Map(marked.map((m) => [norm(m.number), m]));
  const out: MarkingScore = {
    questions: human.length,
    transcription: { scored: 0, mean: 1 },
    assessed: 0,
    review: { count: 0, rate: 0 },
    exactAgreement: { compared: 0, exact: 0, rate: null },
    errorDistribution: {},
    withinOneMark: null,
    correctness: { humanCorrect: 0, humanWrong: 0, falsePositives: 0, falseNegatives: 0, correctMarkedWrong: null, wrongMarkedCorrect: null },
    methodMarks: { compared: 0, agree: 0, rate: null },
    followThrough: { cases: 0, sentToPerson: 0, matched: 0 },
    states: { blankMarkedWrong: 0, unreadableMarkedWrong: 0, stateErrors: 0 },
    conditions: {},
  };
  let transcription = 0;
  let within = 0;
  for (const h of human) {
    const m = byLabel.get(norm(h.label));
    const a = m?.assessment;
    const fullyAssessed = Boolean(m && a && a.review === null && a.marks.pending === 0 && a.answerState !== "unreadable" && a.answerState !== "ambiguous");
    const sentToPerson = !m || !fullyAssessed;
    if (sentToPerson) out.review.count += 1;
    else out.assessed += 1;
    for (const c of h.conditions ?? []) {
      const slot = (out.conditions[c] ??= { questions: 0, falseNegatives: 0 });
      slot.questions += 1;
    }

    // Transcription: the final answer and the working, as read against as written.
    if (m && h.state === "answered") {
      const shown = [m.student.answer, ...m.student.working].join(" ");
      const wrote = [h.answer, ...(h.working ?? [])].join(" ");
      transcription += similarity(shown, wrote);
      out.transcription.scored += 1;
    }

    // States: blank / unreadable / answered are different, and only an answered question can be wrong.
    const state = a?.answerState ?? "unreadable";
    const markedWrong = m?.outcome === "incorrect";
    if (h.state === "blank" && markedWrong) out.states.blankMarkedWrong += 1;
    if (h.state === "unreadable" && markedWrong) out.states.unreadableMarkedWrong += 1;
    if ((h.state === "blank") !== (state === "blank") || (h.state === "unreadable" && state === "answered")) out.states.stateErrors += 1;

    // Correctness decisions, over answered questions the marker made a decision on.
    if (h.state === "answered") {
      if (h.answerCorrect) out.correctness.humanCorrect += 1;
      else out.correctness.humanWrong += 1;
      const decided = m && (m.outcome === "correct" || m.outcome === "incorrect" || m.outcome === "partly");
      if (decided) {
        const saysCorrect = m!.outcome === "correct";
        if (saysCorrect && !h.answerCorrect) out.correctness.falsePositives += 1;
        if (!saysCorrect && h.answerCorrect) {
          out.correctness.falseNegatives += 1;
          for (const c of h.conditions ?? []) out.conditions[c]!.falseNegatives += 1;
        }
      }
    }

    // Marks: only where the marker fully assessed and the human gave a number.
    if (fullyAssessed && m && h.marks !== null) {
      const mine = a!.override ? (a!.override.marks ?? a!.marks.awarded) : a!.marks.awarded;
      if (mine !== null) {
        out.exactAgreement.compared += 1;
        const diff = mine - h.marks;
        if (diff === 0) out.exactAgreement.exact += 1;
        if (Math.abs(diff) <= 1) within += 1;
        const key = diff > 0 ? `+${diff}` : String(diff);
        out.errorDistribution[key] = (out.errorDistribution[key] ?? 0) + 1;
        if (h.methodMarks !== undefined) {
          out.methodMarks.compared += 1;
          if (methodOf(m) === h.methodMarks) out.methodMarks.agree += 1;
        }
      }
    }

    // Follow-through: the marker must not guess it; the human's follow-through marks should reach a person or be matched exactly.
    if (h.followThrough) {
      out.followThrough.cases += 1;
      if (!m || (a && (a.review !== null || a.awards.some((w) => w.status === "review")))) out.followThrough.sentToPerson += 1;
      else if (m && a && h.marks !== null && a.marks.awarded === h.marks) out.followThrough.matched += 1;
    }
  }
  out.transcription.mean = out.transcription.scored ? transcription / out.transcription.scored : 1;
  out.review.rate = human.length ? out.review.count / human.length : 0;
  out.exactAgreement.rate = out.exactAgreement.compared ? out.exactAgreement.exact / out.exactAgreement.compared : null;
  out.withinOneMark = out.exactAgreement.compared ? within / out.exactAgreement.compared : null;
  out.methodMarks.rate = out.methodMarks.compared ? out.methodMarks.agree / out.methodMarks.compared : null;
  const c = out.correctness;
  c.correctMarkedWrong = c.humanCorrect ? c.falseNegatives / c.humanCorrect : null;
  c.wrongMarkedCorrect = c.humanWrong ? c.falsePositives / c.humanWrong : null;
  return out;
}

/**
 * What an automatic mark is held to before the marks are released, set BEFORE the held-out set is looked at. The sample must be real work: a permissioned,
 * anonymised set of handwritten responses independently marked by a qualified person, including valid alternative methods, partial credit, crossed-out
 * working, poor scans and deliberately ambiguous handwriting. Nobody's confidence figure (the model's or ours) stands in for these.
 */
export const MARKING_THRESHOLDS = {
  /** Fewest human-marked questions, from real handwriting, before any gate can be called met. */
  minQuestions: 300,
  minStudents: 10,
  transcription: 0.9,
  exactAgreement: 0.85,
  withinOneMark: 0.97,
  /** Correct student work marked wrong, and wrong work marked correct. */
  correctMarkedWrong: 0.02,
  wrongMarkedCorrect: 0.02,
  /** A blank or unreadable answer called wrong. */
  statesWrong: 0,
  /** Above this much sent to a person the marker is not saving anyone the work; the accuracy figures also exclude what it sends. */
  reviewRate: 0.35,
} as const;

export type GateState = "met" | "failed" | "unmeasured";

export interface MarkingSummary {
  questions: number;
  students: number;
  handwrittenQuestions: number;
  score: MarkingScore;
  gates: Record<string, GateState>;
  /** "unvalidated" until every gate is met on enough real handwritten work. The release flag follows this, not the other way round. */
  validation: "unvalidated" | "validated";
  reasons: string[];
}

/** Adds the per-case scores together (micro-averaged over questions) and judges them against the thresholds. Synthetic cases never count towards a gate. */
export function summariseMarking(cases: ReadonlyArray<{ case: HumanMarkedCase; score: MarkingScore; students?: number }>): MarkingSummary {
  const real = cases.filter((c) => c.case.kind === "handwritten");
  const sum = (list: typeof cases, pick: (s: MarkingScore) => number) => list.reduce((t, c) => t + pick(c.score), 0);
  const total = (list: typeof cases): MarkingScore => {
    const merged: MarkingScore = scoreMarking([], []);
    merged.questions = sum(list, (s) => s.questions);
    const scored = sum(list, (s) => s.transcription.scored);
    merged.transcription = { scored, mean: scored ? sum(list, (s) => s.transcription.mean * s.transcription.scored) / scored : 1 };
    merged.assessed = sum(list, (s) => s.assessed);
    merged.review.count = sum(list, (s) => s.review.count);
    merged.review.rate = merged.questions ? merged.review.count / merged.questions : 0;
    merged.exactAgreement.compared = sum(list, (s) => s.exactAgreement.compared);
    merged.exactAgreement.exact = sum(list, (s) => s.exactAgreement.exact);
    merged.exactAgreement.rate = merged.exactAgreement.compared ? merged.exactAgreement.exact / merged.exactAgreement.compared : null;
    for (const c of list) for (const [k, v] of Object.entries(c.score.errorDistribution)) merged.errorDistribution[k] = (merged.errorDistribution[k] ?? 0) + v;
    const within = Object.entries(merged.errorDistribution).filter(([k]) => Math.abs(Number(k)) <= 1).reduce((t, [, v]) => t + v, 0);
    merged.withinOneMark = merged.exactAgreement.compared ? within / merged.exactAgreement.compared : null;
    for (const key of ["humanCorrect", "humanWrong", "falsePositives", "falseNegatives"] as const) merged.correctness[key] = sum(list, (s) => s.correctness[key]);
    merged.correctness.correctMarkedWrong = merged.correctness.humanCorrect ? merged.correctness.falseNegatives / merged.correctness.humanCorrect : null;
    merged.correctness.wrongMarkedCorrect = merged.correctness.humanWrong ? merged.correctness.falsePositives / merged.correctness.humanWrong : null;
    merged.methodMarks.compared = sum(list, (s) => s.methodMarks.compared);
    merged.methodMarks.agree = sum(list, (s) => s.methodMarks.agree);
    merged.methodMarks.rate = merged.methodMarks.compared ? merged.methodMarks.agree / merged.methodMarks.compared : null;
    merged.followThrough = { cases: sum(list, (s) => s.followThrough.cases), sentToPerson: sum(list, (s) => s.followThrough.sentToPerson), matched: sum(list, (s) => s.followThrough.matched) };
    merged.states = { blankMarkedWrong: sum(list, (s) => s.states.blankMarkedWrong), unreadableMarkedWrong: sum(list, (s) => s.states.unreadableMarkedWrong), stateErrors: sum(list, (s) => s.states.stateErrors) };
    for (const c of list) for (const [k, v] of Object.entries(c.score.conditions)) {
      const slot = (merged.conditions[k] ??= { questions: 0, falseNegatives: 0 });
      slot.questions += v.questions;
      slot.falseNegatives += v.falseNegatives;
    }
    return merged;
  };
  const score = total(cases);
  const realScore = total(real);
  const students = real.reduce((t, c) => t + (c.students ?? 1), 0);
  const T = MARKING_THRESHOLDS;
  const enough = realScore.questions >= T.minQuestions && students >= T.minStudents;
  const gate = (value: number | null, ok: (v: number) => boolean): GateState => (!enough || value === null ? "unmeasured" : ok(value) ? "met" : "failed");
  const gates: Record<string, GateState> = {
    transcription: gate(realScore.transcription.scored ? realScore.transcription.mean : null, (v) => v >= T.transcription),
    exactAgreement: gate(realScore.exactAgreement.rate, (v) => v >= T.exactAgreement),
    withinOneMark: gate(realScore.withinOneMark, (v) => v >= T.withinOneMark),
    correctMarkedWrong: gate(realScore.correctness.correctMarkedWrong, (v) => v <= T.correctMarkedWrong),
    wrongMarkedCorrect: gate(realScore.correctness.wrongMarkedCorrect, (v) => v <= T.wrongMarkedCorrect),
    statesWrong: gate(realScore.questions ? realScore.states.blankMarkedWrong + realScore.states.unreadableMarkedWrong : null, (v) => v <= T.statesWrong),
    reviewRate: gate(realScore.questions ? realScore.review.rate : null, (v) => v <= T.reviewRate),
  };
  const reasons: string[] = [];
  if (real.length === 0) reasons.push("No human-marked handwritten responses have been supplied: nothing here says how reliable automatic marking is on real work.");
  else if (!enough) reasons.push(`Only ${realScore.questions} questions from ${students} students: at least ${T.minQuestions} questions from ${T.minStudents} students are needed before any gate can be met.`);
  for (const [k, v] of Object.entries(gates)) if (v === "failed") reasons.push(`The ${k} threshold is not met.`);
  return { questions: score.questions, students, handwrittenQuestions: realScore.questions, score, gates, validation: Object.values(gates).every((g) => g === "met") ? "validated" : "unvalidated", reasons };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Synthetic responses: typed and scripted, to test the pipeline and this scoring. They are labelled so and never count towards a gate.
// ---------------------------------------------------------------------------------------------------------------------------------

interface Script {
  /** What the stand-in reader "sees" the student wrote. */
  read: { answer: string; working: string[]; legibility: "high" | "medium" | "low"; blank: boolean; uncertain?: string[]; crossed_out?: string[] };
  /** For each method criterion in order, whether the stand-in credits it (with the first line as evidence). */
  methodMet: boolean[];
  /** What the stand-in solver answers. */
  solver: string;
}

export interface SyntheticMarkingCase {
  case: HumanMarkedCase;
  bytes: Uint8Array;
  scripts: Map<string, Script>;
}

/** A stand-in model that reads, solves and credits exactly as each question's script says. */
export function markingStandIn(scripts: ReadonlyMap<string, Script>): ChatProvider {
  const find = (last: string) => {
    const asked = /<question>\s*([\s\S]*?)\s*<\/question>/.exec(last)?.[1] ?? "";
    const key = [...scripts.keys()].filter((own) => asked.includes(own)).sort((a, b) => b.length - a.length)[0];
    return key === undefined ? null : scripts.get(key)!;
  };
  return {
    id: "marking-stand-in",
    async capabilities(): Promise<ProviderCapabilities> {
      return { vision: true, jsonMode: true, toolUse: false, maxContext: 8192 };
    },
    async health(): Promise<ProviderHealth> {
      return { ok: true, detail: "ok" };
    },
    async *stream(messages: readonly ProviderMessage[]): AsyncGenerator<StreamChunk> {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const script = find(last);
      let reply: unknown;
      if (system.startsWith("Read the student's handwritten")) reply = script ? { ...script.read } : { answer: "", working: [], legibility: "low", blank: false };
      else if (system.startsWith("You decide which marking criteria")) {
        const ids = [...last.matchAll(/^([A-Z]\d(?:#\d+)?): /gm)].map((m) => m[1]!);
        const methods = ids.filter((id) => !id.startsWith("A"));
        reply = { awards: ids.map((id) => ({ id, met: id.startsWith("A") ? null : (script?.methodMet[methods.indexOf(id)] ?? false), lines: [0], reason: "scripted" })) };
      } else if (system.startsWith("Give feedback")) reply = { mistake: "", feedback: "Check each step.", method_marks: null };
      else {
        const answer = script?.solver ?? "";
        reply = { transcription: "", final_answer: answer, steps: [{ say: "Work it out", math: answer }], explanation: "", assumptions: [], confidence: "high", check: { kind: "none" } };
      }
      yield { type: "text", text: JSON.stringify(reply) } as StreamChunk;
    },
  } as ChatProvider;
}

/** One synthetic paper: every question prints its marks, and the human marks are what the author says a marker would give. */
export async function syntheticMarkingCase(): Promise<SyntheticMarkingCase> {
  type Row = { label: string; text: string; marks: number; script: Script; human: HumanMarkedQuestion };
  const row = (label: string, text: string, marks: number, script: Script, human: Omit<HumanMarkedQuestion, "label" | "outOf">): Row => ({ label, text, marks, script, human: { label, outOf: marks, ...human } });
  const read = (answer: string, working: string[], over: Partial<Script["read"]> = {}): Script["read"] => ({ answer, working, legibility: "high", blank: false, ...over });
  const rows: Row[] = [
    row("1", "Solve 2x + 7 = 19", 3, { read: read("x = 6", ["2x = 12", "x = 6"]), methodMet: [true, true], solver: "x = 6" }, { state: "answered", answer: "x = 6", working: ["2x = 12", "x = 6"], answerCorrect: true, marks: 3, methodMarks: 2 }),
    row("2", "Solve 3x - 4 = 11", 3, { read: read("x = 7", ["3x = 15", "x = 7"]), methodMet: [true, false], solver: "x = 5" }, { state: "answered", answer: "x = 7", working: ["3x = 15", "x = 7"], answerCorrect: false, marks: 1, methodMarks: 1, conditions: ["partial_credit"] }),
    row("3", "Work out 12 x 7", 2, { read: read("84", []), methodMet: [], solver: "84" }, { state: "answered", answer: "84", answerCorrect: true, marks: 2, methodMarks: 1 }),
    row("4", "Work out 15 x 4", 2, { read: read("", [], { blank: true }), methodMet: [], solver: "60" }, { state: "blank", answer: "", answerCorrect: false, marks: 0 }),
    row("5", "Work out 9 x 9", 2, { read: read("8?", [], { legibility: "low" }), methodMet: [], solver: "81" }, { state: "unreadable", answer: "81", answerCorrect: true, marks: 2 }),
    row("6", "Solve x + 5 = 9", 2, { read: read("4", ["x = 9 - 5", "x = 4"], { crossed_out: ["x = 14"] }), methodMet: [true], solver: "4" }, { state: "answered", answer: "4", working: ["x = 9 - 5", "x = 4"], answerCorrect: true, marks: 2, methodMarks: 1, conditions: ["crossed_out"] }),
    row("7", "Solve 2x = 18", 2, { read: read("x = 8", ["x = 8"], { uncertain: ["the 8 may be a 9"] }), methodMet: [true], solver: "9" }, { state: "answered", answer: "x = 9", working: ["x = 9"], answerCorrect: true, marks: 2, methodMarks: 1, conditions: ["ambiguous", "poor_scan"] }),
    row("8", "Work out 6 x 7", 2, { read: read("42", ["7 x 6", "= 42"]), methodMet: [true], solver: "42" }, { state: "answered", answer: "42", working: ["7 x 6", "= 42"], answerCorrect: true, marks: 2, methodMarks: 1, conditions: ["alternative_method"] }),
  ];
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  let y = 790;
  for (const r of rows) {
    if (y < 140) {
      page = pdf.addPage([595, 842]);
      y = 790;
    }
    page.drawText(`${r.label} ${r.text} (${r.marks})`, { x: 72, y, size: 12, font });
    y -= 110;
  }
  return {
    case: { id: "syn-marking", split: "dev", kind: "synthetic", provenance: "scripted by the author of the test; not a person's marking", questions: rows.map((r) => r.human) },
    bytes: await pdf.save(),
    scripts: new Map(rows.map((r) => [r.text, r.script])),
  };
}

/** Takes one human-marked case through the real marking pipeline and scores it. */
export async function runMarkingCase(c: HumanMarkedCase, bytes: Uint8Array, deps: SolveDeps): Promise<MarkingScore> {
  const document = await extractQuestions(deps, bytes);
  if ("problem" in document) throw new Error(document.problem);
  const result = await markCompleted(deps, document, {});
  return scoreMarking(c.questions, result.marked);
}
