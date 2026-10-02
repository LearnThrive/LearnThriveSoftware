/**
 * The geometry behind the subject "worlds" (plan15 Wave 9 section 13.1): small, pure functions so the
 * scenes in components/motion/scenes/SubjectStage.tsx can be driven by one scroll-progress number and the
 * maths of them can be tested (tests/subjectStage.test.mjs). Nothing here touches the DOM.
 *
 * Every position is computed from the progress analytically, never measured from the rendered SVG, so a
 * scene has no layout read and no effect on first paint, and the server and client agree exactly.
 */
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Maps `value` from [from, to] onto 0..1, clamped: "how far through this window are we". */
export function windowed(value: number, from: number, to: number): number {
  if (to === from) return value >= to ? 1 : 0;
  return clamp01((value - from) / (to - from));
}

// ── Maths: a curve on a coordinate plane ────────────────────────────────────────────────────────

/** The plotted function on t in 0..1, returning 0..1: a gentle S with a ripple, so it has a visible slope everywhere. */
export function curveValue(t: number): number {
  const x = clamp01(t);
  return clamp01(0.5 - 0.38 * Math.cos(Math.PI * x) + 0.1 * Math.sin(Math.PI * 4 * x) * (1 - x));
}

/** dy/dt of curveValue, by a symmetric difference (the tangent's slope in unit space). */
export function curveSlope(t: number): number {
  const h = 0.002;
  const a = clamp01(t - h);
  const b = clamp01(t + h);
  return (curveValue(b) - curveValue(a)) / (b - a || 1);
}

export interface PlotBox {
  x0: number;
  x1: number;
  /** y of value 0 (the bottom of the plot) and of value 1 (the top). */
  yBottom: number;
  yTop: number;
}

export const MATHS_PLOT: PlotBox = { x0: 56, x1: 604, yBottom: 232, yTop: 28 };

export function plotPoint(t: number, box: PlotBox = MATHS_PLOT): { x: number; y: number } {
  return { x: box.x0 + clamp01(t) * (box.x1 - box.x0), y: box.yBottom - curveValue(t) * (box.yBottom - box.yTop) };
}

/** An SVG path for the whole curve, sampled finely enough to look smooth, with fixed decimals so SSR and client match. */
export function curvePath(box: PlotBox = MATHS_PLOT, samples = 72): string {
  const parts: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const { x, y } = plotPoint(i / samples, box);
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join(" ");
}

/** The two ends of a tangent segment of half-length `half` (in plot pixels) at t. */
export function tangentSegment(t: number, half: number, box: PlotBox = MATHS_PLOT) {
  const { x, y } = plotPoint(t, box);
  // Slope in pixels: dy/dx = -(dvalue/dt) * (yBottom-yTop) / (x1-x0).
  const slope = -curveSlope(t) * ((box.yBottom - box.yTop) / (box.x1 - box.x0));
  const length = Math.hypot(1, slope);
  const dx = (half * 1) / length;
  const dy = (half * slope) / length;
  return { x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy };
}

// ── Polylines: a signal travelling along edges, a route through milestones ──────────────────────────

export type Point = readonly [number, number];

/** The point `progress` (0..1) of the way along a polyline, measured by length, and which segment it is on. */
export function pointAlong(points: readonly Point[], progress: number): { x: number; y: number; segment: number } {
  if (points.length === 0) return { x: 0, y: 0, segment: 0 };
  if (points.length === 1) return { x: points[0][0], y: points[0][1], segment: 0 };
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(length);
    total += length;
  }
  let remaining = clamp01(progress) * total;
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 0 : Math.min(1, remaining / lengths[i]);
      return {
        x: points[i][0] + (points[i + 1][0] - points[i][0]) * f,
        y: points[i][1] + (points[i + 1][1] - points[i][1]) * f,
        segment: i,
      };
    }
    remaining -= lengths[i];
  }
  const last = points[points.length - 1];
  return { x: last[0], y: last[1], segment: lengths.length - 1 };
}

/** Cumulative fraction of the polyline's length at which each vertex sits (first is 0, last is 1). */
export function vertexFractions(points: readonly Point[]): number[] {
  const out = [0];
  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(length);
    total += length;
  }
  let sum = 0;
  for (const length of lengths) {
    sum += length;
    out.push(total === 0 ? 0 : sum / total);
  }
  return out;
}

/** A closed loop of `count` nodes around an ellipse, first node at the top: the "connected system". */
export function loopNodes(count: number, cx: number, cy: number, rx: number, ry: number): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    return [Number((cx + rx * Math.cos(angle)).toFixed(1)), Number((cy + ry * Math.sin(angle)).toFixed(1))] as const;
  });
}

/** A gently wandering route from left to right, as vertices, for the 11+ path. */
export function routePoints(width: number, height: number, vertices = 9): Point[] {
  return Array.from({ length: vertices }, (_, i) => {
    const t = i / (vertices - 1);
    const x = 24 + t * (width - 48);
    const y = height / 2 + Math.sin(t * Math.PI * 2.2 + 0.6) * (height * 0.3) * (0.65 + 0.35 * (1 - t));
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });
}

/** 0 -> 1 -> overshoot-and-settle for a flag being "planted" (scale), over a progress window. */
export function plantScale(progress: number, from: number, to: number): number {
  const t = windowed(progress, from, to);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // easeOutBack, a little restrained.
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
