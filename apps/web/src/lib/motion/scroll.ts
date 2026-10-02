"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionValue, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import type { RefObject } from "react";
import { indexForProgress } from "./thresholds";

type ScrollOffset = NonNullable<Parameters<typeof useScroll>[0]>["offset"];

/**
 * One scroll-progress source per scene (plan10.md section 37: "Use one scroll progress source
 * per scene... Do not attach ten separate scroll listeners"). Every scene component calls this
 * once against its own root ref, then derives every sub-value (opacity, x/y, path length) from
 * the returned `smoothProgress` with useTransform — never from a second useScroll call.
 *
 * The raw progress is passed through a spring (matching plan10.md section 26's "spring-follow"
 * guidance applied to scroll, not just pointer input) so choreography settles smoothly rather
 * than snapping frame-to-frame with raw scroll deltas — Safari in particular reports scroll in
 * visibly coarser steps than Chrome, and the spring absorbs that.
 */
export function useSceneProgress(
  target: RefObject<HTMLElement | null>,
  offset: ScrollOffset = ["start end", "end start"],
) {
  const { scrollYProgress } = useScroll({ target, offset });
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 240,
    damping: 40,
    mass: 0.4,
  });
  return { rawProgress: scrollYProgress, smoothProgress };
}

/**
 * Progress 0..1 through the PIN RANGE of a `position: sticky` element: how far the page has scrolled
 * while the element is held in place by its parent (plan15 Wave 5 section 9.4's pinned hero).
 *
 * `useSceneProgress` measures where an element is, which is exactly wrong for one that is pinned: its
 * position stops changing, so its progress would sit at 0 for the whole time the scene is playing.
 * This reads the page's own scroll instead, divided by the room the element's parent gives it to
 * stay pinned (parent height minus its own height, re-measured with a ResizeObserver). Same spring
 * as `useSceneProgress`, so the two are interchangeable to the choreography that consumes them.
 */
export function usePinnedProgress(target: RefObject<HTMLElement | null>, enabled = true) {
  const { scrollY } = useScroll();
  const range = useMotionValue(1);
  // When the scene is not pinned (every tier but full) its progress is never read, so it must cost
  // nothing: a constant source instead of the live scroll, and no measuring. Otherwise a spring would
  // step on every scroll frame of every page load for a value nothing consumes.
  const idle = useMotionValue(0);

  useEffect(() => {
    if (!enabled) return;
    const element = target.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const measure = () => range.set(Math.max(1, parent.offsetHeight - element.offsetHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, range, enabled]);

  const rawProgress = useTransform([enabled ? scrollY : idle, range], ([y, r]: number[]) => Math.min(1, Math.max(0, y / r)));
  const smoothProgress = useSpring(rawProgress, { stiffness: 240, damping: 40, mass: 0.4 });
  return { rawProgress, smoothProgress };
}

/** Convenience: a ref plus the scene progress it drives, so a scene only destructures one thing. */
export function useScene(offset?: Parameters<typeof useSceneProgress>[1]) {
  const ref = useRef<HTMLElement | null>(null);
  const progress = useSceneProgress(ref, offset);
  return { ref, ...progress };
}

/**
 * The discrete step (0 to count-1) a scene's scroll progress is in, as React state that changes only
 * when the step does. Use it for "which of these is showing"; anything continuous — an opacity, a
 * fill, an offset — should stay on a MotionValue instead. The previous step is held in a ref, so a
 * progress value that updates every frame (and does, while a spring settles) costs a comparison,
 * not a `setState` dispatch — see lib/motion/thresholds.ts.
 */
export function useDiscreteProgress(progress: MotionValue<number>, count: number): number {
  const [index, setIndex] = useState(0);
  const previous = useRef(0);
  useMotionValueEvent(progress, "change", (latest) => {
    const next = indexForProgress(latest, count);
    if (next === previous.current) return;
    previous.current = next;
    setIndex(next);
  });
  return index;
}
