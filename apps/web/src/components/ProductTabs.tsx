"use client";

import { useId, useRef, useState } from "react";
import { AnimatePresence, LazyMotion, domAnimation, useReducedMotion } from "framer-motion";
import * as m from "framer-motion/m";
import { motionDuration, motionEase, motionSpring } from "@/lib/motion/tokens";
import styles from "./ProductTabs.module.css";

type AudienceKey = "parent" | "student" | "tutor";

const AUDIENCES: { key: AudienceKey; label: string }[] = [
  { key: "parent", label: "Parents" },
  { key: "student", label: "Students" },
  { key: "tutor", label: "Tutors" },
];

/**
 * What each panel shows is deliberately grounded in the real platform data model
 * (packages/data/src/domain.ts's LessonReport — publicSummary/progress/nextSteps for the
 * parent-visible fields, ReportStatus for the tutor workflow) rather than invented UI, per
 * plan9.md section 16's "do not invent functionality the product does not have". This is a
 * stylised preview of that real shape, not a live data feed or a screenshot.
 */
function ParentPanel() {
  return (
    <div className={styles.panelGrid}>
      <div className={styles.mockCard}>
        <div className={styles.mockCardLabel}>Lesson report</div>
        <p className={styles.mockCardBody}>
          &ldquo;Worked through quadratic equations &mdash; confidence is building steadily.&rdquo;
        </p>
        <div className={styles.mockCardMeta}>
          <span className={styles.mockPill}>Progress: strong</span>
          <span className={styles.mockPillMuted}>Next steps: factorising practice</span>
        </div>
      </div>
      <div className={styles.mockCard}>
        <div className={styles.mockCardLabel}>Next lesson</div>
        <div className={styles.mockCardTitle}>Maths &middot; Tue 6:00pm</div>
        <div className={styles.mockCardSub}>60 minutes, online</div>
      </div>
    </div>
  );
}

function StudentPanel() {
  return (
    <div className={styles.panelGrid}>
      <div className={`${styles.mockCard} ${styles.mockCardDark}`}>
        <div className={styles.mockCardLabel}>Live lesson</div>
        <div className={styles.mockLessonRow}>
          <span className={styles.mockTile}>Tutor</span>
          <span className={styles.mockTile}>You</span>
          <span className={styles.mockBoard}>Whiteboard</span>
        </div>
      </div>
      <div className={styles.mockCard}>
        <div className={styles.mockCardLabel}>Ask a question</div>
        <div className={styles.mockCardTitle}>Raise your hand any time</div>
      </div>
    </div>
  );
}

function TutorPanel() {
  return (
    <div className={styles.panelGrid}>
      <div className={styles.mockCard}>
        <div className={styles.mockCardLabel}>Today</div>
        <div className={styles.mockCardTitle}>3 lessons planned</div>
        <div className={styles.mockCardSub}>Attendance marked as sessions complete</div>
      </div>
      <div className={styles.mockCard}>
        <div className={styles.mockCardLabel}>Report workflow</div>
        <div className={styles.mockCardMeta}>
          <span className={styles.mockPillMuted}>Draft</span>
          <span className={styles.mockPillMuted}>Submitted</span>
          <span className={styles.mockPill}>Approved</span>
        </div>
        <p className={styles.mockCardBody}>Every report is reviewed before a parent sees it.</p>
      </div>
    </div>
  );
}

const PANELS: Record<AudienceKey, () => React.ReactElement> = {
  parent: ParentPanel,
  student: StudentPanel,
  tutor: TutorPanel,
};

export function ProductTabs() {
  const [active, setActive] = useState<AudienceKey>("parent");
  const reduceMotion = useReducedMotion();
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<AudienceKey, HTMLButtonElement | null>>>({});

  function focusTab(index: number) {
    const key = AUDIENCES[(index + AUDIENCES.length) % AUDIENCES.length].key;
    setActive(key);
    tabRefs.current[key]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTab(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(AUDIENCES.length - 1);
    }
  }

  const ActivePanel = PANELS[active];

  return (
    <LazyMotion features={domAnimation}>
      <div className={styles.wrapper}>
        <div role="tablist" aria-label="See LearnThrive from each side" className={styles.tabList}>
          {AUDIENCES.map((audience, i) => {
            const selected = audience.key === active;
            return (
              <button
                key={audience.key}
                ref={(el) => {
                  tabRefs.current[audience.key] = el;
                }}
                role="tab"
                id={`${baseId}-tab-${audience.key}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${audience.key}`}
                tabIndex={selected ? 0 : -1}
                className={styles.tab}
                onClick={() => setActive(audience.key)}
                onKeyDown={(e) => onKeyDown(e, i)}
              >
                {audience.label}
                {selected && (
                  <m.span
                    layoutId={`${baseId}-tab-indicator`}
                    className={styles.tabIndicator}
                    transition={reduceMotion ? { duration: 0 } : motionSpring.tactile}
                  />
                )}
              </button>
            );
          })}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={active}
            id={`${baseId}-panel-${active}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${active}`}
            tabIndex={0}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
            transition={{ duration: reduceMotion ? 0.08 : motionDuration.standard, ease: motionEase.gentle }}
          >
            <ActivePanel />
          </m.div>
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}
