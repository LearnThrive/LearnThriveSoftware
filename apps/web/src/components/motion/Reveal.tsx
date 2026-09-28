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
      {/* initial's y stays a constant 14 regardless of reduceMotion — Motion bakes the initial
          value into SSR'd HTML, and reduceMotion() itself can read differently between the
          server (always false) and a real reduced-motion client's first render, so branching
          the numeric value the way transition's duration/delay do below causes a genuine
          hydration mismatch (found in ProductStoryScene.tsx / SafeguardingScene.tsx during
          plan10's work). A near-zero duration alone is enough for this to read as instant. */}
      <m.div
        className={className}
        initial={{ opacity: 0, y: 14 }}
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
