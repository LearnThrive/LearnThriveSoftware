"use client";

import { useEffect, useRef, type ReactNode } from "react";
import * as m from "framer-motion/m";
import { useTransform, type MotionValue } from "framer-motion";
import { observeInView } from "@/lib/motion/activity";
import { useMotionCapabilities } from "@/lib/motion/capabilities";

/**
 * One depth layer of a scroll-linked scene (plan11.md task 8): moves by a bounded number of pixels
 * as `progress` (0..1, from the scene's single useScene/useScroll source) advances.
 *
 * Authored ranges are for the "full" tier. They are multiplied by the tier's `parallaxScale` — 1
 * on full, less on standard, a token amount on light, and zero when the visitor has asked for
 * reduced motion — so a phone gets a little depth, a tablet a bit more, and nobody who opted out of
 * motion gets any, without a per-scene branch. Movement is also hard-capped, because depth is
 * an accent: a layer that travels a third of the screen is a different effect.
 *
 * Suggested authored ranges (the plan's): background detail 8-20px, the main object 10-24px,
 * a foreground chip 18-34px — deeper layers move further.
 *
 * It moves with `transform` only and never touches layout. `promote` gives the layer its own
 * compositor layer (`will-change: transform`) *while it is near the screen and not otherwise*: for
 * a large layer such as a hero photograph, that is what turns a JavaScript-driven transform from
 * "repaint the parent every frame" into "move a texture". It is opt-in because the hint is not free
 * — every promoted layer holds memory — and belongs only on layers a profile shows are hot.
 */
export type ParallaxLayerProps = {
  /** The scene's scroll progress, 0..1. One source per scene; never a second useScroll. */
  progress: MotionValue<number>;
  /** Offset in px at progress 0, before tier scaling. Default 0: at rest, nothing has moved. */
  from?: number;
  /** Offset in px at progress 1, before tier scaling. Default 16. */
  to?: number;
  disabled?: boolean;
  /** Promote to a compositor layer while near the viewport. Only for measured hot layers. */
  promote?: boolean;
  axis?: "y" | "x";
  className?: string;
  /** For a purely decorative layer (a glow, a dot grid) that carries its look in `className`. */
  "aria-hidden"?: boolean;
  children?: ReactNode;
};

/** No layer travels further than this, whatever a caller asks for. */
export const MAX_PARALLAX_PX = 48;

const clampPx = (value: number) => Math.max(-MAX_PARALLAX_PX, Math.min(MAX_PARALLAX_PX, value));

export function ParallaxLayer({
  progress,
  from = 0,
  to = 16,
  disabled = false,
  promote = false,
  axis = "y",
  className,
  "aria-hidden": ariaHidden,
  children,
}: ParallaxLayerProps) {
  const { scrollChoreography, parallaxScale } = useMotionCapabilities();
  const scale = disabled || !scrollChoreography ? 0 : parallaxScale;
  const offset = useTransform(progress, [0, 1], [clampPx(from) * scale, clampPx(to) * scale]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !promote || scale === 0) return;
    const stop = observeInView(
      element,
      (inView) => {
        element.style.willChange = inView ? "transform" : "";
      },
      "120px",
    );
    return () => {
      stop();
      element.style.willChange = "";
    };
  }, [promote, scale]);

  return (
    <m.div
      ref={ref}
      className={className}
      aria-hidden={ariaHidden}
      style={axis === "x" ? { x: offset } : { y: offset }}
    >
      {children}
    </m.div>
  );
}
