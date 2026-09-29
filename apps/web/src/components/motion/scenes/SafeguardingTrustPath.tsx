"use client";

import * as m from "framer-motion/m";
import { useTransform } from "framer-motion";
import type { RefObject } from "react";
import { useScene } from "@/lib/motion/scroll";
import { useMotionCapabilities } from "@/lib/motion/capabilities";

/**
 * plan11.md task 11's safeguarding checklist: "Use verified content only. Build fuller scroll/path
 * trust narrative without fabricating checks." These four stages are the exact ones
 * SafeguardingScene.tsx already uses on the homepage — copied, not re-derived, so there is only one
 * place in the codebase where this specific claim set is authored and this can never drift from it.
 * That file's own comment is worth repeating here: this is deliberately a shorter, plainer pipeline
 * than a more elaborate one might use, because a thorough hiring process and a DBS check are the
 * only two things actually confirmed for this site.
 *
 * A vertical drawn line + four stage rows, the same "connector between sequential items" shape as
 * LearningPathScene.tsx on the homepage, adapted for a legal page's plain prose column instead of a
 * dark hero section. It sits inside the "Tutor recruitment and DBS checks" section, immediately
 * after the paragraph that states the same fact in prose — aria-hidden, because that prose sentence
 * already conveys the substantive claim in a screen reader's natural reading order; this is a visual
 * restatement of it, not a second, differently-worded source of the same fact.
 */
const STAGES = ["Tutor applies", "Hiring process", "DBS check", "Approved to teach"] as const;

export function SafeguardingTrustPath() {
  const { ref, smoothProgress } = useScene(["start 0.85", "end 0.55"]);
  const { scrollChoreography } = useMotionCapabilities();
  const pathLength = useTransform(smoothProgress, [0, 1], scrollChoreography ? [0, 1] : [1, 1]);

  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="safeguarding-trust-path" aria-hidden="true">
      <div className="safeguarding-trust-path-track">
        <svg
          className="safeguarding-trust-path-svg"
          viewBox="0 0 2 100"
          preserveAspectRatio="none"
        >
          <line x1="1" y1="0" x2="1" y2="100" stroke="var(--colour-border)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <m.line
            x1="1"
            y1="0"
            x2="1"
            y2="100"
            stroke="var(--colour-green-600)"
            strokeWidth="2"
            strokeDasharray="5 6"
            vectorEffect="non-scaling-stroke"
            style={{ pathLength }}
          />
        </svg>
      </div>
      <ol className="safeguarding-trust-path-list">
        {STAGES.map((stage) => (
          <li key={stage} className="safeguarding-trust-path-item">
            {stage}
          </li>
        ))}
      </ol>
    </div>
  );
}
