"use client";

import { ScrollProgressPath } from "@/components/motion/primitives/ScrollProgressPath";
import { useDiscreteProgress, useScene } from "@/lib/motion/scroll";
import styles from "@/app/(public)/home.module.css";

/**
 * plan10.md section 5's learning-path connector, elevated by plan12.md task 5 from "a line that
 * draws in" to the site's recurring "sequential stages, spatially connected" device: the drawn
 * line now shares its actual drawing code with `SafeguardingTrustPath.tsx` (both call
 * `ScrollProgressPath`, plan11's own primitive for exactly this, rather than each keeping its own
 * near-identical inline SVG), and — the part that was missing entirely — the stage list now
 * highlights the one scroll has actually reached, so the drawn line isn't the only thing that
 * visibly changes as you scroll.
 *
 * This component owns the stage list's rendering itself (`steps` is a plain, serializable prop),
 * not a `children` render-prop: `page.tsx` is a Server Component, and a function cannot cross the
 * server/client boundary as a prop — React throws "Functions are not valid as a child of Client
 * Components" for exactly that shape, caught directly (a 500 on every request) rather than shipped.
 *
 * Still always renders the same SVG structure and the same [0,1] -> [0,1] pathLength range
 * regardless of `useReducedMotion()` — branching either on that value is what caused this file's
 * own hydration mismatch history (see the comment this replaced). `useDiscreteProgress` doesn't
 * have that problem: it starts at index 0 on both server and client and only ever updates via a
 * scroll event after hydration, so the highlighted stage can differ from the server's rendered
 * state without ever *mismatching* it.
 */
export type LearningPathStep = {
  title: string;
  text: string;
  last: boolean;
};

export function LearningPathScene({ steps }: { steps: readonly LearningPathStep[] }) {
  const { ref, smoothProgress } = useScene(["start 0.85", "end 0.4"]);
  const activeIndex = useDiscreteProgress(smoothProgress, steps.length);

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={styles.howStepsPathWrap}
      data-motion-scene="learning-path"
    >
      <div className={styles.howStepsPathTrack}>
        <ScrollProgressPath
          progress={smoothProgress}
          d="M1 0 L1 100"
          viewBox="0 0 2 100"
          preserveAspectRatio="none"
          stroke="var(--lt-green-dark)"
          trackStroke="var(--lt-border)"
          strokeWidth={2}
          dashArray="5 6"
          className={styles.howStepsPathSvg}
        />
      </div>
      <div className={styles.howSteps}>
        {steps.map((step, i) => (
          <div key={step.title} className={styles.howStep}>
            <span
              className={`${styles.howStepNumber} ${
                i > activeIndex ? styles.howStepNumberPending : step.last ? styles.howStepNumberNavy : styles.howStepNumberGreen
              }`}
            >
              {i + 1}
            </span>
            <div className={styles.howStepContent}>
              <h4 className={styles.howStepTitle}>{step.title}</h4>
              <p className={styles.howStepText}>{step.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
