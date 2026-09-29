"use client";

import * as m from "framer-motion/m";
import { useTransform, type MotionValue } from "framer-motion";
import { useMotionCapabilities } from "@/lib/motion/capabilities";
import type { SceneTone } from "./SceneShell";
import styles from "./SectionHandoff.module.css";

/**
 * A thin band between two `SceneShell`s that blends one tone into the next, so consecutive sections
 * don't meet at a hard edge (plan12.md task 2/14's "tone/background interpolation" handoff
 * pattern). Lives in normal document flow between the two shells it bridges — never `position:
 * fixed`/`sticky`, never a scroll listener of its own, never `pointer-events` other than `none`, so
 * it cannot intercept scroll or clicks.
 *
 * `progress` is optional and, if given, must be a MotionValue the *caller* already owns from their
 * own single scroll source — this component never calls `useScroll` itself, matching plan11's "one
 * scroll source per scene" rule. Without one (or under a tier with `scrollChoreography` off), it
 * falls back to a static gradient already at its resolved blend — same visual idea, no motion.
 */
export type SectionHandoffProps = {
  from: SceneTone;
  to: SceneTone;
  progress?: MotionValue<number>;
  className?: string;
};

// Kept in sync by hand with SceneShell.module.css's tone backgrounds.
const TONE_COLOR: Record<SceneTone, string> = {
  navy: "#0e2a47", // --colour-navy-900
  cream: "#fbf8f2", // --colour-cream
  white: "#ffffff",
  mint: "#e9f5ef", // --colour-mint-100
};

function ScrollLinkedHandoff({
  progress,
  from,
  to,
  className,
}: {
  progress: MotionValue<number>;
  from: string;
  to: string;
  className: string;
}) {
  const background = useTransform(progress, [0, 1], [from, to]);
  return <m.div className={className} aria-hidden="true" data-section-handoff="" style={{ background }} />;
}

export function SectionHandoff({ from, to, progress, className }: SectionHandoffProps) {
  const { scrollChoreography } = useMotionCapabilities();
  const joined = [styles.handoff, className].filter(Boolean).join(" ");
  const fromColor = TONE_COLOR[from];
  const toColor = TONE_COLOR[to];

  if (!progress || !scrollChoreography) {
    return (
      <div
        className={joined}
        aria-hidden="true"
        data-section-handoff=""
        style={{ background: `linear-gradient(180deg, ${fromColor}, ${toColor})` }}
      />
    );
  }

  return <ScrollLinkedHandoff progress={progress} from={fromColor} to={toColor} className={joined} />;
}
