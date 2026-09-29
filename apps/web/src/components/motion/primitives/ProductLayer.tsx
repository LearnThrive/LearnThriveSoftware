"use client";

import type { ReactNode } from "react";
import type { MotionValue } from "framer-motion";
import { ParallaxLayer } from "./ParallaxLayer";
import { PointerDepth } from "./PointerDepth";
import styles from "./ProductLayer.module.css";

/**
 * A floating product/screenshot surface with bounded scroll depth and pointer tilt (plan12.md task
 * 2) — composed entirely from plan11's existing `ParallaxLayer` and `PointerDepth`, which already
 * carry the correct tier/reduced-motion/touch gating; this adds no new capability logic of its own.
 *
 * `progress` is optional and, like `SectionHandoff`, must come from the caller's own single scroll
 * source — omit it for a surface that only leans toward the pointer (no scroll-linked movement).
 * `promote` on the inner `ParallaxLayer` defaults on: a product surface is exactly the "large visual
 * element likely to be a JS-driven transform target" case `ParallaxLayer`'s own docs call out as
 * worth promoting, so callers using this for its intended purpose don't have to know that; profile
 * real usage before assuming it holds for a use this primitive wasn't designed for.
 */
export type ProductLayerProps = {
  progress?: MotionValue<number>;
  from?: number;
  to?: number;
  pointerDepth?: boolean;
  className?: string;
  children: ReactNode;
};

export function ProductLayer({
  progress,
  from = -10,
  to = 10,
  pointerDepth = true,
  className,
  children,
}: ProductLayerProps) {
  const surface = <div className={[styles.surface, className].filter(Boolean).join(" ")}>{children}</div>;
  const withDepth = pointerDepth ? <PointerDepth>{surface}</PointerDepth> : surface;

  if (!progress) return withDepth;

  return (
    <ParallaxLayer progress={progress} from={from} to={to} promote>
      {withDepth}
    </ParallaxLayer>
  );
}
