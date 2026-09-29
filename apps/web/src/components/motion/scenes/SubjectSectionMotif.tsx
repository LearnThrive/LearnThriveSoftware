"use client";

import { useReducedMotion } from "framer-motion";
import { useMotionTier } from "@/lib/motion/capabilities";
import { PathTrack, ScienceNodes } from "./SubjectWorld";
import { useSubjectWindowProgress } from "./SubjectsScene";

/**
 * plan12.md task 6: the four subject motifs (maths/11+ a drawn path, science connected nodes,
 * english no line at all — see SubjectWorld.tsx's own comment for why) reused on /subjects itself,
 * each subject's progress derived from the one shared scroll source `SubjectsListScene` provides
 * rather than a new `useScene()` per section.
 */
export type SubjectMotifKind = "maths" | "english" | "science" | "11-plus";

export function SubjectSectionMotif({ kind, range }: { kind: SubjectMotifKind; range: [number, number] }) {
  const windowed = useSubjectWindowProgress(range);
  const tier = useMotionTier();
  const reduceMotion = useReducedMotion();
  const active = tier === "full" && !reduceMotion;

  if (kind === "english") return null;
  if (kind === "science") return <ScienceNodes progress={windowed} active={active} />;
  return <PathTrack progress={windowed} active={active} />;
}
