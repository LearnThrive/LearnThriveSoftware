"use client";

import { useReducedMotion } from "framer-motion";
import { useScene } from "@/lib/motion/scroll";
import { useMotionTier } from "@/lib/motion/capabilities";
import { PathTrack } from "./SubjectWorld";

/**
 * plan12.md task 6's 11+ motif ("milestones / progression route") — the exact same `PathTrack`
 * `SubjectWorld.tsx` uses for maths and 11+ on the dedicated subject pages, reused here. Its own
 * single `useScene()` (not derived from /subjects's shared subject-section context): the 11+
 * section sits after that shared context's loop, not inside it, so this is one additional scroll
 * source for one section — not the "one per subject, several at once" shape that caused the
 * regression `SubjectsScene.tsx` documents.
 */
export function ElevenPlusMotif() {
  const { ref, smoothProgress } = useScene(["start 0.85", "end 0.4"]);
  const tier = useMotionTier();
  const reduceMotion = useReducedMotion();
  const active = tier === "full" && !reduceMotion;

  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <PathTrack progress={smoothProgress} active={active} dashed />
    </div>
  );
}
