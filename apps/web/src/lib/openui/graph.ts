import { evaluateMath, parseMath, type MathNode } from "./mathExpr";

/**
 * Drawing a function from its formula. The curve is SAMPLED from the formula the code has parsed (mathExpr.ts), so every point on screen is a value the
 * formula really has at that x: nothing is a coordinate a model wrote. A formula that is undefined somewhere (1/x at 0, the root of a negative) leaves a
 * gap, and a jump to infinity (tan, 1/x) is a break in the line rather than a vertical stroke drawn between two far-apart points.
 */
export type Point = readonly [number, number];

export interface Curve {
  /** Unbroken runs of points. A gap in the function is a gap between two runs. */
  segments: Point[][];
  /** The smallest and largest y seen, or null when the formula was defined nowhere in the window. */
  range: [number, number] | null;
}

export const MAX_SAMPLES = 800;

export function sampleCurve(tree: MathNode, scope: Record<string, number>, xMin: number, xMax: number, samples = 400, clip?: [number, number]): Curve {
  const n = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(samples)));
  const segments: Point[][] = [];
  let run: Point[] = [];
  let prev: number | null = null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const height = clip ? clip[1] - clip[0] : null;
  const flush = () => {
    if (run.length) segments.push(run);
    run = [];
    prev = null;
  };
  for (let i = 0; i <= n; i += 1) {
    const x = xMin + ((xMax - xMin) * i) / n;
    const y = evaluateMath(tree, { ...scope, x });
    if (!Number.isFinite(y) || Math.abs(y) > 1e9) {
      flush();
      continue;
    }
    // An asymptote: the value leaps by far more than the window is tall (tan near pi/2, 1/x near 0). Break the line there.
    if (prev !== null && height !== null && Math.abs(y - prev) > height * 4 && Math.sign(y) !== Math.sign(prev)) flush();
    run.push([x, y]);
    prev = y;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  flush();
  return { segments, range: Number.isFinite(lo) ? [lo, hi] : null };
}

/** "Nice" tick values between min and max (1, 2, 5 times a power of ten), about `count` of them. */
export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / power;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * power;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** A readable label for a tick (no 0.30000000000000004). */
export const tickLabel = (v: number): string => (Math.abs(v) < 1e-12 ? "0" : String(Number(v.toPrecision(6))));

/**
 * The y window for a set of curves when the caller gave none: the middle of what the formulas do, so one point shooting off to a million does not flatten
 * the rest into a line. Falls back to a plain -10..10.
 */
export function fitY(ranges: Array<[number, number] | null>, samples: number[]): [number, number] {
  const finite = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length < 2) {
    const r = ranges.find(Boolean);
    return r ? padRange(r[0], r[1]) : [-10, 10];
  }
  const at = (q: number) => finite[Math.min(finite.length - 1, Math.max(0, Math.round(q * (finite.length - 1))))]!;
  const lo = at(0.02);
  const hi = at(0.98);
  return padRange(Math.min(lo, 0), Math.max(hi, 0));
}

function padRange(lo: number, hi: number): [number, number] {
  if (hi - lo < 1e-9) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** A formula's variables must be x or one of the graph's own parameters. Returns the error to hand back to the model, or null. */
export function checkGraphFormula(expression: string, params: readonly string[]): { ok: true; tree: MathNode } | { ok: false; error: string } {
  const parsed = parseMath(expression, ["x", ...params]);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const scope: Record<string, number> = Object.fromEntries(params.map((p) => [p, 1]));
  let defined = 0;
  for (let i = -20; i <= 20; i += 1) if (Number.isFinite(evaluateMath(parsed.tree, { ...scope, x: i / 4 }))) defined += 1;
  if (defined === 0) return { ok: false, error: "the formula is not defined for any x between -5 and 5" };
  return { ok: true, tree: parsed.tree };
}
