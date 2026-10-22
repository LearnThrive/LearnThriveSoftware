import { equivalent, parseMaths, runMaths, sameValue, sides, variablesOfNode, type MathNode, normaliseMaths, valueOf } from "./maths";

/**
 * What a calculation can and cannot say about an answer, kept apart (docs/ASSISTANT.md, "Verification"):
 *
 *   numeric agreement   the answer satisfies the question's equation, or equals its value (maths.ts: spot values, never proof)
 *   completeness        for a polynomial equation in one unknown, the claimed solutions are ALL its real solutions (this file: the roots are
 *                       computed, so x^2 = 4 answered "x = 2" is incomplete, not verified)
 *   working             each step of the shown working follows from the one before (consecutive equations keep their solutions; a chain of
 *                       "=" is an identity; an arithmetic line is true)
 *   form                an exact answer was asked for and a rounded decimal was given, or a number of decimal places or significant figures
 *                       was asked for and the answer is not that rounding
 *
 * Nothing here uses eval or runs model-written code: it reads the same safe expression tree as maths.ts. Limits are fixed (degree, sample
 * counts), and what it cannot decide it says is unknown. Unknown is never "verified".
 */

export type Completeness = "complete" | "incomplete" | "wrong" | "undefined_at_answer" | "unknown";

const DEGREE_MAX = 6;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));

/** The coefficients (constant first) of f if it is a polynomial in `variable` of degree at most DEGREE_MAX, checked at extra points; else null. */
function polynomial(f: (x: number) => number): number[] | null {
  const n = DEGREE_MAX + 1;
  const xs = Array.from({ length: n }, (_, i) => i - 3);
  const ys = xs.map(f);
  if (ys.some((y) => !Number.isFinite(y))) return null;
  // Solve the Vandermonde system by Gaussian elimination with partial pivoting.
  const m = xs.map((x, i) => [...Array.from({ length: n }, (_, k) => x ** k), ys[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const d = m[col]![col]!;
    if (Math.abs(d) < 1e-12) return null;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const k = m[r]![col]! / d;
      for (let c = col; c <= n; c += 1) m[r]![c] = m[r]![c]! - k * m[col]![c]!;
    }
  }
  const coeff = m.map((row, i) => row[n]! / row[i]!);
  const at = (x: number) => coeff.reduce((sum, c, k) => sum + c * x ** k, 0);
  // A polynomial reproduces f at points that were not used to fit it; most other functions do not.
  for (const x of [0.37, -1.91, 2.53, 4.17, -4.63, 6.11, -0.77]) {
    const y = f(x);
    if (!Number.isFinite(y) || !close(at(x), y)) return null;
  }
  return coeff.map((c) => (Math.abs(c) < 1e-9 ? 0 : c));
}

/** Real roots of a polynomial given constant-first coefficients (Durand-Kerner, then Newton on the real line), sorted, duplicates merged. */
function realRoots(coeff: number[]): number[] | null {
  const c = [...coeff];
  while (c.length > 1 && c.at(-1) === 0) c.pop();
  const degree = c.length - 1;
  if (degree < 1) return null; // a constant: no roots, or every number: not an equation to solve
  if (degree === 1) return [-c[0]! / c[1]!];
  const lead = c[degree]!;
  const monic = c.map((v) => v / lead);
  // Durand-Kerner on the complex plane.
  let z = Array.from({ length: degree }, (_, k) => ({ re: 0.4 * Math.cos((2 * Math.PI * k) / degree + 0.3) * (1 + k), im: 0.4 * Math.sin((2 * Math.PI * k) / degree + 0.3) * (1 + k) }));
  const mul = (a: { re: number; im: number }, b: { re: number; im: number }) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
  const sub = (a: { re: number; im: number }, b: { re: number; im: number }) => ({ re: a.re - b.re, im: a.im - b.im });
  const div = (a: { re: number; im: number }, b: { re: number; im: number }) => {
    const d = b.re * b.re + b.im * b.im || 1e-300;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  };
  const evalAt = (p: { re: number; im: number }) => {
    let acc = { re: 0, im: 0 };
    for (let k = degree; k >= 0; k -= 1) acc = { ...mul(acc, p), re: mul(acc, p).re + monic[k]!, im: mul(acc, p).im };
    return acc;
  };
  for (let iteration = 0; iteration < 400; iteration += 1) {
    let delta = 0;
    z = z.map((zi, i) => {
      let denominator = { re: 1, im: 0 };
      for (let j = 0; j < degree; j += 1) if (j !== i) denominator = mul(denominator, sub(zi, z[j]!));
      const step = div(evalAt(zi), denominator);
      delta = Math.max(delta, Math.hypot(step.re, step.im));
      return sub(zi, step);
    });
    if (delta < 1e-13) break;
  }
  const real = z.filter((r) => Math.abs(r.im) < 1e-6 * Math.max(1, Math.abs(r.re))).map((r) => r.re);
  // Polish each on the real polynomial, then merge repeats.
  const p = (x: number) => c.reduce((sum, v, k) => sum + v * x ** k, 0);
  const dp = (x: number) => c.reduce((sum, v, k) => (k === 0 ? sum : sum + k * v * x ** (k - 1)), 0);
  const polished = real.map((r) => {
    let x = r;
    for (let i = 0; i < 20; i += 1) {
      const d = dp(x);
      if (Math.abs(d) < 1e-14) break;
      const next = x - p(x) / d;
      if (!Number.isFinite(next) || Math.abs(next - x) < 1e-15) break;
      x = next;
    }
    return x;
  });
  polished.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const r of polished) if (!merged.length || Math.abs(r - merged.at(-1)!) > 1e-6 * Math.max(1, Math.abs(r))) merged.push(r);
  return merged;
}

/** Is this node built from `variable` alone (and numbers)? */
function onlyVariable(node: MathNode, variable: string): boolean {
  const vars = variablesOfNode(node);
  return vars.size === 0 || (vars.size === 1 && vars.has(variable));
}

/** The one unknown of an equation, its two sides as trees. Null if it is not an equation in exactly one unknown. */
function oneUnknown(equation: string): { variable: string; left: MathNode; right: MathNode } | null {
  const pair = sides(equation);
  if (!pair) return null;
  const left = parseMaths(pair[0]);
  const right = parseMaths(pair[1]);
  if (!left || !right) return null;
  const vars = new Set([...variablesOfNode(left), ...variablesOfNode(right)]);
  if (vars.size !== 1) return null;
  const variable = [...vars][0]!;
  return onlyVariable(left, variable) && onlyVariable(right, variable) ? { variable, left, right } : null;
}

/** The real solutions of an equation in one unknown, when it is a polynomial equation; null when the equation is not (or cannot be decided). */
export function solutionsOf(equation: string): { variable: string; roots: number[] } | null {
  const e = oneUnknown(equation);
  if (!e) return null;
  const f = (x: number) => {
    try {
      return runMaths(e.left, { [e.variable]: x }) - runMaths(e.right, { [e.variable]: x });
    } catch {
      return Number.NaN;
    }
  };
  const coeff = polynomial(f);
  if (!coeff) return null;
  const roots = realRoots(coeff);
  return roots ? { variable: e.variable, roots } : null;
}

/**
 * Is the claimed set of values EXACTLY the solution set of the equation? complete: yes. incomplete: every claimed value is a solution but another
 * exists (x^2 = 4 answered x = 2). wrong: a claimed value is not a solution. undefined_at_answer: a claimed value makes a side undefined (a denominator
 * of zero, the root of a negative). unknown: the equation is not one this can decide (not a polynomial, more than one unknown).
 */
export function completeness(equation: string, claimed: number[]): Completeness {
  const e = oneUnknown(equation);
  if (!e) return "unknown";
  for (const value of claimed) {
    try {
      const l = runMaths(e.left, { [e.variable]: value });
      const r = runMaths(e.right, { [e.variable]: value });
      if (!Number.isFinite(l) || !Number.isFinite(r)) return "undefined_at_answer";
      if (!close(l, r)) return "wrong";
    } catch {
      return "undefined_at_answer";
    }
  }
  const found = solutionsOf(equation);
  if (!found) return "unknown";
  const distinct = [...new Set(claimed.map((v) => v.toPrecision(10)))].map(Number);
  const missing = found.roots.filter((root) => !distinct.some((v) => sameValue(v, root)));
  return missing.length === 0 ? "complete" : "incomplete";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The shown working
// ---------------------------------------------------------------------------------------------------------------------------------

export interface WorkingCheck {
  /** Lines that could be read and tested. */
  checked: number;
  /** Indexes (into the steps given) of lines that do not follow. */
  flawed: number[];
}

/**
 * Tests each step's maths line: a chain "A = B = C" must be an identity (each link equal for every value), an arithmetic line "2 + 3 = 5" must be true,
 * and a run of equations in one unknown must keep their solutions from one to the next (2x + 7 - 7 = 19 - 7, then 2x = 12, then x = 6). A line
 * that cannot be read is skipped, not failed. This tests the working shown, not the method: any correct route passes.
 */
export function checkWorking(steps: ReadonlyArray<{ math?: string }>): WorkingCheck {
  const result: WorkingCheck = { checked: 0, flawed: [] };
  let previous: { index: number; equation: string } | null = null;
  steps.forEach((step, index) => {
    const line = step.math?.trim();
    if (!line) return;
    const normalised = normaliseMaths(line);
    // Alternatives, implications and inequalities are not a chain of equal expressions ("x = 2 or x = 3", "x^2 = 4 \Rightarrow x = \pm 2"): not judged here.
    if (/\bor\b|\band\b|[,;]|\\text|\\pm|\\Rightarrow|\\implies|\\leq?|\\geq?|\\neq|[<>]/i.test(normalised)) {
      previous = null;
      return;
    }
    const parts = normalised.split("=").map((p) => p.trim());
    if (parts.length < 2 || parts.some((p) => !p)) {
      previous = null;
      return;
    }
    if (parts.length > 2) {
      // A chain of expressions: every link must be equal for every value (an identity), or, with no unknown, equal in value.
      let judged = false;
      for (let i = 0; i + 1 < parts.length; i += 1) {
        const same = equivalent(parts[i]!, parts[i + 1]!);
        if (same === null) continue;
        judged = true;
        if (!same) {
          result.flawed.push(index);
          break;
        }
      }
      if (judged) result.checked += 1;
      previous = null;
      return;
    }
    const [left, right] = parts as [string, string];
    const a = parseMaths(left);
    const b = parseMaths(right);
    if (!a || !b) {
      previous = null;
      return;
    }
    const vars = new Set([...variablesOfNode(a), ...variablesOfNode(b)]);
    if (vars.size === 0) {
      // Arithmetic: it must be true.
      const x = valueOf(left);
      const y = valueOf(right);
      if (x !== null && y !== null) {
        result.checked += 1;
        if (!sameValue(x, y)) result.flawed.push(index);
      }
      previous = null;
      return;
    }
    const equation = `${left} = ${right}`;
    const now = solutionsOf(equation);
    if (previous && now) {
      const before = solutionsOf(previous.equation);
      if (before && before.variable === now.variable) {
        result.checked += 1;
        const same = before.roots.length === now.roots.length && before.roots.every((r, i) => sameValue(r, now.roots[i]!));
        if (!same) result.flawed.push(index);
      }
    }
    previous = now ? { index, equation } : null;
  });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The form of the answer
// ---------------------------------------------------------------------------------------------------------------------------------

/** Does the question ask for a rounded answer ("to 2 decimal places", "to 3 significant figures")? */
export function roundingAsked(questionText: string): boolean {
  return /(?:to|correct to|nearest)\s+(?:\d+|one|two|three|four)\s+(?:decimal places?|d\.?p\.?|significant figures?|s\.?f\.?)/i.test(questionText);
}

export type FormCheck = { ok: true } | { ok: false; note: string };

function roundTo(value: number, places: number): number {
  return Number(value.toFixed(places));
}

function significant(value: number, figures: number): number {
  return value === 0 ? 0 : Number(value.toPrecision(figures));
}

/**
 * Does the answer's FORM match what the question asked? "to 2 decimal places" / "to 3 significant figures" (the answer must BE that rounding of the true value,
 * written with that many places); otherwise an answer given as a long decimal for a value that is not a terminating decimal is rounded, not exact.
 */
export function checkForm(questionText: string, finalAnswer: string, exact: number | null): FormCheck {
  if (exact === null) return { ok: true };
  const given = valueOf(finalAnswer);
  if (given === null) return { ok: true };
  const text = questionText.toLowerCase();
  const dp = /(?:to|correct to|nearest)\s+(\d+|one|two|three|four)\s+(?:decimal places?|d\.?p\.?)/.exec(text);
  const sf = /(?:to|correct to)\s+(\d+|one|two|three|four)\s+(?:significant figures?|s\.?f\.?)/.exec(text);
  const word: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  const count = (s: string) => word[s] ?? Number(s);
  const plain = finalAnswer.replace(/[^0-9.\-]/g, "");
  const written = plain.includes(".") ? plain.split(".")[1]!.length : 0;
  if (dp) {
    const places = count(dp[1]!);
    if (!sameValue(given, roundTo(exact, places))) return { ok: false, note: `The question asks for ${places} decimal place${places === 1 ? "" : "s"}; the answer is not the true value rounded to that.` };
    if (written !== places) return { ok: false, note: `The question asks for ${places} decimal place${places === 1 ? "" : "s"}; the answer is written with ${written}.` };
    return { ok: true };
  }
  if (sf) {
    const figures = count(sf[1]!);
    if (!sameValue(given, significant(exact, figures))) return { ok: false, note: `The question asks for ${figures} significant figure${figures === 1 ? "" : "s"}; the answer is not the true value rounded to that.` };
    return { ok: true };
  }
  // No rounding asked: an exact value (a fraction, a surd, a terminating decimal) is the answer. A long decimal for a value that is not a
  // terminating decimal is a rounding the question did not ask for.
  const terminating = Math.abs(exact * 1e6 - Math.round(exact * 1e6)) < 1e-6;
  if (!terminating && plain.includes(".") && !/[\\/^]|sqrt|frac|pi/i.test(finalAnswer)) return { ok: false, note: "The answer is a rounded decimal, but the question did not ask for rounding: give the exact value (a fraction or surd)." };
  return { ok: true };
}
