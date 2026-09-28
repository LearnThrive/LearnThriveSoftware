"use client";

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import * as m from "framer-motion/m";
import { useMotionValue, useSpring, useTransform } from "framer-motion";
import { useFinePointer, useMotionCapabilities } from "@/lib/motion/capabilities";

/**
 * A small tilt-and-drift toward the pointer (plan11.md task 8) — a card that seems to sit slightly
 * above the page and lean toward the cursor. Deliberately tiny: at most ~2° of rotation and ~6px of
 * travel, because at any more the content stops reading as "lifted" and starts reading as "loose".
 *
 * - **Only where a pointer exists.** Inert unless the pointer is genuinely fine and hovering (a
 *   mouse or trackpad) *and* the tier allows it. Touch screens, the light tier and reduced motion
 *   get the children untouched — no handlers attached, no transform, nothing to opt out of.
 * - **No React state.** The pointer target is a pair of MotionValues, smoothed by springs, and the
 *   handlers only ever `.set()` them, so a mouse moving at 1000 Hz costs no React renders.
 * - **A stable hit target.** The listeners are on a *static* outer wrapper; only the inner element
 *   moves. If the element carrying the pointer listener were the one that tilted, a pointer resting
 *   near its edge would push the element out from under itself, leave it, and let it spring back —
 *   a flicker. Measured against the wrapper that never moves, that cannot happen.
 * - **Bounded layout reads.** The wrapper's rectangle is cached and refreshed at most four times a
 *   second, not read on every move event.
 */
export type PointerDepthProps = {
  /** Maximum tilt in degrees. Default 1.6; keep it at or under 2. */
  maxRotateDeg?: number;
  /** Maximum drift in px. Default 4; keep it at or under 6. */
  maxTranslatePx?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

const SPRING = { stiffness: 220, damping: 24, mass: 0.6 };
const RECT_REFRESH_MS = 250;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function PointerDepth({
  maxRotateDeg = 1.6,
  maxTranslatePx = 4,
  disabled = false,
  className,
  children,
}: PointerDepthProps) {
  const { pointerDepth } = useMotionCapabilities();
  const finePointer = useFinePointer();
  const enabled = pointerDepth && finePointer && !disabled;

  // Where the pointer is across the wrapper, -0.5 (left/top) to 0.5 (right/bottom).
  const targetX = useMotionValue(0);
  const targetY = useMotionValue(0);
  const x = useSpring(targetX, SPRING);
  const y = useSpring(targetY, SPRING);
  // The tilt leans *toward* the pointer: pointer on the right brings the right edge forward.
  const rotateY = useTransform(x, (value) => -value * 2 * maxRotateDeg);
  const rotateX = useTransform(y, (value) => value * 2 * maxRotateDeg);
  const driftX = useTransform(x, (value) => value * 2 * maxTranslatePx);
  const driftY = useTransform(y, (value) => value * 2 * maxTranslatePx);

  const innerRef = useRef<HTMLDivElement>(null);
  const cached = useRef<{ box: DOMRect; at: number } | null>(null);

  // If the feature switches off while the pointer is over the card (a tier change, a prop), settle.
  useEffect(() => {
    if (enabled) return;
    targetX.set(0);
    targetY.set(0);
  }, [enabled, targetX, targetY]);

  const onEnter = () => {
    if (innerRef.current) innerRef.current.style.willChange = "transform";
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const now = performance.now();
    if (!cached.current || now - cached.current.at > RECT_REFRESH_MS) {
      cached.current = { box: event.currentTarget.getBoundingClientRect(), at: now };
    }
    const { box } = cached.current;
    if (box.width === 0 || box.height === 0) return;
    targetX.set(clamp((event.clientX - box.left) / box.width - 0.5, -0.5, 0.5));
    targetY.set(clamp((event.clientY - box.top) / box.height - 0.5, -0.5, 0.5));
  };

  const onLeave = () => {
    cached.current = null;
    targetX.set(0);
    targetY.set(0);
    if (innerRef.current) innerRef.current.style.willChange = "";
  };

  return (
    <div
      className={className}
      onPointerEnter={enabled ? onEnter : undefined}
      onPointerMove={enabled ? onMove : undefined}
      onPointerLeave={enabled ? onLeave : undefined}
    >
      <m.div
        ref={innerRef}
        style={enabled ? { x: driftX, y: driftY, rotateX, rotateY, transformPerspective: 900 } : undefined}
      >
        {children}
      </m.div>
    </div>
  );
}
