"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion/reducedMotion";

/**
 * A number that counts smoothly between two values instead of snapping — for a count that can
 * genuinely change while its own component instance stays mounted (the topbar's notification
 * badge across a client-side "mark as read"; a dashboard stat after an in-place update).
 *
 * Only animates a *change*: the first render a given instance sees always renders `value`
 * immediately, un-animated. That's deliberate, not an oversight — a dashboard's stat tiles remount
 * on every navigation to the page (a fresh Server Component render), so if this counted up from
 * zero on every render it would count up every single time the page is visited, which plan8
 * section 15 calls out by name as the annoying version of this. Counting only applies to a value
 * that changes *within* one mounted lifetime, which is exactly the case worth animating.
 *
 * The intermediate numbers are written straight to the text node from the animation-frame
 * callback (plan11.md task 4); React is not involved per frame. It used to `setState` on every
 * frame of the 380 ms count. React renders the number exactly once — the value this instance
 * mounted with, held in state that is never set — and never again, so it cannot overwrite the
 * count with the new value before the animation has started, and the effect below owns the text
 * from then on.
 *
 * `shown` is the number currently on screen, updated by the tween itself. A second change that
 * arrives mid-count therefore continues from where the display actually is, rather than from where
 * the previous count was heading.
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [initial] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const from = shown.current;
    if (from === value) return;

    if (prefersReducedMotion()) {
      shown.current = value;
      el.textContent = String(value);
      return;
    }

    const duration = 380; // --duration-slow — a count is a bigger, slower change than a hover/press
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      shown.current = Math.round(from + (value - from) * eased);
      el.textContent = String(shown.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {initial}
    </span>
  );
}
