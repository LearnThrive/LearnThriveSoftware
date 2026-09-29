"use client";

import type { RefObject } from "react";
import { ScrollProgressPath } from "@/components/motion/primitives/ScrollProgressPath";
import { useDiscreteProgress, useScene } from "@/lib/motion/scroll";

/**
 * plan11.md task 11's safeguarding checklist: "Use verified content only. Build fuller scroll/path
 * trust narrative without fabricating checks." These four stages are the exact ones
 * SafeguardingScene.tsx already uses on the homepage — copied, not re-derived, so there is only one
 * place in the codebase where this specific claim set is authored and this can never drift from it.
 * That file's own comment is worth repeating here: this is deliberately a shorter, plainer pipeline
 * than a more elaborate one might use, because a thorough hiring process and a DBS check are the
 * only two things actually confirmed for this site.
 *
 * plan12.md task 5: the drawn line now shares its actual drawing code with `LearningPathScene.tsx`
 * (both call `ScrollProgressPath` instead of each keeping a near-identical inline SVG), and stages
 * the scroll position hasn't reached yet read as pending — the same "recurring visual device"
 * treatment, not two independently-evolving copies of it.
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
  const activeIndex = useDiscreteProgress(smoothProgress, STAGES.length);

  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="safeguarding-trust-path" aria-hidden="true">
      <div className="safeguarding-trust-path-track">
        <ScrollProgressPath
          progress={smoothProgress}
          d="M1 0 L1 100"
          viewBox="0 0 2 100"
          preserveAspectRatio="none"
          stroke="var(--colour-green-600)"
          trackStroke="var(--colour-border)"
          strokeWidth={2}
          dashArray="5 6"
          className="safeguarding-trust-path-svg"
        />
      </div>
      <ol className="safeguarding-trust-path-list">
        {STAGES.map((stage, i) => (
          <li
            key={stage}
            className={`safeguarding-trust-path-item${i > activeIndex ? " safeguarding-trust-path-item--pending" : ""}`}
          >
            {stage}
          </li>
        ))}
      </ol>
    </div>
  );
}
