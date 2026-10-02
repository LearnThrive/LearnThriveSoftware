"use client";

import { useEffect, useRef, type ReactNode } from "react";
import * as m from "framer-motion/m";
import { useTransform, type MotionValue } from "framer-motion";
import { observeInView } from "@/lib/motion/activity";
import { useMotionCapabilities } from "@/lib/motion/capabilities";
import {
  clampParallaxPx,
  parallaxOverscanPx,
  parallaxScaleFor,
  PARALLAX_DEPTH_MAX_PX,
  type ParallaxDepth,
} from "@/lib/motion/depth";

/**
 * One depth layer of a scroll-linked scene (plan11.md task 8): moves by a bounded number of pixels
 * as `progress` (0..1, from the scene's single useScene/useScroll source) advances.
 *
 * Authored ranges are for the "full" tier. They are multiplied by the tier's `parallaxScale` — 1
 * on full, less on standard, a token amount on light, and zero when the visitor has asked for
 * reduced motion — so a phone gets a little depth, a tablet a bit more, and nobody who opted out of
 * motion gets any, without a per-scene branch. Movement is also hard-capped by `depth`, because
 * depth is an accent: a layer that travels a third of the screen is a different effect.
 *
 * Depth presets (lib/motion/depth.ts), chosen by what the layer is:
 *   accent (default) <= 48px   chips, cards, the main object
 *   scene            <= 120px  a layer that is the point of a scene (a large photo, an illustration)
 *   cinematic        <= 200px  a large BACKGROUND layer; full tier only (still elsewhere). It moves
 *                              far enough that its edges would show, so the layer sets
 *                              `--parallax-overscan` (px) on itself: size it with
 *                              `inset: calc(var(--parallax-overscan) * -1) 0` inside an
 *                              `overflow: hidden` frame and the edges never appear.
 * Tiers: full/standard/light (scaled by parallaxScale), never under reduced motion; cinematic on
 * full only.
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
  /** How far this layer may travel; see above. Default "accent" (<= 48px). */
  depth?: ParallaxDepth;
  className?: string;
  /** For a purely decorative layer (a glow, a dot grid) that carries its look in `className`. */
  "aria-hidden"?: boolean;
  children?: ReactNode;
};

/** No `accent` layer travels further than this, whatever a caller asks for. */
export const MAX_PARALLAX_PX = PARALLAX_DEPTH_MAX_PX.accent;

export function ParallaxLayer({
  progress,
  from = 0,
  to = 16,
  disabled = false,
  promote = false,
  axis = "y",
  depth = "accent",
  className,
  "aria-hidden": ariaHidden,
  children,
}: ParallaxLayerProps) {
  const { tier, scrollChoreography, parallaxScale } = useMotionCapabilities();
  const scale = disabled || !scrollChoreography ? 0 : parallaxScaleFor(depth, tier, parallaxScale);
  const offset = useTransform(progress, [0, 1], [clampParallaxPx(from, depth) * scale, clampParallaxPx(to, depth) * scale]);
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
      style={{
        ...(axis === "x" ? { x: offset } : { y: offset }),
        // Only a cinematic layer needs it: the room it must overscan by to keep its edges hidden.
        ...(depth === "cinematic" ? ({ "--parallax-overscan": `${parallaxOverscanPx(from, to)}px` } as object) : null),
      }}
    >
      {children}
    </m.div>
  );
}
