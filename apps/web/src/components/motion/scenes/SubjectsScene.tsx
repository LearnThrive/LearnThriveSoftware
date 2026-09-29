"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";
import * as m from "framer-motion/m";
import { useMotionValue, useReducedMotion, useTransform, type MotionValue } from "framer-motion";
import { useScene } from "@/lib/motion/scroll";
import { useMotionTier } from "@/lib/motion/capabilities";
import { ParallaxLayer } from "@/components/motion/primitives/ParallaxLayer";
import styles from "@/app/(public)/subjects/subjects.module.css";

/**
 * plan11.md task 9: /subjects becomes the second flagship route. Deliberately mirrors
 * HeroScene.tsx's restraint rather than inventing a bigger effect for this page — same bounded
 * background parallax via ParallaxLayer, same tier/reduced-motion gating pattern.
 *
 * The title's masked-reveal look (.heroMarkBg sweeps a green highlight in under "cover") is
 * subjects.module.css's existing `lt-mark` keyframe, unchanged here — it already runs on first
 * paint, before JavaScript, exactly like the homepage hero's identical treatment, so duplicating it
 * in Motion would only add a hydration/LCP risk for no visual gain. What's new is scroll-linked: a
 * bounded background parallax (8-20px) and a gentle fade/lift on the hero's text block as it
 * scrolls past — the whole block moves and fades together (not just the lead, the way HeroScene
 * splits headline from copy) because this page's hero is a single stacked column, not a two-column
 * split, so there is no separate "photo" layer to keep still against.
 */
export function SubjectsHeroScene({ children }: { children: ReactNode }) {
  const { ref, smoothProgress } = useScene(["start start", "end start"]);
  const tier = useMotionTier();
  const reduceMotion = useReducedMotion();
  const active = tier === "full" && !reduceMotion;

  const innerY = useTransform(smoothProgress, [0, 1], active ? [0, -20] : [0, 0]);
  const innerOpacity = useTransform(smoothProgress, [0, 1], active ? [1, 0.88] : [1, 1]);

  return (
    <section ref={ref as RefObject<HTMLElement>} className={styles.hero} data-motion-scene="subjects-hero">
      <ParallaxLayer progress={smoothProgress} from={0} to={14} className={styles.heroDots} aria-hidden />
      <div className={styles.heroGlow} aria-hidden="true" />
      <m.div className={styles.heroInner} style={{ y: innerY, opacity: innerOpacity }}>
        {children}
      </m.div>
    </section>
  );
}

/**
 * The "section-to-section visual handoff" bullet: as a subject section becomes the one centred in
 * view, its icon badge gently scales up and settles; as the next section takes over, this one
 * recedes. Deliberately scoped to just the icon badge, not the whole section (its image/text/level
 * cards stay untouched) — a small, self-contained, bounded effect that reads the same way
 * regardless of which side of the alternating two-column layout the badge sits on, rather than a
 * connecting line or path stretched between sections that would need to bend around that
 * alternation (this page has no single fixed column the way the homepage's "How it works" list
 * does, which is what LearningPathScene's connector relies on).
 *
 * All three subject icons share ONE scroll progress source (SubjectsListScene below), not one each
 * — lib/motion/scroll.ts's useSceneProgress doc comment is explicit about this ("one scroll
 * progress source per scene... do not attach ten separate scroll listeners"), and profiling the
 * first version of this task (three independent useScene() calls, one per icon) against the
 * pre-task-9 build showed exactly the cost that rule warns about: scroll-down dropped frames on
 * /subjects went from 1.6% to 6.3%, p95 frame time roughly doubled. Deriving each icon's window
 * from one shared MotionValue (the same technique ProductStoryScene's StageDotFill already uses
 * for its six progress segments) removed that regression.
 */
const SubjectsProgressContext = createContext<MotionValue<number> | null>(null);

export function SubjectsListScene({ children }: { children: ReactNode }) {
  const { ref, smoothProgress } = useScene(["start end", "end start"]);
  return (
    <SubjectsProgressContext.Provider value={smoothProgress}>
      <div ref={ref as RefObject<HTMLDivElement>}>{children}</div>
    </SubjectsProgressContext.Provider>
  );
}

/** [start, end] slice of the shared progress (0..1) this icon should be considered "current" within. */
export function SubjectIconScene({ range, children }: { range: [number, number]; children: ReactNode }) {
  const sharedProgress = useContext(SubjectsProgressContext);
  // A stable, unused fallback so this never throws if SubjectIconScene is ever rendered outside
  // SubjectsListScene — useTransform/useMotionValue must be called unconditionally either way
  // (Rules of Hooks), so the fallback has to exist rather than being skipped.
  const fallbackProgress = useMotionValue(0);
  const progress = sharedProgress ?? fallbackProgress;

  const tier = useMotionTier();
  const reduceMotion = useReducedMotion();
  const active = tier === "full" && !reduceMotion;

  const [start, end] = range;
  const mid = (start + end) / 2;
  const scale = useTransform(progress, [start, mid, end], active ? [0.88, 1, 0.88] : [1, 1, 1]);
  const opacity = useTransform(progress, [start, mid, end], active ? [0.7, 1, 0.7] : [1, 1, 1]);

  return (
    <m.div className={styles.subjectIcon} style={{ scale, opacity }}>
      {children}
    </m.div>
  );
}
