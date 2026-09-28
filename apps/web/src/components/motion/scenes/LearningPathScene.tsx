"use client";

import * as m from "framer-motion/m";
import { LazyMotion, domAnimation, useTransform } from "framer-motion";
import type { ReactNode } from "react";
import { useScene } from "@/lib/motion/scroll";
import styles from "@/app/(public)/home.module.css";

/**
 * plan10.md section 5: the learning-path connector (previously a static repeating-gradient CSS
 * background, home.module.css's .howStepsLine) becomes a real SVG path that draws in as the
 * section scrolls through view, rather than always being fully drawn. Same position/colour as
 * the CSS version it replaces — this is the same visual device made scroll-reactive, not a
 * redesign of "How it works".
 *
 * Always renders the same SVG structure, and pathLength always uses the same [0,1] -> [0,1]
 * range — neither branches on useReducedMotion(). Both used to (an element-tree branch, then a
 * range branch after the first fix), and both caused a real hydration mismatch: Motion renders a
 * useTransform value's computed result directly into the SSR'd HTML, and useReducedMotion()
 * itself can read differently between the server (no window, assumes not reduced) and a real
 * reduced-motion client's first render — so anything that branches on it, structure or value,
 * can disagree between the two. The "How it works" steps this connects are always fully present
 * in the DOM regardless (see page.tsx's howSteps.map, unconditional), so the line staying
 * technically scroll-reactive under reduced motion — a decorative 2px dashed line — costs
 * nothing a reduced-motion user actually needs.
 */
export function LearningPathScene({ children }: { children: ReactNode }) {
  const { ref, smoothProgress } = useScene(["start 0.85", "end 0.4"]);
  const pathLength = useTransform(smoothProgress, [0, 1], [0, 1]);

  return (
    <LazyMotion features={domAnimation}>
      <div ref={ref as React.RefObject<HTMLDivElement>} className={styles.howStepsPathWrap}>
        <div className={styles.howStepsPathTrack}>
          <svg
            className={styles.howStepsPathSvg}
            viewBox="0 0 2 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <m.line
              x1="1"
              y1="0"
              x2="1"
              y2="100"
              stroke="var(--lt-border)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <m.line
              x1="1"
              y1="0"
              x2="1"
              y2="100"
              stroke="var(--lt-green-dark)"
              strokeWidth="2"
              strokeDasharray="5 6"
              vectorEffect="non-scaling-stroke"
              style={{ pathLength }}
            />
          </svg>
        </div>
        {children}
      </div>
    </LazyMotion>
  );
}
