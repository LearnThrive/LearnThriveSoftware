"use client";

import { LazyMotion, domAnimation, useReducedMotion } from "framer-motion";
import * as m from "framer-motion/m";
import type { ReactNode } from "react";
import { motionDuration, motionEase } from "@/lib/motion/tokens";

/**
 * First-view entrance for hero/section copy: a small rise + fade, never a layout-affecting
 * animation, so content is never actually absent — just briefly translated/faded on arrival.
 * `domAnimation` (not the full `domMax` bundle) is enough here: nothing in this component uses
 * drag or layout animation, and pulling in `domMax` for a fade would ship gesture/layout code the
 * marketing site never calls (motion.dev/docs/react-reduce-bundle-size).
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className={className}
        initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduceMotion ? 0.08 : motionDuration.standard + 0.06,
          delay: reduceMotion ? 0 : delay,
          ease: motionEase.gentle,
        }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
