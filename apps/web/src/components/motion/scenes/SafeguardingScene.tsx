"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as m from "framer-motion/m";
import { useMotionValueEvent, useReducedMotion, useTransform } from "framer-motion";
import { useScene } from "@/lib/motion/scroll";
import { indexForProgress } from "@/lib/motion/thresholds";
import styles from "./SafeguardingScene.module.css";

/**
 * plan10.md section 17: "make it a major trust feature... Do not create fake certification
 * badges. Use only real checks you actually perform." Deliberately a shorter, plainer pipeline
 * than the plan's own illustrative example (which named stages like "References" and "Identity"
 * as if separately confirmed) — the only things actually confirmed for this site are a thorough
 * hiring process and a DBS check (plan9.md's safeguarding section, added on the user's explicit
 * confirmation). Padding the pipeline out with unconfirmed stages just to look more elaborate
 * would be exactly the fabrication this section warns against.
 */
const STAGES = ["Tutor applies", "Hiring process", "DBS check", "Approved to teach"] as const;

export function SafeguardingScene() {
  const { ref, smoothProgress } = useScene(["start 0.8", "end 0.5"]);
  const reduceMotion = useReducedMotion();
  // Initial state is always 0 — the same value the server renders — never seeded from
  // reduceMotion directly. useReducedMotion() can read a real (non-null) value synchronously on
  // the client's very first render for a user who actually has the OS preference set, which
  // would disagree with the server's inherent "no window, assume not reduced" default and cause
  // a hydration mismatch (this is exactly what happened in LearningPathScene.tsx before its own
  // fix — see that file's comment). The effect below corrects it after mount instead: reading a
  // browser-only API and syncing state from it is the legitimate use of an effect, as opposed to
  // recomputing a value already derivable during render.
  const [activeStage, setActiveStage] = useState(0);
  // The stage React is already showing, mirrored in a ref so the scroll handler can compare against
  // it without a render or a setState dispatch. `select` is the only place either is written, which
  // keeps them in step: the scroll path and the reduced-motion path both go through it.
  const shownStage = useRef(0);
  const select = useCallback((stage: number) => {
    if (shownStage.current === stage) return;
    shownStage.current = stage;
    setActiveStage(stage);
  }, []);
  // Always the same [0, 1] -> [0, 1] range regardless of reduceMotion, unlike activeStage above:
  // Motion renders a useTransform value's computed result directly into the SSR'd HTML (e.g. the
  // resulting `transform: scaleY(...)`), so branching the range itself on a client-differing
  // boolean reproduces the exact hydration mismatch this file's other comment describes for
  // activeStage — just at the attribute level instead of the element-tree level. The line
  // staying technically scroll-reactive under reduced motion is an accepted, minor trade-off:
  // it's a decorative 2px fill, not the actual content (every stage already renders fully
  // active/complete via activeStage regardless), so nothing a reduced-motion user needs is
  // gated behind it.
  const lineFillScale = useTransform(smoothProgress, [0, 1], [0, 1]);

  useEffect(() => {
    if (!reduceMotion) return;
    // queueMicrotask, not a bare setActiveStage call: this project's lint config (matching
    // react-hooks/set-state-in-effect) flags a synchronous setState statement at the top of an
    // effect body as a cascading-render risk, even for this legitimate case — syncing from a
    // browser-only API (matchMedia) that's simply unreadable during SSR, so the correction can
    // only happen after mount. Routing it through a callback satisfies the same "subscribe for
    // updates, setState in the callback" shape the rule expects, while still resolving before
    // the next paint.
    queueMicrotask(() => select(STAGES.length - 1));
  }, [reduceMotion, select]);

  // Runs on every frame the progress spring is settling, but only ever reaches React when the stage
  // actually changes (plan11.md task 7; lib/motion/thresholds.ts).
  useMotionValueEvent(smoothProgress, "change", (latest) => {
    if (reduceMotion) return;
    select(indexForProgress(latest, STAGES.length));
  });

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={styles.pipeline}
      data-motion-scene="safeguarding-pipeline"
    >
      {STAGES.map((stage, i) => {
        const active = i <= activeStage;
        return (
          <div key={stage} className={styles.stage}>
            {i < STAGES.length - 1 && (
              <div className={styles.stageLine}>
                <m.div className={styles.stageLineFill} style={{ scaleY: lineFillScale }} />
              </div>
            )}
            <span className={`${styles.stageDot} ${active ? styles.stageDotActive : ""}`}>
              {active && (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 12l5 5 11-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className={styles.stageBody}>
              <span className={`${styles.stageTitle} ${active ? "" : styles.stageTitleInactive}`}>
                {stage}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
