import type { MotionTier } from "./capabilities";

/**
 * The decisions behind smooth scrolling (plan15 Wave 4), kept pure so they can be tested without a
 * browser. The component that acts on them is components/motion/SmoothScroll.tsx.
 *
 * Why this much care: a smooth-scroll library is the most common reason a Windows site "feels
 * off" — high-refresh displays, precision touchpads whose small wheel deltas get smoothed twice,
 * broken keyboard/anchor/find-in-page behaviour, jank against sticky and pinned scenes. So it is
 * built to keep the browser's REAL scroll position (everything that reads scrollY, every
 * position: sticky, Motion's useScroll, keeps working unchanged), to apply only where it helps,
 * and to be switchable off at build time and at run time.
 */

/** Build-time kill switch: NEXT_PUBLIC_SMOOTH_SCROLL=0 compiles it out entirely. */
export const SMOOTH_SCROLL_BUILD_ENABLED = process.env.NEXT_PUBLIC_SMOOTH_SCROLL !== "0";

/** Run-time kill switch for debugging: `?smooth=0` (kept for the tab in sessionStorage). */
export const SMOOTH_SCROLL_QUERY = "smooth";
export const SMOOTH_SCROLL_STORAGE_KEY = "lt-smooth";

export interface SmoothScrollSignals {
  tier: MotionTier;
  /** A genuinely fine, hovering pointer: a mouse or trackpad, never touch. */
  finePointer: boolean;
  saveData: boolean;
  buildEnabled: boolean;
  /** location.search, e.g. "?smooth=0". */
  search: string;
  /** A previously stored "off" for this tab. */
  storedOff: boolean;
}

/**
 * Enabled only when every one of these holds. Touch devices keep native touch scrolling (no
 * synced-touch smoothing), the light and reduced tiers keep native scrolling, and so do visitors
 * who asked for less data.
 */
export function shouldSmoothScroll(signals: SmoothScrollSignals): boolean {
  if (!signals.buildEnabled) return false;
  if (signals.tier !== "full" && signals.tier !== "standard") return false;
  if (!signals.finePointer) return false;
  if (signals.saveData) return false;
  if (signals.storedOff) return false;
  const query = new URLSearchParams(signals.search).get(SMOOTH_SCROLL_QUERY);
  return query !== "0";
}

/**
 * Is this wheel event from a precision touchpad (or anything else that already scrolls smoothly)?
 * Those send many small, fractional pixel deltas; smoothing them again makes the page feel like it
 * is wading through water. A mouse wheel sends discrete notches of >= ~50 CSS px (100 on Windows
 * at 100% scaling, more at higher scaling). Line- and page-mode deltas are always a wheel.
 *
 * It is a heuristic and deliberately errs toward native: a miss costs smoothing on one event, never
 * a worse scroll.
 */
export function isTouchpadLikeWheel(event: { deltaX: number; deltaY: number; deltaMode: number }): boolean {
  if (event.deltaMode !== 0) return false;
  const magnitude = Math.max(Math.abs(event.deltaY), Math.abs(event.deltaX));
  if (magnitude === 0) return false;
  if (magnitude < 50) return true;
  // A fractional delta at any size is a touchpad/high-resolution device; a wheel notch is whole.
  return !Number.isInteger(event.deltaY) || !Number.isInteger(event.deltaX);
}

/** Exponential ease-out: fast start, long soft landing. */
export const smoothScrollEasing = (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t));

export const SMOOTH_SCROLL_OPTIONS = {
  /** Seconds a wheel notch takes to settle: 1.0-1.2s per the plan. */
  duration: 1.1,
  wheelMultiplier: 1,
  /** Touch devices never reach this code path (shouldSmoothScroll), but be explicit. */
  syncTouch: false,
} as const;
