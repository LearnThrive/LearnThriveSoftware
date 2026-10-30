import { calculate } from "./mathExpr";

/**
 * Marking, kept apart from how a quiz looks. Everything here is a pure function of what the student chose or typed and the answer key the interface
 * carries, so a quiz is marked in the browser with no further request to any model, and the same input always gets the same mark.
 *
 * What it can and cannot do is stated plainly: it settles questions that have a fixed answer (a choice, a number, a short word or phrase from a list the
 * question gave). It does not judge an open written answer; that is the student's to send to LearnThrive AI as a question, and the reply is labelled as AI
 * feedback, never as marking.
 */
export function gradeChoice(selected: number | null, answer: number): boolean {
  return selected !== null && Number.isInteger(selected) && selected === answer;
}

/** A number as a student writes it: 0.75, 3/4, 75%, 1,200, −3, 2.5e3, "x = 4", "4 cm". Null when it is not (only) a number. */
export function parseNumber(text: string): number | null {
  let s = text
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  // "x = 4" and "answer: 4": what comes after the last = or colon.
  s = s.replace(/^.*[=:]\s*/, "");
  s = s.replace(/\s*(cm|mm|km|m|kg|g|mg|s|ms|hours?|hrs?|minutes?|mins?|seconds?|units?|degrees?|°|£|\$|€|metres?|meters?|litres?|ml|l)\b\.?$/i, "").replace(/^[£$€]\s*/, "");
  if (!s) return null;
  const percent = /^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*%$/.exec(s);
  if (percent) return Number(percent[1]) / 100;
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/.test(s)) return Number(s);
  const fraction = /^(-?\d+)\s*\/\s*(\d+)$/.exec(s);
  if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
  return null;
}

/** Text compared the way a marker would: case, spacing, a leading "x =", an article and a closing full stop do not matter. */
export function normaliseAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[“”"'‘’`]/g, "")
    .replace(/^(?:[a-z]\s*=\s*)/, "")
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/[.!?;,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ShortGrade {
  correct: boolean;
  /** Which accepted answer it matched. */
  matched: string | null;
  /** `empty`: nothing was typed. `wrong`: it did not match any accepted answer. */
  reason: "right" | "empty" | "wrong";
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-6);

/** Marks a typed answer against the list of answers the question accepts (a number in any of its usual forms, or text). */
export function gradeShortAnswer(input: string, accepted: readonly string[]): ShortGrade {
  const typed = input.trim();
  if (!typed) return { correct: false, matched: null, reason: "empty" };
  const typedNumber = parseNumber(typed);
  const typedText = normaliseAnswer(typed);
  for (const option of accepted) {
    const n = parseNumber(option);
    if (typedNumber !== null && n !== null) {
      if (close(typedNumber, n)) return { correct: true, matched: option, reason: "right" };
      continue;
    }
    if (typedText && typedText === normaliseAnswer(option)) return { correct: true, matched: option, reason: "right" };
  }
  return { correct: false, matched: null, reason: "wrong" };
}

/** The one arithmetic expression in a question like "What is 6 × 7?", or null when the question is not that plain. */
export function arithmeticIn(prompt: string): string | null {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!/^(?:what is|what's|calculate|work out|evaluate|find the value of|simplify)\b/i.test(text)) return null;
  // A question that asks you to choose ("which is bigger") or has two parts is not a single calculation.
  if (/\b(which|or|compare|between|larger|smaller|bigger|greater|less than|more than)\b/i.test(text)) return null;
  const found = text.match(/[0-9(][0-9\s+\-*/x×÷^().−]*[0-9)]/g);
  if (!found || found.length !== 1) return null;
  const expression = found[0]!.replace(/(?<=\d)\s*x\s*(?=[\d(])/gi, "*").trim();
  return /[+\-*/×÷^−]/.test(expression.replace(/^-/, "")) ? expression : null;
}

/**
 * A cross-check of a multiple-choice key against the calculation the question asks for, where the question is a plain calculation. Returns a message
 * for the model to repair, or null when the key agrees or the question is not one this can check (most are not: that is said in the documentation).
 */
export function auditChoiceKey(prompt: string, options: readonly string[], answer: number): string | null {
  const expression = arithmeticIn(prompt);
  if (!expression) return null;
  const value = calculate(expression);
  if (value === null) return null;
  const numbers = options.map((o) => parseNumber(o));
  if (numbers.some((n) => n === null)) return null;
  const matches = numbers.map((n, i) => (n !== null && close(n, value) ? i : -1)).filter((i) => i >= 0);
  if (matches.length === 0) return `none of the options equals ${Number(value.toPrecision(10))}, which is what "${expression}" comes to`;
  if (matches.length > 1) return `more than one option equals ${Number(value.toPrecision(10))}`;
  if (matches[0] !== answer) return `the answer key says option ${answer + 1}, but "${expression}" comes to ${Number(value.toPrecision(10))}, which is option ${matches[0]! + 1}`;
  return null;
}

/** The same cross-check for a short answer: the calculation's value must be among the accepted answers. */
export function auditShortKey(prompt: string, accepted: readonly string[]): string | null {
  const expression = arithmeticIn(prompt);
  if (!expression) return null;
  const value = calculate(expression);
  if (value === null) return null;
  const numbers = accepted.map((a) => parseNumber(a)).filter((n): n is number => n !== null);
  if (numbers.length === 0) return null;
  return numbers.some((n) => close(n, value)) ? null : `"${expression}" comes to ${Number(value.toPrecision(10))}, which is not among the accepted answers`;
}

export interface QuizSummary {
  answered: number;
  correct: number;
  total: number;
  hints: number;
}

export const percentage = (s: Pick<QuizSummary, "correct" | "total">): number => (s.total ? Math.round((s.correct / s.total) * 100) : 0);
