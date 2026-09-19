"use client";

import { useEffect, useState } from "react";
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
 * `committed` tracks "the value this instance has already accounted for" as paired state (not a
 * ref — react-hooks/refs disallows reading one during render) so a genuine change can be detected
 * synchronously during render; the actual requestAnimationFrame loop lives in an effect whose own
 * setState calls happen inside the rAF callback, never as a bare statement in the effect body
 * (react-hooks/set-state-in-effect).
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value);
  const [committed, setCommitted] = useState(value);
  const [animateFrom, setAnimateFrom] = useState<number | null>(null);

  if (value !== committed) {
    const from = committed;
    setCommitted(value);
    if (prefersReducedMotion()) setDisplay(value);
    else setAnimateFrom(from);
  }

  useEffect(() => {
    if (animateFrom === null) return;
    const from = animateFrom;
    const to = value;
    const duration = 380; // --duration-slow — a count is a bigger, slower change than a hover/press
    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setAnimateFrom(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animateFrom, value]);

  return <span className={className}>{display}</span>;
}
