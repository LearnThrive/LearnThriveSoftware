/**
 * Turning a continuous scroll progress into a discrete step, and only telling React when the step
 * actually changes (plan11.md task 7).
 *
 * A scroll-linked scene has two kinds of output. Continuous ones — an opacity, a fill, a parallax
 * offset — belong on MotionValues and never touch React. Discrete ones — "which of these six scenes
 * is showing" — are genuine UI state, so React is the right owner; but the scroll progress that
 * decides them updates on every frame, and calling `setState` on every frame of every scroll just to
 * say "still scene 3" wastes a dispatch each time and re-renders the scene subtree on each real change
 * that follows. So the step is computed here and compared with the last one; React hears about
 * crossings only.
 */

/** The step (0 to count-1) a 0..1 progress value falls in. Clamped, and safe against NaN. */
export function indexForProgress(progress: number, count: number): number {
  if (count <= 0 || !Number.isFinite(progress)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(progress * count)));
}

/**
 * A stateful crossing detector: feed it every progress value, and `onChange` fires only when the
 * step differs from the previous one. A fast reverse scroll that skips from the last step to the
 * first fires once, with the first — it reports where progress *is*, not every step it passed.
 */
export function createThresholdTracker(
  count: number,
  onChange: (index: number) => void,
  initial = 0,
): (progress: number) => void {
  let current = initial;
  return (progress) => {
    const next = indexForProgress(progress, count);
    if (next === current) return;
    current = next;
    onChange(next);
  };
}
