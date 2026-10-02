"use client";

import * as m from "framer-motion/m";
import { useReducedMotion, useTransform, type MotionValue } from "framer-motion";
import type { RefObject } from "react";
import { useScene } from "@/lib/motion/scroll";
import { useMotionTier } from "@/lib/motion/capabilities";
import { AnimatedUnderline } from "@/components/motion/primitives/AnimatedUnderline";
import { SubjectStage } from "@/components/motion/scenes/SubjectStage";
import type { SubjectLandingConfig } from "@/lib/site";
import { motionStagger, staggerDelay } from "@/lib/motion/tokens";

export type SubjectWorldKind = "maths" | "english" | "science" | "11-plus";

export type SubjectWorldProps = {
  subject: SubjectLandingConfig;
  kind: SubjectWorldKind;
};

/**
 * plan11.md task 10: four subject-specific "motion worlds" for the coverage/pathway section of
 * SubjectLandingPage.tsx (maths/english/science/11-plus tuition routes) — one real, distinct motif
 * per subject rather than the same decoration re-skinned four times, but each built from small,
 * restrained, already-legible pieces (a line, a handful of dots, an underline) rather than bespoke
 * illustration this session has no way to visually check (no browser/screenshot tool available):
 *
 * - maths, 11-plus: a horizontal line draws under the four stage/priority cards as the section
 *   scrolls into view, with a small dot at each card that lights up as the line reaches it — "graph
 *   path, point annotations" for maths, "route/path, milestone nodes, progression marker" for
 *   11-plus. Mechanically the same technique (a drawn line + timed dots), which is honest: they are
 *   the same underlying idea (a path through stages) under two different names in the plan, and
 *   forcing two different mechanisms for the same idea would be novelty for its own sake.
 * - science: three small dots connected by short lines, near the section heading, each drifting at
 *   a slightly different depth as you scroll — a restrained reading of "connected-node/diagram
 *   motif and small SVG orbital/depth movement", not an attempt at a literal orbital animation.
 * - english: no line or dots at all — the four stage headings get AnimatedUnderline's drawOnView
 *   instead ("underline drawing"), which suits the subject rather than reusing the maths/11-plus
 *   path mechanic where it does not fit.
 *
 * Every subject uses var(--subject-accent)/var(--subject-ink) (globals.css's existing per-slug
 * colour variables, set on the wrapping .subject-landing--{slug} class) rather than a hardcoded
 * colour per kind, so the motif always matches whichever colour that subject already uses
 * elsewhere on the page.
 */
export function SubjectWorld({ subject, kind }: SubjectWorldProps) {
  const { ref, smoothProgress } = useScene(["start 0.85", "end 0.4"]);
  const tier = useMotionTier();
  const reduceMotion = useReducedMotion();
  const active = tier === "full" && !reduceMotion;
  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="subject-world" data-motion-scene={`subject-world-${kind}`}>
      {/* The stage is this subject's own picture (SubjectStage.tsx): a curve on a plane, an annotated
          sentence, a loop of steps, a route with flags. It replaces the older line-and-dots motifs on the
          landing pages; PathTrack/Milestone/ScienceNodes below stay for /subjects, which shares one scroll
          source across its sections. */}
      <SubjectStage kind={kind} progress={smoothProgress} active={active} />
      <ol
        className="subject-pathway-grid"
        aria-label={`${subject.title} ${subject.coverage.itemLabel === "Priority" ? "priorities" : "stages"}`}
      >
        {subject.coverage.items.map((item, index) => (
          <li className="subject-pathway-card" key={item.title}>
            <span>
              {subject.coverage.itemLabel} {String(index + 1).padStart(2, "0")}
            </span>
            {kind === "english" ? (
              <AnimatedUnderline drawOnView delay={staggerDelay(index, motionStagger.list)}>
                <h3>{item.title}</h3>
              </AnimatedUnderline>
            ) : (
              <h3>{item.title}</h3>
            )}
            <p>{item.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Exported so plan12.md task 6 can reuse these exact motifs — not a re-skin, the same underlying
 * idea — on /subjects, whose subject sections share one scroll progress source
 * (`SubjectsScene.tsx`'s `SubjectsProgressContext`) rather than each owning its own `useScene()`
 * the way `SubjectWorld` above does: three or four independent scroll listeners on one page is
 * exactly the regression that file's own comment documents (1.6% -> 6.3% dropped frames), so
 * `/subjects` derives each subject's windowed progress from the shared context first
 * (`useSubjectWindowProgress`) and passes that into these same components instead.
 */
export function PathTrack({
  progress,
  active,
  dashed = false,
}: {
  progress: MotionValue<number>;
  active: boolean;
  /** plan12.md task 15's anti-generic audit: maths and 11-plus share this exact component (both
      "a drawn line + timed dots" per this file's own top comment), so a solid line reads as maths's
      "graph curve" reused rather than 11-plus's own "dashed route" from its hero (SubjectHeroMotif's
      RouteMilestones). Only the static guide line below gets the dash — framer-motion's `pathLength`
      style on the drawn `m.line` computes its own stroke-dasharray/dashoffset internally to animate
      the draw, so a static strokeDasharray prop there gets silently overwritten every frame; the
      guide line has no such conflict. `vectorEffect="non-scaling-stroke"` means the dash length is
      in screen pixels, unaffected by this SVG's own 100x2 viewBox scale. */
  dashed?: boolean;
}) {
  const pathLength = useTransform(progress, [0, 1], active ? [0, 1] : [1, 1]);
  return (
    <svg className="subject-world-track" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true">
      <line
        x1="0"
        y1="1"
        x2="100"
        y2="1"
        stroke="var(--subject-accent)"
        strokeWidth="0.35"
        opacity="0.25"
        vectorEffect="non-scaling-stroke"
        strokeDasharray={dashed ? "7 6" : undefined}
      />
      <m.line
        x1="0"
        y1="1"
        x2="100"
        y2="1"
        stroke="var(--subject-accent)"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
        style={{ pathLength }}
      />
    </svg>
  );
}

export function Milestone({
  progress,
  active,
  index,
  count,
}: {
  progress: MotionValue<number>;
  active: boolean;
  index: number;
  count: number;
}) {
  const at = count <= 1 ? 0 : index / (count - 1);
  const lit = useTransform(progress, [Math.max(0, at - 0.08), at], active ? [0, 1] : [1, 1]);
  const scale = useTransform(lit, [0, 1], [0.6, 1]);
  return <m.span className="subject-world-milestone" aria-hidden="true" style={{ opacity: lit, scale }} />;
}

export function ScienceNodes({ progress, active }: { progress: MotionValue<number>; active: boolean }) {
  const y1 = useTransform(progress, [0, 1], active ? [0, -6] : [0, 0]);
  const y2 = useTransform(progress, [0, 1], active ? [0, 6] : [0, 0]);
  const y3 = useTransform(progress, [0, 1], active ? [0, -3] : [0, 0]);
  return (
    <svg className="subject-world-nodes" viewBox="0 0 96 48" aria-hidden="true">
      <line x1="14" y1="24" x2="48" y2="12" stroke="var(--subject-accent)" strokeWidth="1" opacity="0.35" />
      <line x1="48" y1="12" x2="82" y2="30" stroke="var(--subject-accent)" strokeWidth="1" opacity="0.35" />
      <m.circle cx="14" cy="24" r="4" fill="var(--subject-accent)" style={{ y: y1 }} />
      <m.circle cx="48" cy="12" r="5" fill="var(--subject-accent)" style={{ y: y2 }} />
      <m.circle cx="82" cy="30" r="4" fill="var(--subject-accent)" style={{ y: y3 }} />
    </svg>
  );
}
