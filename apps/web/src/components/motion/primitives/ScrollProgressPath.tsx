"use client";

import * as m from "framer-motion/m";
import { useTransform, type MotionValue } from "framer-motion";
import { useMotionCapabilities } from "@/lib/motion/capabilities";

/**
 * An SVG path that draws itself as a scene scrolls (plan11.md task 8) — a learning route, a graph
 * line, a connector between steps. Purely decorative, so the whole SVG is `aria-hidden`.
 *
 * It animates `pathLength`, which Motion renders as a stroke-dash offset: an SVG paint property
 * handled entirely by the compositor-adjacent raster path, never layout, and never a React render
 * (the value is a MotionValue derived from the scene's one scroll source).
 *
 * `range` picks the slice of the scene's progress in which the path draws, so a path can finish
 * before its scene does. Without scroll choreography — reduced motion — the path simply *is* drawn:
 * a line that only appears as you scroll is decoration, and drawing it removes the dependence on
 * movement. (The hydrating render still matches the server's, because the server's tier is fixed;
 * the fully drawn state applies right after hydration.)
 */
export type ScrollProgressPathProps = {
  progress: MotionValue<number>;
  /** SVG path data. */
  d: string;
  viewBox: string;
  /** Slice of `progress` over which the path draws. Default [0, 1]. */
  range?: [number, number];
  stroke?: string;
  strokeWidth?: number;
  /** Faint full-length path drawn underneath, so the route is visible before it is "walked". */
  trackStroke?: string;
  dashArray?: string;
  preserveAspectRatio?: string;
  className?: string;
};

export function ScrollProgressPath({
  progress,
  d,
  viewBox,
  range = [0, 1],
  stroke = "currentColor",
  strokeWidth = 2,
  trackStroke,
  dashArray,
  preserveAspectRatio,
  className,
}: ScrollProgressPathProps) {
  const { scrollChoreography } = useMotionCapabilities();
  const pathLength = useTransform(progress, range, scrollChoreography ? [0, 1] : [1, 1]);

  return (
    <svg
      className={className}
      viewBox={viewBox}
      preserveAspectRatio={preserveAspectRatio}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {trackStroke ? (
        <path d={d} stroke={trackStroke} strokeWidth={strokeWidth} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ) : null}
      <m.path
        data-progress-path=""
        d={d}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dashArray}
        vectorEffect="non-scaling-stroke"
        style={{ pathLength }}
      />
    </svg>
  );
}
