"use client";

import { useRef } from "react";
import { useScroll, useSpring } from "framer-motion";
import type { RefObject } from "react";

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

/** Convenience: a ref plus the scene progress it drives, so a scene only destructures one thing. */
export function useScene(offset?: Parameters<typeof useSceneProgress>[1]) {
  const ref = useRef<HTMLElement | null>(null);
  const progress = useSceneProgress(ref, offset);
  return { ref, ...progress };
}
