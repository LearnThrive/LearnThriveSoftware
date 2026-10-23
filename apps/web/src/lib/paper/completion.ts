import { evaluate, normaliseMaths, valueOf, variables } from "./maths";
import { checkWorking } from "./mathsEvidence";
import type { PaperQuestion } from "./questions";
import type { ModelSolution } from "./solve";

/**
 * Is a solution FINISHED and consistent with itself? Asked of every model solution before any status is given, whatever the schema
 * said and whether or not the answer could be checked by calculation: valid JSON and an "unchecked" label are not evidence that the
 * working is there or that the conclusion follows from it.
 *
 * It finds, in words a retry can act on:
 *   - instructions where working should be ("Calculate the area" with no calculation),
 *   - too little working for the marks, and a missing explicit conclusion where the question asks one,
 *   - arithmetic that is false (including lines that carry units, which the plain working check skips),
 *   - a comparison that is false, or a Yes/No that contradicts the quantities the solution itself compared,
 *   - a number in "givens" that is not in the question (an invented measurement), and a missing unit on a measured answer.
 *
 * It judges what was written, never the method: any correct route passes. It cannot tell that a diagram was misread when the misreading
 * is consistent, which is why the picture, the labelled-lengths rule in the prompt and a second, reasoning attempt are also used.
 */
type Code = "figure_not_shown" | "no_answer" | "instruction_only" | "too_little_working" | "no_conclusion" | "no_comparison" | "arithmetic_false" | "comparison_false" | "contradiction" | "invented_given" | "unit_missing";

/** What the checks find, as they find it: `message` speaks to the model on a retry (it may name the fields of the schema); it is never shown to a student. */
export interface RawIssue {
  code: Code;
  message: string;
  student?: string;
}

/**
 * A problem with a solution. `kind` keeps two things apart: "work" is mathematical completeness (missing working, no conclusion, false arithmetic, a
 * contradiction), which makes a solution partly worked; "detail" is only the machine-readable form of something the working may already show (the
 * structured comparison), which is repaired or derived and never makes a correct solution partial. `student` is the plain explanation for a student.
 */
export interface Issue extends RawIssue {
  student: string;
  kind: "work" | "detail";
}

const STUDENT: Record<Code, string> = {
  no_answer: "No final answer was given.",
  instruction_only: "Several steps only say what to do, without showing the calculation.",
  too_little_working: "The working is shorter than the marks suggest, so some calculations may be missing.",
  no_conclusion: "The answer is not stated clearly in words, with its reason.",
  no_comparison: "",
  arithmetic_false: "One line of the working does not add up.",
  comparison_false: "A comparison in the working is not true.",
  figure_not_shown: "A figure used in the comparison is not worked out in the steps.",
  contradiction: "The conclusion does not agree with the figures in the working.",
  invented_given: "A measurement in the working does not appear in the question.",
  unit_missing: "The answer is missing its unit.",
};

export const decorate = (issue: RawIssue): Issue => ({ ...issue, student: issue.student ?? STUDENT[issue.code], kind: issue.code === "no_comparison" || issue.code === "figure_not_shown" ? "detail" : "work" });

/** A line of working that has numbers in it (a calculation), as opposed to words alone. */
const hasNumbers = (text: string | undefined): boolean => /\d/.test(text ?? "");

export const isSufficiencyQuestion = (text: string): boolean => /\b(enough|sufficient|big enough|large enough|long enough|have enough|is there enough)\b/i.test(text);
const asksForConclusion = (text: string): boolean => /\b(?:explain|show that|justify|give a reason|decide|state whether|whether|enough|sufficient)\b/i.test(text);
export const asksWhetherItChanges = (text: string): boolean => /\b(?:does|do|will|would|did)\b[^.?]*\bchange\b[^.?]*\b(?:answer|decision|conclusion)\b/i.test(text);
const yesNoQuestion = (own: string): boolean => /(?:^|[.\n]\s*)(?:does|do|is|are|can|will|has|have|did|could|would|should)\b[^.?!]*\?/i.test(own) || isSufficiencyQuestion(own);

/** A quantity's number: "75 m^2", "7.5 litres", "£68", "7.5 \\times 10" -> a value; null if it is not a plain quantity. */
export function quantity(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/\\(?:text|mathrm|textbf)\s*\{[^{}]*\}(?:\^\s*\{?\d\}?)?/g, " ").replace(/\\[,;! ]|~/g, " ");
  s = s.replace(/^\s*(?:£|\\pounds|\$)\s*/, "").trim();
  // A unit after the number: "75 m^2", "7.5 litres", "68 square metres".
  s = s.replace(/(?<=\d)\s*(?:[a-zA-Zµ°%]+(?:\s+[a-zA-Z]+)?)(?:\^\s*\{?\d\}?)?\s*$/, "").trim();
  return valueOf(s);
}

/** The text of a step's maths with its units and a leading label ("Area =") taken off, so the arithmetic in it can be tested. */
function bare(math: string): string {
  let s = math.replace(/\\(?:text|mathrm)\s*\{[^{}]*\}(?:\^\s*\{?\d\}?)?/g, " ").replace(/\\[,;! ]|~/g, " ");
  s = s.replace(/^\s*(?:\\?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s*=\s*(?=[\d(\\-])/, "");
  // A trailing unit on the last number: "= 68 m^2".
  s = s.replace(/(?<=\d)\s*[a-zA-Zµ°]+(?:\^\s*\{?\d\}?)?\s*$/, "");
  return s.trim();
}

/** Does b state a's value, exactly or rounded to the decimal places it is written with ("68 \\div 11 = 6.18")? A whole number is not a rounding. */
function states(a: number, b: number, written: string): boolean {
  if (Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) return true;
  const places = /\.(\d+)\s*$/.exec(written)?.[1]?.length ?? 0;
  return places > 0 && Math.abs(a - b) <= 0.5 * 10 ** -places + 1e-9;
}

/**
 * Lines of pure arithmetic judged once units and labels are set aside: `false` are the ones that are not true ("10 \\times 8 - 12 = 68" is true,
 * "80 + 30 = 100" is not; a rounded result such as 6.18 for 68 \\div 11 is true), and `judged` are all the lines that were pure numbers either way.
 */
export function arithmeticReport(steps: ReadonlyArray<{ math?: string }>): { false: number[]; judged: number[] } {
  const report = { false: [] as number[], judged: [] as number[] };
  steps.forEach((step, index) => {
    if (!step.math) return;
    const line = bare(step.math);
    if (!line || /[<>]|\\[lg]eq?|\\neq|\\lt|\\gt|\\approx|\\Rightarrow|\\implies|\\pm|\\text|\bor\b|\band\b|[,;]/i.test(line)) return;
    const parts = normaliseMaths(line).split("=").map((p) => p.trim());
    if (parts.length < 2 || parts.some((p) => !p)) return;
    if (parts.some((p) => variables(p).length > 0)) return;
    const values = parts.map((p) => evaluate(p));
    if (values.some((v) => v === null)) return;
    report.judged.push(index);
    for (let i = 0; i + 1 < values.length; i += 1) {
      if (!states(values[i]!, values[i + 1]!, parts[i + 1]!)) {
        report.false.push(index);
        break;
      }
    }
  });
  return report;
}

export const falseArithmetic = (steps: ReadonlyArray<{ math?: string }>): number[] => arithmeticReport(steps).false;

const RELATION = /\\leq?|\\geq?|\\lt|\\gt|<=|>=|≤|≥|<|>/;

/** Stated comparisons ("75 m^2 < 68 m^2") that are false: the line is returned with its text. */
export function falseComparisons(steps: ReadonlyArray<{ math?: string }>): number[] {
  const out: number[] = [];
  steps.forEach((step, index) => {
    const line = step.math;
    if (!line) return;
    const found = RELATION.exec(line);
    if (!found || line.split(RELATION).length !== 2) return;
    const [l, r] = line.split(RELATION) as [string, string];
    const a = quantity(l);
    const b = quantity(r);
    if (a === null || b === null) return;
    const op = found[0];
    const holds = /geq?|>=|≥/.test(op) ? a >= b : /leq?|<=|≤/.test(op) ? a <= b : /gt|>/.test(op) ? a > b : a < b;
    if (!holds) out.push(index);
  });
  return out;
}

const polarity = (text: string | undefined): "yes" | "no" | null => {
  const m = /^\s*(?:\\text\{)?\s*(yes|no)\b/i.exec(text ?? "");
  return m ? (m[1]!.toLowerCase() as "yes" | "no") : null;
};

const numbersIn = (text: string): string[] => (text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));

/**
 * Consistency with the earlier upload this task was linked to: "does this change your answer?" is answered by comparing the new decision (from the
 * figures the solution itself states) with the earlier decision. It is a fact about the solution's own figures, never about the diagram, and it holds
 * whichever way the two parts compared things (an area against an area, or litres against litres).
 */
export function contextIssues(q: PaperQuestion, s: ModelSolution, own: string): RawIssue[] {
  const issues: RawIssue[] = [];
  const earlier = q.context?.earlier.filter((e) => e.comparison) ?? [];
  const last = earlier.at(-1);
  if (!last?.comparison) return issues;
  const was = quantity(last.comparison.need);
  const need = quantity(s.comparison?.need);
  if (asksWhetherItChanges(own)) {
    const have = quantity(s.comparison?.have);
    const before = polarity(last.answer) ?? (quantity(last.comparison.have) !== null && was !== null ? ((quantity(last.comparison.have) as number) >= was ? "yes" : "no") : null);
    if (!s.comparison || have === null || need === null) {
      issues.push({ code: "no_comparison", message: "State in \"comparison\" what is now available (have) and what is needed (need), with the new figures, so the new decision can be compared with the earlier one." });
    } else if (before) {
      const now = have >= need ? "yes" : "no";
      const changes = now !== before;
      const said = polarity(s.final_answer.replace(/^\s*\$+|\$+\s*$/g, ""));
      if (said && (said === "yes") !== changes) {
        issues.push({ code: "contradiction", message: `With ${s.comparison.have} available against ${s.comparison.need} needed the decision is ${now === "yes" ? "Yes, enough" : "No, not enough"}, and it was ${before === "yes" ? "Yes, enough" : "No, not enough"} before, so it ${changes ? "DOES" : "does NOT"} change: the answer to "does this change your answer?" is ${changes ? "Yes" : "No"}.` });
      }
    }
  }
  return issues;
}

const RELATION_ANY = /\\leq?|\\geq?|\\lt|\\gt|<=|>=|≤|≥|<|>/;

/** A quantity as it is written in the solution's own words: "75\\text{ m}^2" -> "75 m^2". */
export function formatQuantity(raw: string): string {
  const unitText = /\\(?:text|mathrm)\s*\{\s*([^{}]*?)\s*\}(?:\^\s*\{?(\d)\}?)?/.exec(raw);
  let unit = "";
  let number = raw;
  if (unitText) {
    unit = unitText[1]! + (unitText[2] ? `^${unitText[2]}` : "");
    number = raw.replace(unitText[0], " ");
  } else {
    const trailing = /(?<=\d)\s*([a-zA-Zµ°%]+(?:\^\s*\{?\d\}?)?)\s*$/.exec(raw);
    if (trailing) {
      unit = trailing[1]!.replace(/[\s{}]/g, "");
      number = raw.slice(0, trailing.index);
    }
  }
  return [number.replace(/\\[,;! ]|~/g, " ").trim(), unit].filter(Boolean).join(" ");
}

/** The unit part of a quantity, normalised so "m^2", "m²" and "m2" are the same and "litre" and "litres" are the same. */
export const unitKey = (raw: string): string => formatQuantity(raw).replace(/^[^a-zA-Zµ°%]*/, "").toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/[^a-z0-9]/g, "").replace(/(?<=[a-z])s$/, "");

/**
 * The structured comparison of a solution that already compares its figures in words or in a step: the last step that sets two quantities against
 * each other ("75 m^2 > 68 m^2"), or, when no step does, the conclusion ("75 m^2 is more than 68 m^2"). Which one is available and which is needed
 * follows from the decision the solution reached, and only from figures its working shows in the same unit. Anything less clear is not guessed (null).
 */
export function deriveComparison(q: PaperQuestion, s: ModelSolution): { have: string; need: string } | null {
  void q;
  const final = s.final_answer.replace(/^\s*\$+|\$+\s*$/g, "").trim();
  const decision = polarity(s.conclusion) ?? polarity(final);
  if (!decision) return null;
  let left = "";
  let right = "";
  let larger: "left" | "right" | null = null;
  let stepFound = false;
  for (const step of [...s.steps].reverse()) {
    const math = step.math ?? "";
    const m = RELATION_ANY.exec(math);
    if (!m || math.split(RELATION_ANY).length !== 2) continue;
    stepFound = true;
    [left, right] = math.split(RELATION_ANY).map((x) => x.trim()) as [string, string];
    larger = /gt|>|geq?|≥/.test(m[0]) ? "left" : "right";
    break;
  }
  if (!stepFound) {
    const m = /(\d[\d.,]*\s*[a-zA-Zµ°%²³]*(?:\^\{?\d\}?)?)\s+is\s+(more|greater|larger|bigger|higher|less|smaller|fewer|lower)\s+than\s+(?:the\s+)?(\d[\d.,]*\s*[a-zA-Zµ°%²³]*(?:\^\{?\d\}?)?)/i.exec(s.conclusion);
    if (!m) return null;
    left = m[1]!.trim();
    right = m[3]!.trim();
    larger = /^(more|greater|larger|bigger|higher)$/i.test(m[2]!) ? "left" : "right";
    const shown = s.steps.map((step) => `${step.say ?? ""} ${step.math ?? ""}`).join(" ");
    const present = numbersIn(shown);
    if (![left, right].every((x) => present.includes(String(quantity(x))))) return null;
  }
  const a = quantity(left);
  const b = quantity(right);
  if (a === null || b === null) return null;
  const ua = unitKey(left);
  const ub = unitKey(right);
  if (ua && ub && ua !== ub) return null;
  const bigger = larger === "left" ? left : right;
  const smaller = larger === "left" ? right : left;
  return decision === "yes" ? { have: formatQuantity(bigger), need: formatQuantity(smaller) } : { have: formatQuantity(smaller), need: formatQuantity(bigger) };
}

/** What is wrong with a solution, if anything. Empty means finished and consistent (not that it is right). */
export function completionIssues(q: PaperQuestion, s: ModelSolution, options: { reference?: boolean; pictured?: boolean } = {}): Issue[] {
  const issues = completionIssuesAll(q, s, options.pictured ?? false).map(decorate);
  // A reference solution for marking is never shown as working: only whether it is true and agrees with itself matters.
  return options.reference ? issues.filter((i) => i.code === "arithmetic_false" || i.code === "comparison_false" || i.code === "contradiction" || i.code === "invented_given") : issues;
}

function completionIssuesAll(q: PaperQuestion, s: ModelSolution, pictured: boolean): RawIssue[] {
  const issues: RawIssue[] = [];
  const own = (q.ownText ?? q.text).trim();
  const final = s.final_answer.replace(/^\s*\$+|\$+\s*$/g, "").trim();
  const steps = s.steps.map((step) => ({ say: step.say?.trim(), math: step.math?.trim() }));
  if (!final) issues.push({ code: "no_answer", message: "There is no final answer." });

  // Working, not instructions: lines that carry numbers.
  const working = steps.filter((step) => hasNumbers(step.math) || hasNumbers(step.say));
  const instructions = steps.filter((step) => !step.math && step.say && !hasNumbers(step.say));
  if (steps.length > 0 && instructions.length > steps.length / 2) issues.push({ code: "instruction_only", message: "Most steps only say what to do (for example \"Calculate the area\"). Write the calculation itself, with its numbers and its result, on each line." });
  const needed = q.marks ? Math.max(1, Math.min(q.marks, 4) - 1) : 1;
  if (working.length < needed) issues.push({ code: "too_little_working", message: `The working is too short for ${q.marks ?? "this"} marks: show each calculation as its own line with numbers.` });

  // An explicit conclusion, with its reason, where the question asks for a decision or a reason: "Yes" alone is not an answer to "does she have enough?".
  if (asksForConclusion(own) || asksForConclusion(q.text)) {
    if (!s.conclusion || s.conclusion.trim().length < 12) issues.push({ code: "no_conclusion", message: "The question asks for a decision or a reason, but there is no explicit conclusion in words. Put in \"conclusion\" a sentence that answers it and gives the reason with the numbers compared." });
  }
  if (yesNoQuestion(own) && !polarity(final) && !polarity(s.conclusion)) {
    issues.push({ code: "no_conclusion", message: "This is a yes/no question: the conclusion must begin with Yes or No, and give the reason." });
  } else if (yesNoQuestion(own) && final && !polarity(final)) {
    // The answer line is what is written on the paper: for a yes/no question it must be Yes or No, not a figure from the working.
    issues.push({ code: "no_conclusion", message: `This is a yes/no question, so "final_answer" must be Yes or No (the figures belong in the steps), but it is "${final}".` });
  }

  // "Does this change your answer to (a)?": the answer is whether the DECISION is different from before, so No means it stays the same. A Yes
  // that says in words that nothing changes (or the reverse) contradicts itself, and the conclusion must say which it is.
  if (asksWhetherItChanges(own)) {
    const words = `${s.conclusion} ${s.explanation}`;
    const staysSame = /\b(?:not change|no change|does not change|doesn't change|unchanged|still|same)\b/i.test(words);
    const differs = /\b(?:changes|changed|different|no longer|now not|not enough now)\b/i.test(words) && !staysSame;
    if (!/\b(?:change|changes|changed|same|still|different|unchanged)\b/i.test(words)) {
      issues.push({ code: "no_conclusion", message: "The question asks whether your earlier answer changes. Say in the conclusion whether the decision is the same as before (No, it does not change) or different (Yes, it changes), and why." });
    } else if (polarity(final) === "yes" && staysSame) {
      issues.push({ code: "contradiction", message: "The final answer is Yes (it changes) but the conclusion says the decision stays the same. For \"does this change your answer?\" the answer is No when the decision is the same as before." });
    } else if (polarity(final) === "no" && differs) {
      issues.push({ code: "contradiction", message: "The final answer is No (it does not change) but the conclusion says the decision is different. Make them agree." });
    }
  }

  issues.push(...contextIssues(q, s, own));

  // Arithmetic and stated comparisons, including lines with units.
  // The plain working check cannot read a unit inside a line ("= 12 m^2"), so it is given the lines with units and labels set aside.
  // Pure-number lines are judged by arithmeticReport (which allows a stated rounding); the plain check is kept for algebra, where it follows a chain of equations.
  const numeric = arithmeticReport(steps);
  const flawed = [...new Set([...numeric.false, ...checkWorking(steps.map((step) => ({ math: step.math ? bare(step.math) : undefined }))).flawed.filter((i) => !numeric.judged.includes(i))])];
  if (flawed.length) issues.push({ code: "arithmetic_false", message: `Line ${flawed[0]! + 1} of the working is not true arithmetic (${steps[flawed[0]!]!.math}). Recalculate it.` });
  const wrong = falseComparisons(steps);
  if (wrong.length) issues.push({ code: "comparison_false", message: `Line ${wrong[0]! + 1} states a comparison that is false (${steps[wrong[0]!]!.math}).` });

  // A "has enough" question: the solution must compare what is available with what is needed, and agree with itself.
  const sufficiency = isSufficiencyQuestion(own) || isSufficiencyQuestion(q.text);
  if (sufficiency) {
    const have = quantity(s.comparison?.have);
    const need = quantity(s.comparison?.need);
    if (!s.comparison || have === null || need === null) {
      issues.push({ code: "no_comparison", message: "This asks whether there is enough. State, in \"comparison\", the quantity available (have) and the quantity needed (need), as numbers with units, and compare them." });
    } else {
      const enough = have >= need;
      const said = polarity(s.conclusion) ?? polarity(final);
      if (said && (said === "yes") !== enough) {
        issues.push({ code: "contradiction", message: `The conclusion says ${said === "yes" ? "Yes" : "No"}, but the solution's own figures (${s.comparison.have} available against ${s.comparison.need} needed) mean the answer is ${enough ? "Yes" : "No"}. Make the conclusion agree with the comparison, or correct the figures.` });
      }
      if (polarity(final) && polarity(s.conclusion) && polarity(final) !== polarity(s.conclusion)) issues.push({ code: "contradiction", message: "The final answer and the conclusion disagree (one says Yes, the other No)." });
      const shown = steps.map((step) => `${step.say ?? ""} ${step.math ?? ""}`).join(" ");
      const present = numbersIn(shown);
      for (const n of [have, need]) if (!present.includes(String(n))) issues.push({ code: "figure_not_shown", message: `The figure ${n} is compared but never worked out in the steps. Show where it comes from.` });
    }
  }

  // Measurements must come from the question; a number that is nowhere in it was invented.
  const source = `${q.text} ${s.transcription} ${q.stem ?? ""}`;
  const known = new Set(numbersIn(source));
  const invented = s.givens.flatMap((g) => numbersIn(g)).filter((n) => !known.has(n));
  // With a picture the model reads the lengths from it, so they cannot be compared with the words alone.
  if (!pictured && known.size > 0 && invented.length) issues.push({ code: "invented_given", message: `The figure ${invented[0]} is listed as read from the question or diagram, but it is not in it. Use only the lengths and values written there; never estimate one from how the drawing looks.` });

  // A measured answer with its unit.
  const asksQuantity = /\b(?:area|volume|perimeter|length|mass|cost|price|speed|time|how (?:much|many|long|far|tall))\b/i.test(own) && (/\b(?:cm|mm|m|km|litres?|l|kg|g|minutes?|hours?|seconds?|pounds)\b/i.test(q.text) || q.text.includes("£"));
  const pureNumber = final !== "" && valueOf(final) !== null && !/[A-Za-z£]/.test(final.replace(/\\(?:times|div|frac|dfrac|sqrt|pi|cdot)\b/g, ""));
  if (asksQuantity && pureNumber && !yesNoQuestion(own)) issues.push({ code: "unit_missing", message: "The final answer is a measurement with no unit. Add the unit." });
  return issues;
}
