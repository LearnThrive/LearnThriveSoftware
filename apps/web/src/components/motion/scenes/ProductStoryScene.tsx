"use client";

import * as m from "framer-motion/m";
import { AnimatePresence, useReducedMotion, useTransform, type MotionValue } from "framer-motion";
import { MaskedText } from "@/components/motion/primitives/MaskedText";
import { useDiscreteProgress, useScene } from "@/lib/motion/scroll";
import styles from "./ProductStoryScene.module.css";

/**
 * plan10.md section 6: "Inside a LearnThrive lesson" — the flagship sticky story, described as
 * probably the most impressive part of the site after the hero. A sticky product visual on the
 * left tracks scroll progress through six scenes described on the right; each scene shows real
 * platform features (whiteboard, video tile, Understanding Check, lesson report fields matching
 * packages/data/src/domain.ts's LessonReport) rather than invented functionality — the same
 * ground rule ProductTabs.tsx already follows.
 */
const SCENES = [
  {
    label: "Match",
    title: "Finding the right tutor",
    text: "Share the subject and what your child needs. We match them with a tutor who fits.",
  },
  {
    label: "Lesson begins",
    title: "Into the classroom",
    text: "At the arranged time, tutor and student join the same online classroom.",
  },
  {
    label: "Learning together",
    title: "Working through it, live",
    text: "Whiteboard, video, and a live understanding check — not just a call.",
  },
  {
    label: "Understanding",
    title: "Checking it landed",
    text: "A quick understanding check shows what's clicked and what needs another look.",
  },
  {
    label: "Progress",
    title: "The lesson becomes a record",
    text: "Topics covered, progress, next steps — written up as the session ends.",
  },
  {
    label: "Parent view",
    title: "Tuition doesn't disappear when the call ends.",
    text: "The report reaches the parent dashboard: what was covered, and what's next.",
  },
] as const;

function SceneVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <>
        <div className={styles.mockCard}>
          <div className={styles.mockCardLabel}>Tutor match</div>
          <div className={styles.mockCardTitle}>Maths &middot; GCSE</div>
        </div>
        <div className={styles.mockPillRow}>
          <span className={`${styles.mockPill} ${styles.mockPillActive}`}>Subject: Maths</span>
          <span className={styles.mockPill}>Year 10</span>
        </div>
      </>
    );
  }
  if (index === 1) {
    return (
      <div className={styles.mockRow}>
        <div className={styles.mockTile}>Tutor</div>
        <div className={styles.mockTile}>Student</div>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className={styles.mockRow}>
        <div className={styles.mockTile}>Video</div>
        <div className={styles.mockTile} style={{ flex: 2 }}>
          Whiteboard
        </div>
      </div>
    );
  }
  if (index === 3) {
    return (
      <div className={styles.mockCard}>
        <div className={styles.mockCardLabel}>Understanding check</div>
        <div className={styles.mockCardTitle}>3 of 4 confident</div>
      </div>
    );
  }
  if (index === 4) {
    return (
      <div className={styles.mockCard}>
        <div className={styles.mockCardLabel}>Lesson report</div>
        <div className={styles.mockCardTitle}>Topics covered &middot; Progress</div>
      </div>
    );
  }
  return (
    <>
      <div className={styles.mockCard}>
        <div className={styles.mockCardLabel}>Parent dashboard</div>
        <div className={styles.mockCardTitle}>Lesson complete</div>
      </div>
      <div className={styles.mockPillRow}>
        <span className={`${styles.mockPill} ${styles.mockPillActive}`}>Next lesson: Tue 6pm</span>
      </div>
    </>
  );
}

/**
 * One segment of the stage's progress bar. It fills as the scroll moves through *its* sixth of the
 * scene (plan11.md task 5): a `scaleX` driven straight from the scroll MotionValue, so the fill
 * follows the visitor's scroll smoothly, never touches layout, and never goes through React. It used
 * to be an inline `width` of 0% or 100% chosen by the active-scene state — a layout property, changed
 * by a re-render, that snapped instead of filling. (It was also an inline `<span>`, and inline boxes
 * ignore `width` and `transform` altogether, so the CSS now makes it a block.)
 */
function StageDotFill({ progress, index }: { progress: MotionValue<number>; index: number }) {
  const scaleX = useTransform(progress, [index / SCENES.length, (index + 1) / SCENES.length], [0, 1]);
  return <m.span className={styles.stageDotFill} style={{ scaleX }} />;
}

export function ProductStoryScene() {
  const { ref, smoothProgress } = useScene(["start start", "end end"]);
  const reduceMotion = useReducedMotion();
  // Which scene is showing is discrete UI state; how far through the story we are is not. The step
  // is derived from the scroll progress and React hears only when it changes (lib/motion/thresholds.ts),
  // not on every frame of the spring — the progress bar below reads the MotionValue directly.
  const activeScene = useDiscreteProgress(smoothProgress, SCENES.length);

  const scene = SCENES[activeScene];

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      id="lesson-story"
      className={styles.section}
      data-motion-scene="product-story"
    >
      <div className={styles.header}>
        <p className={styles.stageLabel}>Inside a LearnThrive lesson</p>
        <h2 className={styles.headerTitle}>One lesson, followed all the way through</h2>
        <p className={styles.headerLead}>
          From finding a tutor to the report a parent actually reads afterwards.
        </p>
      </div>
      <div className={styles.grid}>
        <div className={styles.stickyCol}>
          <div className={styles.stage}>
            {/* plan12.md task 8: a persistent "device" frame that never itself swaps — only what's
                inside it changes. Rearrangement within one continuous surface, not a panel being
                replaced by a different panel, is the whole point of "spatial continuity" this task
                asks for. plan13.md task 2 extends this frame with a lesson-context label (the
                subject/level already established in scene 0, not new data) so the stage reads as
                one continuous lesson throughout, not six unrelated screenshots. */}
            <div className={styles.stageChrome} aria-hidden="true">
              <span className={styles.stageChromeDots}>
                <span className={styles.stageChromeDot} />
                <span className={styles.stageChromeDot} />
                <span className={styles.stageChromeDot} />
              </span>
              <span className={styles.stageContext}>Maths &middot; GCSE</span>
            </div>
            <div className={styles.stageInner}>
              {/* plan13.md task 2's "persistent student/tutor labels": the same two participants
                  already named in scene 1's mock video tiles, hoisted into the frame itself so
                  they're visible across all six states rather than only the one scene that shows
                  the call. */}
              <div className={styles.stageParticipants} aria-hidden="true">
                <span className={styles.stageParticipant}>
                  <span className={styles.stageParticipantDot} />
                  Tutor
                </span>
                <span className={styles.stageParticipant}>
                  <span className={styles.stageParticipantDot} />
                  Student
                </span>
              </div>
              <span className={styles.stageLabel}>{scene.label}</span>
              <div className={styles.stageVisual}>
                <AnimatePresence mode="wait">
                  {/* initial/exit stay the same {opacity, y, scale} shape regardless of reduceMotion —
                      conditionally passing undefined instead caused a real hydration mismatch:
                      Motion bakes the initial values into the SSR'd HTML, and reduceMotion itself
                      can read differently between server (always false) and a real reduced-
                      motion client's first render, so the two disagreed on whether opacity/
                      transform should be present at all. The duration alone (already branched)
                      is enough to make this read as near-instant under reduced motion.
                      y/scale (not just opacity) is task 8's "spatial continuity" over a flat
                      crossfade — the arriving scene visibly advances into the frame, the leaving one
                      recedes, rather than one simply dissolving into the other in place. */}
                  <m.div
                    key={activeScene}
                    initial={{ opacity: 0, y: 22, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -22, scale: 0.96 }}
                    transition={{ duration: reduceMotion ? 0.08 : 0.32 }}
                    style={{ display: "flex", flexDirection: "column", gap: 12 }}
                  >
                    <SceneVisual index={activeScene} />
                  </m.div>
                </AnimatePresence>
              </div>
              <div className={styles.stageProgress}>
                {SCENES.map((s, i) => (
                  <span key={s.label} className={styles.stageDot}>
                    <StageDotFill progress={smoothProgress} index={i} />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className={styles.storyCol}>
          {SCENES.map((s, i) => (
            <div key={s.label} className={styles.beat}>
              <span className={styles.beatNumber}>
                {String(i + 1).padStart(2, "0")} &middot; {s.label}
              </span>
              {/* plan12.md task 8's "one oversized narrative statement... only if it remains
                  factually accurate": this exact line is already this scene's own approved title,
                  not new copy written for the effect. */}
              {i === SCENES.length - 1 ? (
                <h3 className={`${styles.beatTitle} ${styles.beatTitleStatement}`}>
                  <MaskedText>{s.title}</MaskedText>
                </h3>
              ) : (
                <h3 className={styles.beatTitle}>{s.title}</h3>
              )}
              <p className={styles.beatText}>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
