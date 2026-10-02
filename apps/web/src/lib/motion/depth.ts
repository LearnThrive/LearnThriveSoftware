import type { MotionTier } from "./capabilities";

/**
 * How far a parallax layer may travel, by what the layer IS (plan15 Wave 2 section 6.3). Depth is
 * an accent, so the default stays the small one; the larger two exist because the owner decided to
 * use Motion's headroom where it earns attention (the hero, chapter transitions, subject worlds):
 *
 * - `accent`    (<= 48px)  a chip, a card, the main object. The default, and what every existing
 *               layer already uses.
 * - `scene`     (<= 120px) a layer that is the point of a scene: a large photo, an illustration.
 * - `cinematic` (<= 200px) a large BACKGROUND layer only, full tier only. It moves far enough that
 *               its edges would show, so the layer must be oversized by `parallaxOverscanPx`.
 *
 * The authored distance is still multiplied by the tier's `parallaxScale`, so a phone never gets
 * the headroom the desktop does.
 */
export type ParallaxDepth = "accent" | "scene" | "cinematic";

export const PARALLAX_DEPTH_MAX_PX: Record<ParallaxDepth, number> = {
  accent: 48,
  scene: 120,
  cinematic: 200,
};

export function clampParallaxPx(value: number, depth: ParallaxDepth = "accent"): number {
  const max = PARALLAX_DEPTH_MAX_PX[depth];
  return Math.max(-max, Math.min(max, value));
}

/**
 * The multiplier for a layer of this depth on this tier. `cinematic` is the one depth with its own
 * tier rule: below the full tier it does not move at all (a phone or tablet gets a still
 * background rather than a smaller version of a 200px drift its layout was not built to hold).
 */
export function parallaxScaleFor(depth: ParallaxDepth, tier: MotionTier, tierScale: number): number {
  if (depth === "cinematic" && tier !== "full") return 0;
  return tierScale;
}

/**
 * How much bigger than its frame a layer must be, on the axis it moves along, so its edges never
 * show at either end of the travel: the largest absolute offset it can reach.
 */
export function parallaxOverscanPx(from: number, to: number, depth: ParallaxDepth = "cinematic"): number {
  return Math.max(Math.abs(clampParallaxPx(from, depth)), Math.abs(clampParallaxPx(to, depth)));
}
